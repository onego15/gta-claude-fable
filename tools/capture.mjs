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
await seg('walk', () => { const s = game.L.LANDMARKS.playerStart; PM.tp(s.x, s.z + 14, Math.PI); game.rig.yaw = 0.25; game.rig.pitch = 0.12; PM.step(30); }, 40, "PM.hold(['KeyW']); game.rig.yaw -= 0.004;");
// 2) get in a car and drive
await seg('drive', () => {
  PM.hold([]); const L = game.L; const v = game.spawnVehicle('SportsCar', 0, 0, 0, { paint: '#ff6b4a' }); v.place(L.roadX(2) + 2.4, L.roadZ(2) + 30, Math.PI); v.sleeping = false;
  const d = v.driverDoor(); const h = Math.atan2(v.pos.x - d.x, v.pos.z - d.z); PM.tp(d.x + Math.sin(h + Math.PI) * 2.2, d.z + Math.cos(h + Math.PI) * 2.2, h); game.rig.yaw = h + Math.PI + 0.5; PM.step(8); PM.tap('KeyF'); window.__car = v;
}, 62, "PM.hold(i > 18 ? ['KeyW'] : []); if (i > 40 && i < 50) PM.hold(['KeyW','KeyD']);");
// 3) shootout at the docks
await seg('shootout', () => {
  const p = game.player; if (p.inVehicle) { PM.tap('KeyF'); PM.step(10); }
  const M = game.missions; const s = M.starts.dock; PM.tp(s.x, s.z + 6, 0); M.start('dock'); PM.step(4);
  const e = M.active.enemies.filter((x) => x.alive).sort((a, b) => a.distTo(p.pos) - b.distTo(p.pos))[0]; const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, dd = Math.hypot(dx, dz);
  PM.tp(e.pos.x - dx / dd * 11, e.pos.z - dz / dd * 11, Math.atan2(dx, dz)); game.player.hp = 100; for (const x of M.active.enemies) x.ai.alert(p.pos); PM.step(6);
  document.querySelectorAll('.toast').forEach((t) => t.remove());
}, 50, "game.player.hp = Math.max(game.player.hp, 60); const p = game.player; const live = game.missions.active ? game.missions.active.enemies.filter((x) => x.alive) : []; const e = live.sort((a, b) => a.distTo(p.pos) - b.distTo(p.pos))[0]; PM.hold(['aim']); if (e) { D.aimAt(e.chestPos); if (i % 4 === 0) PM.tap('fire'); }");
// 4) police chase at dusk
await seg('chase', () => {
  const p = game.player; PM.hold([]); if (game.missions.active) game.missions.fail('demo'); game.wanted.suppressed = false; document.querySelectorAll('.toast').forEach((t) => t.remove());
  const L = game.L; const v = game.spawnVehicle('SportsCar2', 0, 0, 0, { paint: '#ffd166' }); v.place(L.roadX(1) - 2.4, L.roadZ(3) - 10, Math.PI); v.sleeping = false;
  game.sky.setHours(19.2); p.hum.root.visible = false; p.inVehicle = v; v.driver = p; game.onPlayerEnteredVehicle(v); v.vx = -Math.sin(0) * 0; v.vz = -14; 
  game.wanted.set(3); for (let k = 0; k < 2; k++) { const u = game.police.spawnUnit(); if (u) { u.v.place(v.pos.x + (k ? 0 : 2.6), v.pos.z + 16 + k * 10, Math.PI); u.v.vz = -13; u.v.ai.mode = 'pursuit'; } }
  game.rig.yaw = 0; PM.step(10);
}, 55, "PM.hold(['KeyW']); if (i > 26 && i < 36) PM.hold(['KeyW','KeyA']);");
await b.close();
console.log('frames', n);
execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${OUT}/f%04d.jpg -c:v libx264 -pix_fmt yuv420p -crf 22 -movflags +faststart docs/demo.mp4`);
execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${OUT}/f%04d.jpg -vf "fps=${FPS},scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" docs/demo.gif`);
console.log(fs.statSync('docs/demo.gif').size, fs.statSync('docs/demo.mp4').size);
