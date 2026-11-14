import '@fontsource/bebas-neue/400.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/700.css';
import './style.css';
import { Game } from './game.js';
import * as Layout from './world/layout.js';

const game = new Game();
window.game = game;
game.L = Layout;
game.boot().catch((e) => {
  console.error(e);
  const t = document.getElementById('load-text'); if (t) t.textContent = '読み込みに失敗しました: ' + e.message;
});

// ---- test / capture API (used by tools/*.mjs; harmless in normal play) ----
window.PM = {
  fast: true,
  // advance the simulation deterministically: n frames of dt seconds, with optional held virtual keys
  step(n = 1, dt = 1 / 30, keys) {
    game.fixedStep = true;
    if (keys) window.PM.hold(keys);
    for (let i = 0; i < n; i++) game.frame(dt, window.PM.fast && i < n - 1);
    return { fps: game.lastRenderMs };
  },
  hold(keys) { const v = game.input.virtual; for (const [k, x] of [...v]) if (x !== 'tap') v.delete(k); for (const k of keys || []) v.set(k, true); },
  tap(k) { game.input.virtual.set(k, 'tap'); },
  release() { game.fixedStep = false; game.input.virtual.clear(); },
  tp(x, z, h = 0) { const p = game.player; if (p.inVehicle) { p.inVehicle.place(x, z, h); } else game.spawnPlayerAt(x, z, h); },
  look(yaw, pitch) { game.rig.yaw = yaw; if (pitch !== undefined) game.rig.pitch = pitch; },
  wanted(n) { game.wanted.set(n); },
  mission(id) { game.missions.start(id); },
  time(h) { game.sky.setHours(h); },
  state() {
    const p = game.player, v = p.inVehicle;
    return { pos: [+p.pos.x.toFixed(1), +p.pos.z.toFixed(1)], hp: Math.round(p.hp), money: Math.round(p.money), veh: v ? v.spec.label : null, speed: v ? +v.speed.toFixed(1) : 0,
      wanted: game.wanted.level, cars: game.vehicles.length, actors: game.actors.length, police: game.vehicles.filter((c) => c.police).length,
      mission: game.missions.active ? game.missions.active.def.id : null, done: [...game.missions.completed], ms: +(game.lastRenderMs || 0).toFixed(1) };
  },
};
window.__renderOnce = () => game.render(0.016);
