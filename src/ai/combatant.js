// On-foot combat AI used by gang members and police officers.
import * as THREE from 'three';
import { clamp, angleDiff, rand } from '../core/utils.js';

const tmp = new THREE.Vector3();

export class CombatAI {
  constructor(game, actor, opts = {}) {
    this.game = game; this.a = actor; this.kind = opts.kind || 'gang';
    this.state = opts.state || 'guard'; this.home = actor.pos.clone();
    this.canSee = false; this.seeT = 0; this.lastSeen = new THREE.Vector3(); this.lastSeenTime = -100;
    this.cover = null; this.coverT = 0; this.peek = false; this.burst = 0; this.burstT = 0;
    this.moveTarget = null; this.thinkT = Math.random() * 0.3; this.reaction = 0.45 + Math.random() * 0.4;
    this.accuracy = opts.accuracy ?? 1; this.damageMul = opts.damageMul ?? 0.3; this.range = opts.range || 26;
    this.arrestT = 0; this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0; this.alertRadius = opts.alertRadius || 30;
    this.vehicle = opts.vehicle || null; this.sidestep = 0;
  }
  get target() { return this.game.player; }
  alert(pos) { if (this.state === 'guard' || this.state === 'search') { this.state = 'combat'; if (pos) this.lastSeen.copy(pos); this.lastSeenTime = this.game.time; } }
  perceive(dt) {
    this.seeT -= dt; if (this.seeT > 0) return;
    this.seeT = 0.22 + Math.random() * 0.1;
    const p = this.target; const a = this.a;
    if (!p.alive) { this.canSee = false; return; }
    const tp = p.inVehicle ? p.inVehicle.pos : p.pos;
    const d = Math.hypot(tp.x - a.pos.x, tp.z - a.pos.z);
    const maxD = this.kind === 'police' ? 60 : 45;
    let vis = false;
    if (d < maxD) {
      const fwdDot = (Math.sin(a.heading) * (tp.x - a.pos.x) + Math.cos(a.heading) * (tp.z - a.pos.z)) / Math.max(d, 0.01);
      if (d < 14 || fwdDot > -0.2 || this.state === 'combat') vis = this.game.statics.lineOfSight(a.pos.x, a.pos.y + 1.6, a.pos.z, tp.x, tp.y + 1.3, tp.z);
    }
    if (vis && p.hiddenInGarage) vis = false;
    if (vis && !this.canSee) this.reactT = this.reaction;
    this.canSee = vis;
    if (vis) { this.lastSeen.copy(tp); this.lastSeenTime = this.game.time; if (this.state === 'guard') { this.state = 'combat'; this.game.onEnemySpotted(this); } }
  }
  update(dt, distToPlayer) {
    const a = this.a, g = this.game, hum = a.hum;
    a.tickWeapon(dt);
    if (!a.alive) { a.physics(dt); hum.update(dt); return; }
    this.perceive(dt);
    if (this.reactT > 0) this.reactT -= dt;
    const p = this.target; const tp = p.inVehicle ? p.inVehicle.pos : p.pos;
    const dx = tp.x - a.pos.x, dz = tp.z - a.pos.z; const d = Math.hypot(dx, dz);
    let move = null, speed = 0, face = null, aim = false, running = false;
    const police = this.kind === 'police';
    const stars = g.wanted.level;
    if (police && stars === 0) { this.state = 'calm'; }
    switch (this.state) {
      case 'guard': {
        // idle with occasional glance
        face = (this.guardYaw || 0) + Math.sin(g.time * 0.3 + a.id) * 0.8;
        if (Math.hypot(a.pos.x - this.home.x, a.pos.z - this.home.z) > 1) { move = this.home; speed = 1.4; }
        break;
      }
      case 'calm': {
        // police after the heat dies down: walk back to car / stand
        speed = 0; break;
      }
      case 'combat': {
        if (!p.alive) { this.state = police ? 'calm' : 'guard'; break; }
        const arrestMode = police && stars <= 1 && !p.inVehicle && !this.provoked;
        if (arrestMode) {
          // run up and cuff
          if (d > 1.6) { move = tp; speed = d > 6 ? 5.4 : 3.2; running = d > 6; }
          else {
            face = Math.atan2(dx, dz);
            if (p.moveSpeed < 2.2) { this.arrestT += dt; if (this.arrestT > 1.3) g.onArrest(this); } else this.arrestT = Math.max(0, this.arrestT - dt);
            g.hud.arrestMeter = Math.max(g.hud.arrestMeter || 0, this.arrestT / 1.3);
          }
          aim = d < 12 && !!a.weapon; if (aim) face = Math.atan2(dx, dz);
          break;
        }
        if (!this.canSee) {
          // move to last seen
          if (g.time - this.lastSeenTime > 12) { this.state = police ? 'search' : 'guard'; break; }
          move = this.lastSeen; speed = 4.6; running = true;
          if (Math.hypot(this.lastSeen.x - a.pos.x, this.lastSeen.z - a.pos.z) < 2) { move = null; face = a.heading + 0.5; }
          break;
        }
        face = Math.atan2(dx, dz);
        if (!police && this.game.city.data.coverPoints.length) this.coverLogic(dt, d, tp);
        else this.openLogic(dt, d, tp);
        move = this.moveTarget; speed = this.moveSpeed || 0; running = speed > 3;
        aim = !!a.weapon && (this.peek || police || !this.cover);
        if (aim && this.reactT <= 0 && d < this.range + 8) this.shootLogic(dt, d, tp);
        break;
      }
      case 'search': {
        if (this.canSee) { this.state = 'combat'; break; }
        if (!this.searchPt || Math.hypot(this.searchPt.x - a.pos.x, this.searchPt.z - a.pos.z) < 2) this.searchPt = this.lastSeen.clone().add(new THREE.Vector3(rand(-12, 12), 0, rand(-12, 12)));
        move = this.searchPt; speed = 2.2; break;
      }
    }
    // locomotion
    if (move) {
      tmp.set(move.x - a.pos.x, 0, move.z - a.pos.z); const md = tmp.length();
      if (md > 0.4) {
        let yaw = Math.atan2(tmp.x, tmp.z);
        if (a.blocked) { this.sidestep = clamp(this.sidestep + dt * 2.5, 0, 1.4); } else this.sidestep = Math.max(0, this.sidestep - dt);
        yaw += this.sidestep * this.strafe;
        const sp = Math.min(speed, md * 3);
        a.vel.x = Math.sin(yaw) * sp; a.vel.z = Math.cos(yaw) * sp;
        if (face === null || !aim) face = yaw;
      } else { a.vel.x *= 0.7; a.vel.z *= 0.7; }
    } else { a.vel.x *= 0.7; a.vel.z *= 0.7; }
    if (face !== null) a.heading += angleDiff(a.heading, face) * Math.min(1, dt * 10);
    a.physics(dt);
    // anim
    const sp = Math.hypot(a.vel.x, a.vel.z);
    hum.setLocomotion(sp, dt, running);
    hum.aimWeight += ((aim ? 1 : 0) - hum.aimWeight) * Math.min(1, dt * 8);
    hum.aimTarget.set(tp.x, tp.y + (p.inVehicle ? 0.9 : 1.25), tp.z);
    hum.aimPitch = clamp(-Math.atan2(hum.aimTarget.y - (a.pos.y + 1.3), d), -0.8, 0.8);
    hum.update(dt);
    hum.setShadow(distToPlayer < 40);
  }
  coverLogic(dt, d, tp) {
    const g = this.game, a = this.a; const st = g.statics;
    this.coverT -= dt;
    const coverSafe = (c) => !st.lineOfSight(tp.x, tp.y + 1.4, tp.z, c.x, a.pos.y + 1.3, c.z);
    if (!this.cover || this.coverT <= 0 || (this.cover && !this.peek && !coverSafe(this.cover) && Math.hypot(this.cover.x - a.pos.x, this.cover.z - a.pos.z) < 1)) {
      // choose a cover point: safe from player, within range band, near us
      let best = null, bs = Infinity;
      for (const c of g.city.data.coverPoints) {
        if (c.taken && c.taken !== this) continue;
        const dc = Math.hypot(c.x - a.pos.x, c.z - a.pos.z); if (dc > 22) continue;
        const dp = Math.hypot(c.x - tp.x, c.z - tp.z); if (dp < 7 || dp > 30) continue;
        if (!coverSafe(c)) continue;
        const score = dc + Math.abs(dp - 14) * 0.6 + Math.random() * 3;
        if (score < bs) { bs = score; best = c; }
      }
      if (this.cover && this.cover.taken === this) this.cover.taken = null;
      this.cover = best; if (best) best.taken = this;
      this.coverT = 6 + Math.random() * 5; this.peek = false; this.peekT = 1.5 + Math.random();
    }
    if (!this.cover) { this.openLogic(dt, d, tp); return; }
    const c = this.cover; const atCover = Math.hypot(c.x - a.pos.x, c.z - a.pos.z) < 0.8;
    this.moveSpeed = atCover ? 2.2 : 5.0;
    if (!atCover && !this.peek) { this.moveTarget = c; return; }
    // peek cycle: step out sideways to get LOS, shoot, return
    this.peekT -= dt;
    if (this.peekT <= 0) { this.peek = !this.peek; this.peekT = this.peek ? 1.4 + Math.random() * 1.2 : 1.2 + Math.random() * 1.6; if (this.peek) this.peekPos = this.findPeek(c, tp); }
    this.moveTarget = this.peek && this.peekPos ? this.peekPos : c;
  }
  findPeek(c, tp) {
    const st = this.game.statics; const dx = tp.x - c.x, dz = tp.z - c.z; const L = Math.hypot(dx, dz) || 1;
    const px = -dz / L, pz = dx / L;
    for (const s of [1.4, -1.4, 2.4, -2.4]) {
      const x = c.x + px * s, z = c.z + pz * s;
      if (st.resolveCircle(x, z, 0.35, 0.3, 1.6).hit) continue;
      if (st.lineOfSight(x, 1.5, z, tp.x, tp.y + 1.3, tp.z)) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(c.x + (dx / L) * 1.2, 0, c.z + (dz / L) * 1.2);
  }
  openLogic(dt, d, tp) {
    const a = this.a;
    this.strafeT -= dt; if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = 1.5 + Math.random() * 2; }
    const want = this.kind === 'police' ? 12 : 11;
    const dx = tp.x - a.pos.x, dz = tp.z - a.pos.z; const L = Math.max(d, 0.01);
    let mx = 0, mz = 0;
    if (d > want + 6) { mx = dx / L; mz = dz / L; this.moveSpeed = 4.8; }
    else if (d < want - 5) { mx = -dx / L; mz = -dz / L; this.moveSpeed = 2.4; }
    else { mx = -dz / L * this.strafe; mz = dx / L * this.strafe; this.moveSpeed = 1.8; }
    this.moveTarget = new THREE.Vector3(a.pos.x + mx * 3, 0, a.pos.z + mz * 3);
  }
  shootLogic(dt, d, tp) {
    const a = this.a, g = this.game; const w = a.weapon; if (!w) return;
    if (w.mag <= 0) { a.startReload(); if (w.reserve <= 0) w.reserve = 60; return; }
    this.burstT -= dt;
    if (this.burst <= 0) { if (this.burstT <= 0) { this.burst = w.def.auto ? 3 + Math.floor(Math.random() * 4) : 1 + Math.floor(Math.random() * 2); this.burstT = 0.9 + Math.random() * 1.2; } return; }
    if (!a.canFire()) return;
    if (Math.abs(angleDiff(a.heading, Math.atan2(tp.x - a.pos.x, tp.z - a.pos.z))) > 0.5) return;
    if (a.hum.aimWeight < 0.7) return;
    this.burst--; w.mag--; a.cooldown = w.def.rate * (w.def.auto ? 1.3 : 2.2);
    const p = g.player; const muzzle = a.muzzleWorld();
    const pv = p.inVehicle ? p.inVehicle.speed : p.moveSpeed;
    let chance = clamp(0.62 - d * 0.014 - pv * 0.035, 0.12, 0.6) * this.accuracy * g.difficulty;
    if (p.inVehicle) chance *= 0.6;
    const target = new THREE.Vector3(tp.x, tp.y + (p.inVehicle ? 0.9 : 1.2), tp.z);
    if (Math.random() > chance) {
      // deliberate near miss
      const side = new THREE.Vector3(-(tp.z - a.pos.z), 0, tp.x - a.pos.x).normalize();
      target.addScaledVector(side, (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 1.3)); target.y += (Math.random() - 0.3) * 1.2;
    }
    const dir = target.sub(muzzle).normalize();
    g.combat.fire(a, muzzle, dir, w.def, { damageMul: this.damageMul });
  }
}
