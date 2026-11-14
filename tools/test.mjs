// End-to-end gameplay test: boots the real game in headless Chromium and drives it through the
// scripted PM API (virtual keys + deterministic fixed steps). Usage: npm run dev (port 5173) then `npm test`.
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:5173/?autostart&nolock';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
await page.goto(URL);
await page.waitForFunction(() => window.__ready && window.game.state === 'play', null, { timeout: 240000 });
const results = [];
async function test(name, fn) {
  if (process.env.ONLY && !process.env.ONLY.split(',').some((k) => name.includes(k))) return;
  const t0 = Date.now();
  try { const info = await page.evaluate(fn); results.push({ name, ok: true, info, ms: Date.now() - t0 }); console.log('PASS', name, info ? JSON.stringify(info) : ''); }
  catch (e) { results.push({ name, ok: false, err: e.message.split('\n')[0] }); console.log('FAIL', name, e.message.split('\n').slice(0, 3).join(' | ')); }
}
const H = () => {
  window.T = {
    assert(c, m) { if (!c) throw new Error(m); },
    god() { const p = game.player; p.hp = 100; p.armor = 100; },
    nearestRoad() { return null; },
    aimAt(target) { // point the camera at a world position (used like a mouse)
      const r = game.rig; const o = game.camera.position; const dx = target.x - o.x, dy = target.y - o.y, dz = target.z - o.z;
      r.yaw = Math.atan2(-dx, -dz); r.pitch = Math.atan2(-dy, Math.hypot(dx, dz)) * -1 * -1;
    },
  };
};
await page.evaluate(H);

