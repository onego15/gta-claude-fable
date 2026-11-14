// Records real gameplay frame-by-frame (deterministic fixed-step) and encodes docs/demo.mp4 + docs/demo.gif.
// The game runs exactly as shipped; only the input is scripted (virtual keys / mouse aim) through window.PM.
import { chromium } from 'playwright';
import fs from 'fs'; import { execSync } from 'child_process';
const OUT = '/tmp/claude-0/frames'; fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const W = 960, H = 540, FPS = 15;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('pm_settings', JSON.stringify({ quality: 'high' })); } catch (e) { /* ignore */ } });
await page.goto('http://localhost:5173/?autostart&nolock&t=17.9');
await page.waitForFunction(() => window.__ready && window.game.state === 'play', null, { timeout: 240000 });
await page.evaluate(() => {
  PM.fast = true; game.sky.speed = 0; game.introShown = true;
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  window.D = { aimAt(t) { const r = game.rig, o = game.camera.position; const dx = t.x - o.x, dy = t.y - o.y, dz = t.z - o.z; r.yaw = Math.atan2(-dx, -dz); r.pitch = Math.atan2(-dy, Math.hypot(dx, dz)); } };
});
let n = 0;
async function frames(count, js) { // js runs before each frame; may set keys
  for (let i = 0; i < count; i++) {
    await page.evaluate(([code, i]) => { if (code) (new Function('i', code))(i); PM.step(2, 1 / (2 * 15)); }, [js || '', i]);
    await page.screenshot({ path: `${OUT}/f${String(n++).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
  }
}
const seg = async (name, setup, count, js) => { console.log('segment', name, n); if (setup) await page.evaluate(setup); await frames(count, js); };
// 1) street life on foot
await seg('walk', () => { const s = game.L.LANDMARKS.playerStart; PM.tp(s.x, s.z + 14, Math.PI); game.rig.yaw = 0.25; game.rig.pitch = 0.12; PM.step(30); }, 40, "document.querySelectorAll('.toast').forEach((t) => t.remove()); PM.hold(['KeyW']); game.rig.yaw -= 0.004;");
// 2) get in a car and drive
await seg('drive', () => {
  PM.hold([]); const L = game.L; const v = game.spawnVehicle('SportsCar', 0, 0, 0, { paint: '#ff6b4a' }); v.place(L.roadX(2) + 2.4, L.roadZ(2) + 40, Math.PI); v.sleeping = false;
  const d = v.driverDoor(); PM.tp(d.x - 1.6, d.z - 1.2, Math.PI / 2); game.rig.yaw = -Math.PI / 2 - 0.6; game.rig.pitch = 0.2; PM.step(4); window.__car = v;
}, 64, "if (i === 2) PM.tap('KeyF'); PM.hold(i > 16 ? ['KeyW'] : []); if (i > 50 && i < 55) PM.hold(['KeyW','KeyA']); if (i > 58) PM.hold(['KeyS']);");
// 3) shootout at the docks
await seg('shootout', () => {
  const p = game.player; if (p.inVehicle) { PM.tap('KeyF'); PM.step(10); }
  const M = game.missions; const s = M.starts.dock; PM.tp(s.x, s.z + 6, 0); M.start('dock'); PM.step(4);
  game.hud.bannerT = 0.01; document.querySelectorAll('.toast').forEach((t) => t.remove());
  // pick a firing position with clear line of sight to the nearest guard
  const st = game.statics; let best = null;
  for (const e of M.active.enemies) for (let k = 0; k < 24 && !best; k++) {
    const a = k / 24 * Math.PI * 2, r = 8; const x = e.pos.x + Math.sin(a) * r, z = e.pos.z + Math.cos(a) * r;
    if (st.resolveCircle(x, z, 0.6, 0.3, 1.7).hit) continue;
    if (!st.lineOfSight(x, 1.6, z, e.pos.x, 1.3, e.pos.z)) continue;
    // camera position (behind + right shoulder) must also see the target
    const h = Math.atan2(e.pos.x - x, e.pos.z - z); const cx = x - Math.sin(h) * 2 - Math.cos(h) * 0.6, cz = z - Math.cos(h) * 2 + Math.sin(h) * 0.6;
    if (!st.lineOfSight(cx, 1.7, cz, e.pos.x, 1.3, e.pos.z)) continue;
    best = { x, z, h, e };
  }
  PM.tp(best.x, best.z, best.h); game.rig.yaw = best.h + Math.PI; game.rig.pitch = 0.05; window.__tgt = best.e;
  for (const x of M.active.enemies) if (x.distTo(p.pos) < 30) x.ai.alert(p.pos); PM.step(6);
}, 52, "game.player.hp = Math.max(game.player.hp, 70); const p = game.player; const live = game.missions.active ? game.missions.active.enemies.filter((x) => x.alive && game.statics.lineOfSight(p.pos.x, 1.6, p.pos.z, x.pos.x, 1.3, x.pos.z)) : []; const e = live.sort((a, b) => a.distTo(p.pos) - b.distTo(p.pos))[0]; PM.hold(['aim']); if (e) { D.aimAt(e.chestPos); if (i % 3 === 0) PM.tap('fire'); }");
// 4) police chase at dusk
await seg('chase', () => {
  const p = game.player; PM.hold([]); const M = game.missions; if (M.active) { M.active.end && M.active.end(false); M.cleanup(); }
  game.wanted.suppressed = false; document.querySelectorAll('.toast').forEach((t) => t.remove()); document.getElementById('h-big').classList.remove('show');
  for (const a of [...game.actors]) if (a.team === 'gang') game.removeActor(a);
  const L = game.L; const v = game.spawnVehicle('SportsCar2', 0, 0, 0, { paint: '#ffd166' }); v.place(L.roadX(3) - 2.4, L.roadZ(4) - 12, Math.PI); v.sleeping = false;
  game.sky.setHours(19.3); p.hum.root.visible = false; if (p.hum.weapon) p.hum.weapon.mesh.visible = false; p.inVehicle = v; v.driver = p; game.onPlayerEnteredVehicle(v); v.vz = -15;
  game.wanted.set(3); for (let k = 0; k < 2; k++) { const u = game.police.spawnUnit(); if (u) { u.v.place(v.pos.x + (k ? -0.4 : 3.2), v.pos.z + 7 + k * 9, Math.PI); u.v.vz = -19; u.v.ai.mode = 'pursuit'; } }
  game.rig.yaw = 0; PM.step(10); document.querySelectorAll('.toast').forEach((t) => t.remove());
}, 58, "PM.hold(['KeyW']);");
await b.close();
console.log('frames', n);
execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${OUT}/f%04d.jpg -c:v libx264 -pix_fmt yuv420p -crf 22 -movflags +faststart docs/demo.mp4`);
execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${OUT}/f%04d.jpg -vf "fps=12,scale=600:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" docs/demo.gif`);
console.log(fs.statSync('docs/demo.gif').size, fs.statSync('docs/demo.mp4').size);
