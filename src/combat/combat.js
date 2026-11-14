// Hitscan combat: rays against buildings, characters (cylinders) and vehicles (oriented boxes).
import * as THREE from 'three';

const hitInfo = { obj: null, nx: 0, ny: 0, nz: 0, t: 0 };

export class Combat {
  constructor(game) { this.game = game; }

  rayActor(o, d, maxD, a) {
    // vertical cylinder radius r from y0 to y1
    const r = 0.33, y0 = a.pos.y, y1 = a.pos.y + (a.alive ? 1.78 : 0.5);
    const fx = o.x - a.pos.x, fz = o.z - a.pos.z;
    const A = d.x * d.x + d.z * d.z; if (A < 1e-8) return Infinity;
    const B = 2 * (fx * d.x + fz * d.z), C = fx * fx + fz * fz - r * r;
    const disc = B * B - 4 * A * C; if (disc < 0) return Infinity;
    const sq = Math.sqrt(disc); let t = (-B - sq) / (2 * A); if (t < 0) t = (-B + sq) / (2 * A);
    if (t < 0 || t > maxD) return Infinity;
    const y = o.y + d.y * t; if (y < y0 || y > y1) return Infinity;
    return t;
  }
  rayVehicle(o, d, maxD, v) {
    // transform to vehicle local frame
    const c = Math.cos(v.heading), s = Math.sin(v.heading);
    const dx = o.x - v.pos.x, dz = o.z - v.pos.z;
    const lo = [dx * c - dz * s, o.y - v.pos.y, dx * s + dz * c];
    const ld = [d.x * c - d.z * s, d.y, d.x * s + d.z * c];
    const mn = [-v.hx, 0.15, -v.hz], mx = [v.hx, v.tpl.height * 0.95, v.hz];
    let t0 = 0, t1 = maxD, nAxis = -1, nSign = 0;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(ld[i]) < 1e-9) { if (lo[i] < mn[i] || lo[i] > mx[i]) return null; continue; }
      let a = (mn[i] - lo[i]) / ld[i], b = (mx[i] - lo[i]) / ld[i], sg = -1;
      if (a > b) { const tt = a; a = b; b = tt; sg = 1; }
      if (a > t0) { t0 = a; nAxis = i; nSign = sg; }
      if (b < t1) t1 = b; if (t0 > t1) return null;
    }
    if (t0 <= 0) return null;
    const ln = [0, 0, 0]; if (nAxis >= 0) ln[nAxis] = nSign;
    const n = new THREE.Vector3(ln[0] * c + ln[2] * s, ln[1], -ln[0] * s + ln[2] * c);
    return { t: t0, n };
  }

  // nearest hit along a ray; ignore = shooter
  trace(o, d, maxD, ignore) {
    let best = this.game.statics.raycast(o.x, o.y, o.z, d.x, d.y, d.z, maxD, hitInfo);
    let res = { t: best, kind: hitInfo.obj ? (hitInfo.obj.tag === 'ground' ? 'ground' : hitInfo.obj.tag === 'pole' || hitInfo.obj.tag === 'container' || hitInfo.obj.tag === 'fence' ? 'metal' : 'wall') : 'none', n: new THREE.Vector3(hitInfo.nx, hitInfo.ny, hitInfo.nz), actor: null, vehicle: null };
    if (best === Infinity) { res.t = maxD; best = maxD; }
    for (const a of this.game.actors) {
      if (a === ignore || a.inVehicle || a.hidden) continue;
      if (Math.abs(a.pos.x - o.x) > maxD + 2 || Math.abs(a.pos.z - o.z) > maxD + 2) continue;
      const t = this.rayActor(o, d, best, a);
      if (t < best) { best = t; res = { t, kind: 'flesh', n: d.clone().negate(), actor: a, vehicle: null }; }
    }
    for (const v of this.game.vehicles) {
      if (ignore && ignore.inVehicle === v) continue;
      if (Math.abs(v.pos.x - o.x) > maxD + 4 || Math.abs(v.pos.z - o.z) > maxD + 4) continue;
      const h = this.rayVehicle(o, d, best, v);
      if (h && h.t < best) { best = h.t; res = { t: h.t, kind: 'metal', n: h.n, actor: null, vehicle: v }; }
    }
    res.point = o.clone().addScaledVector(d, res.t);
    return res;
  }
  traceAim(o, d, maxD, ignore) {
    // start the ray a bit in front of the camera to skip the player
    const start = o.clone().addScaledVector(d, 1.2);
    const r = this.trace(start, d, maxD, ignore);
    return { point: r.point, actor: r.actor && r.actor.alive ? r.actor : null, vehicle: r.vehicle };
  }

  fire(shooter, muzzle, dir, def, opts = {}) {
    const g = this.game;
    const r = this.trace(muzzle, dir, def.range, shooter);
    g.effects.muzzle(muzzle, dir);
    g.effects.tracer(muzzle.clone().addScaledVector(dir, 0.4), r.point);
    g.audio.gunshot(def.sound, muzzle, shooter === g.player);
    g.noise(muzzle, 55, 'gunshot', shooter);
    if (r.actor) {
      const a = r.actor; const head = r.point.y > a.pos.y + 1.5;
      let dmg = def.damage * (head ? 2.2 : 1) * (opts.damageMul || 1);
      a.takeDamage(dmg, shooter, dir.x, dir.z, 'bullet');
      g.effects.impact(r.point, r.n, 'flesh');
      if (shooter === g.player) g.hud.hitMarker(!a.alive, head);
      if (a === g.player) { g.hud.damageFrom(muzzle); g.rig.shake(0.15); }
    } else if (r.vehicle) {
      r.vehicle.damage(def.damage * 0.9);
      g.effects.impact(r.point, r.n, 'metal');
      g.audio.ricochet(r.point);
      if (shooter === g.player && r.vehicle.driver && r.vehicle.driver !== g.player) g.onVehicleShot(r.vehicle, shooter);
      if (shooter === g.player) g.hud.hitMarker(false, false, true);
    } else if (r.kind !== 'none') {
      g.effects.impact(r.point, r.n, r.kind);
      if (Math.random() < 0.35) g.audio.ricochet(r.point);
    }
    // near-miss whiz for the player
    if (shooter !== g.player && g.player.alive && r.actor !== g.player) {
      const p = g.player.chestPos; const toP = p.clone().sub(muzzle); const t = toP.dot(dir);
      if (t > 0 && t < r.t) { const closest = muzzle.clone().addScaledVector(dir, t); if (closest.distanceTo(p) < 1.6) g.audio.whiz(closest); }
    }
    return r;
  }
}