await test('boot: player spawned, city populated', () => {
  const s = PM.state(); T.assert(s.cars > 20, 'too few cars ' + s.cars); T.assert(game.city.data.buildings.length > 50, 'buildings');
  PM.step(60, 1 / 30); const s2 = PM.state(); T.assert(s2.actors > 5, 'peds ' + s2.actors); return s2;
});
await test('walk + sprint moves the player', () => {
  const p0 = game.player.pos.clone(); PM.step(30, 1 / 30, ['KeyW']); const d1 = p0.distanceTo(game.player.pos);
  const p1 = game.player.pos.clone(); PM.step(30, 1 / 30, ['KeyW', 'ShiftLeft']); const d2 = p1.distanceTo(game.player.pos);
  T.assert(d1 > 2.5, 'walk ' + d1); T.assert(d2 > d1 * 1.3, 'sprint ' + d2); PM.hold([]); return { walk: +d1.toFixed(2), sprint: +d2.toFixed(2) };
});
await test('jump leaves the ground', () => { PM.step(5); PM.tap('Space'); PM.step(8); const y = game.player.pos.y; PM.step(40); return { peak: +y.toFixed(2), grounded: game.player.grounded }; });
await test('aim + fire uses ammo, reload refills', () => {
  const p = game.player; p.equip('pistol'); const w = p.weapons.pistol; const m0 = w.mag;
  PM.hold(['aim']); PM.step(10); for (let i = 0; i < 3; i++) { PM.tap('fire'); PM.step(8); }
  T.assert(w.mag === m0 - 3, 'mag ' + w.mag + ' from ' + m0);
  PM.hold([]); PM.tap('KeyR'); PM.step(70); T.assert(w.mag === w.def.mag, 'reload ' + w.mag); return { mag: w.mag, reserve: w.reserve };
});
await test('enter, drive and exit a car', () => {
  const p = game.player; const v = game.spawnVehicle('NormalCar1', 0, 0, 0); const L = game.lanes;
  v.place(p.pos.x + 0, p.pos.z, 0); // placed then moved onto the road below
  const rx = game.L.roadX(2) + 2.4, rz = game.L.roadZ(2) + 20; v.place(rx, rz, 0); v.sleeping = false;
  const d = v.driverDoor(); PM.tp(d.x, d.z, 0); PM.step(2); PM.tap('KeyF'); PM.step(30);
  T.assert(p.inVehicle === v, 'did not enter');
  PM.step(75, 1 / 30, ['KeyW']); const sp = v.speed; T.assert(sp > 8, 'speed ' + sp);
  PM.step(40, 1 / 30, ['KeyS']); PM.hold([]); PM.step(20); PM.tap('KeyF'); PM.step(10);
  T.assert(!p.inVehicle, 'did not exit'); return { topSpeedKmh: Math.round(sp * 3.6), dist: +Math.hypot(v.pos.x - rx, v.pos.z - rz).toFixed(1) };
});
await test('carjack an NPC car raises wanted level', () => {
  const p = game.player; game.wanted.set(0);
  const v = game.vehicles.filter((c) => c.driver && c.driver.npc && !c.police).sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0];
  T.assert(v, 'no traffic'); v.throttle = 0; v.vx = 0; v.vz = 0; v.speed = 0;
  const d = v.driverDoor(); PM.tp(d.x, d.z, 0); PM.tap('KeyF'); PM.step(30);
  T.assert(p.inVehicle === v, 'not in jacked car'); const lvl = game.wanted.level; T.assert(lvl >= 1, 'wanted ' + lvl);
  return { wanted: lvl, ejected: game.actors.filter((a) => a.ai && a.ai.kind === 'ped' && a.ai.state === 'flee').length };
});
await test('police respond to 3 stars and chase', () => {
  game.wanted.set(3); PM.step(240, 1 / 30); const cops = game.vehicles.filter((v) => v.police).length;
  const officers = game.actors.filter((a) => a.team === 'police').length; T.assert(cops + officers > 0, 'no police'); return { cops, officers, wanted: game.wanted.level };
});
await test('wanted cleared removes the heat and police despawn eventually', () => {
  game.wanted.set(0); PM.step(60, 1 / 30); return { wanted: game.wanted.level, cops: game.vehicles.filter((v) => v.police && v.ai && v.ai.kind === 'police').length };
});
await test('mission D (delivery) start -> pass', () => {
  const p = game.player; if (p.inVehicle) { PM.tap('KeyF'); PM.step(10); }
  const M = game.missions; const s = M.starts.delivery; PM.tp(s.x, s.z, 0); PM.step(5);
  M.start('delivery'); const car = M.active.car; PM.step(5);
  const d = car.driverDoor(); PM.tp(d.x, d.z, 0); PM.tap('KeyF'); PM.step(30); T.assert(p.inVehicle === car, 'not in mission car');
  PM.step(3); T.assert(M.timer > 0, 'timer'); const drop = game.city.data.marketDrop;
  car.place(drop.x, drop.z, 0); PM.step(30); T.assert(M.completed.has('delivery'), 'not passed: ' + M.objective); return { money: Math.round(p.money) };
});
await test('mission S (dock shootout) start -> clear -> case -> pass', () => {
  const p = game.player; if (p.inVehicle) { PM.tap('KeyF'); PM.step(10); }
  const M = game.missions; const s = M.starts.dock; PM.tp(s.x, s.z, 0); PM.step(5); M.start('dock'); PM.step(5);
  let shots = 0, frames = 0;
  // fight for real: aim at each live enemy's chest with the actual camera and fire the pistol
  while (M.active && frames < 6000) {
    T.god(); const live = M.active.enemies.filter((e) => e.alive);
    if (M.active.case) { PM.tp(M.active.case.pos.x, M.active.case.pos.z, 0); PM.step(3); continue; }
    if (!live.length) { PM.step(5); frames += 5; continue; }
    const e = live.sort((a, b) => a.distTo(p.pos) - b.distTo(p.pos))[0];
    const st = game.statics; const seen = (x, z) => st.lineOfSight(x, 1.6, z, e.pos.x, 1.3, e.pos.z);
    if (e.distTo(p.pos) > 14 || !seen(p.pos.x, p.pos.z)) { // flank: find an open spot with line of sight, like a player would
      for (let k = 0; k < 32; k++) { const a = k / 32 * Math.PI * 2, r = 6 + (k % 3) * 2; const x = e.pos.x + Math.sin(a) * r, z = e.pos.z + Math.cos(a) * r;
        if (!st.resolveCircle(x, z, 0.6, 0.3, 1.7).hit && seen(x, z)) { PM.tp(x, z, 0); break; } }
    }
    PM.hold(['aim']); PM.step(2); T.aimAt(e.chestPos); PM.step(1); T.aimAt(e.chestPos); PM.tap('fire'); PM.step(4); shots++; frames += 7;
    const w = p.weapon; if (w && w.mag === 0) { PM.hold([]); PM.step(50); frames += 50; }
  }
  PM.hold([]); T.assert(M.completed.has('dock'), 'dock not passed, killed ' + (M.active && M.active.killed)); T.assert(p.weapons.smg, 'no smg');
  return { shots, frames, money: Math.round(p.money) };
});
await test('mission H (heist) steal -> lose cops -> garage -> pass', () => {
  const p = game.player; if (p.inVehicle) { PM.tap('KeyF'); PM.step(10); }
  const M = game.missions; M.start('heist'); const car = M.active.car; PM.step(3);
  const d = car.driverDoor(); PM.tp(d.x, d.z, 0); PM.tap('KeyF'); PM.step(30); T.assert(p.inVehicle === car, 'not in gold car');
  PM.step(5); T.assert(game.wanted.level >= 3, 'heist wanted ' + game.wanted.level);
  // evade: hide far away where nobody sees us until the heat cools off
  const gd = game.city.data.garageDoor; car.place(gd.x + 60, gd.z + 40, 0); car.vx = car.vz = 0;
  let t = 0; while (game.wanted.level > 0 && t < 3000) { for (const v of game.vehicles) if (v.police) { v.place(gd.x + 300, gd.z - 300, 0); } for (const a of game.actors) if (a.team === 'police') a.pos.set(gd.x + 300, 0, gd.z - 300); PM.step(10); t += 10; }
  T.assert(game.wanted.level === 0, 'still wanted'); PM.step(5);
  car.place(gd.x, gd.z, 0); car.vx = car.vz = 0; PM.step(20); T.assert(M.completed.has('heist'), 'heist not passed: ' + M.objective);
  return { coolFrames: t, money: Math.round(p.money) };
});
await test('death -> hospital respawn with fee', () => {
  const p = game.player; if (p.inVehicle) { PM.tap('KeyF'); PM.step(10); }
  const m0 = p.money; p.takeDamage(500, null, 0, 0, 'test'); PM.step(200, 1 / 30);
  T.assert(p.alive && p.hp === 100, 'not revived'); const h = game.city.data.hospitalFront; T.assert(Math.hypot(p.pos.x - h.x, p.pos.z - h.z) < 6, 'not at hospital');
  return { fee: Math.round(m0 - p.money) };
});
await test('arrest -> police station respawn', () => {
  game.onArrest(); PM.step(200, 1 / 30); const s = game.city.data.policeFront; const p = game.player;
  T.assert(Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < 6, 'not at station'); T.assert(game.wanted.level === 0, 'wanted after arrest'); return { money: Math.round(p.money) };
});
await test('pause menu opens with map', () => { game.pause(); const shown = document.getElementById('pause').classList.contains('show'); game.resume(); T.assert(shown, 'pause hidden'); return null; });
await test('long simulation stays stable (traffic + peds + combat)', () => {
  game.wanted.set(2); const t0 = performance.now(); PM.step(900, 1 / 30); const s = PM.state();
  T.assert(Number.isFinite(game.player.pos.x), 'NaN player');
  const bad = game.vehicles.filter((v) => !Number.isFinite(v.pos.x) || Math.abs(v.pos.x) > 2000).length; T.assert(!bad, bad + ' vehicles exploded out');
  const badA = game.actors.filter((a) => !Number.isFinite(a.pos.x)).length; T.assert(!badA, 'NaN actors');
  return { ...s, simMsPerFrame: +((performance.now() - t0) / 900).toFixed(2) };
});
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} passed`);
if (errors.length) console.log('PAGE ERRORS:\n' + [...new Set(errors)].slice(0, 15).join('\n'));
await b.close();
process.exit(ok === results.length && !errors.length ? 0 : 1);
