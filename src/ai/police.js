// Wanted level + police dispatch: patrol cars on the road graph, pursuit, officers on foot.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { DriverAI } from './driver.js';
import { CombatAI } from './combatant.js';
import { nearestLane } from './roads.js';
import { clamp } from '../core/utils.js';

const CRIMES = {
  shots: { min: 1, add: 0, label: '発砲' },
  assault: { min: 1, add: 0, label: '暴行' },
  murder: { min: 2, add: 0, label: '市民の殺害', cap: 3 },
  carjack: { min: 1, add: 0, label: '車両強奪' },
  copAssault: { min: 2, add: 0, label: '警官への攻撃' },
  copKill: { min: 3, add: 1, label: '警官の殺害' },
  copCar: { min: 2, add: 0, label: 'パトカー窃盗' },
  vehicleHit: { min: 1, add: 0, label: 'ひき逃げ' },
  explosion: { min: 2, add: 0, label: '爆破' },
  heist: { min: 3, add: 0, label: '高級車の窃盗' },
};

export class Wanted {
  constructor(game) {
    this.game = game; this.level = 0; this.hiddenT = 0; this.seen = false; this.lastSeen = new THREE.Vector3();
    this.lastSeenTime = -100; this.flash = 0; this.heat = 0; this.cooldownNeed = 10;
  }
  get cooldownProgress() { return this.level ? clamp(this.hiddenT / this.cooldownNeed, 0, 1) : 0; }
  set(level, reason) {
    level = clamp(level, 0, 5);
    if (level > this.level) { this.game.audio.play('wanted'); this.flash = 2; if (reason) this.game.hud.toast(`指名手配：${reason}`, 'wanted'); }
    if (level === 0 && this.level > 0) { this.game.audio.play('cleared'); this.game.hud.toast('追跡を振り切った', 'good'); this.game.onWantedCleared(); }
    this.level = level; this.hiddenT = 0;
    this.cooldownNeed = 8 + level * 3.5;
    if (level > 0) { this.lastSeen.copy(this.game.focusPos()); this.lastSeenTime = this.game.time; }
  }
  report(crime, pos, { witnessed = null } = {}) {
    const c = CRIMES[crime]; if (!c) return;
    const g = this.game;
    // needs a witness: any alive civilian/officer within range, or police with line of sight
    let w = witnessed;
    if (w === null) {
      w = false;
      for (const a of g.actors) {
        if (a === g.player || !a.alive || a.team === 'gang') continue;
        const d = a.distTo(pos); if (d < (a.team === 'police' ? 60 : 32)) { w = true; break; }
      }
      if (!w) for (const v of g.vehicles) if (v.police && v.driver && v.pos.distanceTo(pos) < 70) { w = true; break; }
    }
    if (!w) return;
    let lvl = Math.max(this.level, c.min) + (this.level >= c.min ? c.add : 0);
    if (crime === 'murder' && this.level >= 2) lvl = Math.min(3, this.level + (Math.random() < 0.35 ? 1 : 0));
    if (c.cap) lvl = Math.max(this.level, Math.min(lvl, c.cap));
    if (lvl !== this.level) this.set(lvl, c.label);
    else { this.hiddenT = 0; this.lastSeen.copy(pos); }
  }
  update(dt) {
    if (this.flash > 0) this.flash -= dt;
    if (this.level === 0) return;
    const g = this.game;
    this.seen = g.police.playerSeen;
    if (this.seen) { this.hiddenT = 0; this.lastSeen.copy(g.focusPos()); this.lastSeenTime = g.time; }
    else {
      this.hiddenT += dt * (g.player.hiddenInGarage ? 3 : 1);
      if (this.hiddenT >= this.cooldownNeed) {
        const nl = this.level - 1; this.hiddenT = 0;
        if (nl === 0) this.set(0); else { this.level = nl; this.cooldownNeed = 8 + nl * 3.5; g.hud.toast(`手配レベル低下 ★${nl}`); }
      }
    }
  }
}

export class Police {
  constructor(game) { this.game = game; this.units = []; this.officers = []; this.spawnT = 0; this.playerSeen = false; this.seenT = 0; }
  get desiredCars() { return [0, 1, 2, 3, 4, 5][this.game.wanted.level]; }
  update(dt) {
    const g = this.game, W = g.wanted;
    // cleanup
    this.units = this.units.filter((u) => g.vehicles.includes(u.v));
    this.officers = this.officers.filter((o) => g.actors.includes(o));
    const pp = g.focusPos();
    // spawn units
    this.spawnT -= dt;
    const active = this.units.filter((u) => !u.v.dead && u.v.driver && u.v.driver.npc);
    if (W.level > 0 && active.length < this.desiredCars && this.spawnT <= 0) { this.spawnUnit(); this.spawnT = W.level >= 3 ? 2.5 : 4; }
    // visibility
    this.seenT -= dt;
    if (this.seenT <= 0) {
      this.seenT = 0.25; let seen = false;
      if (W.level > 0 && g.player.alive && !g.player.hiddenInGarage) {
        const tp = g.focusPos();
        for (const u of this.units) {
          if (u.v.dead || !u.v.driver) continue; const d = u.v.pos.distanceTo(tp);
          if (d < 75 && g.statics.lineOfSight(u.v.pos.x, 1.6, u.v.pos.z, tp.x, tp.y + 1.2, tp.z)) { seen = true; break; }
        }
        if (!seen) for (const o of this.officers) if (o.alive && o.ai.canSee) { seen = true; break; }
      }
      this.playerSeen = seen;
    }
    // drive units
    for (const u of this.units) this.updateUnit(u, dt, pp);
    for (const o of this.officers) {
      const d = o.distTo(pp);
      if (W.level === 0 || d > 140) {
        // officers return to normal: despawn when far / out of view
        if (d > 60 && !g.isVisible(o.pos.x, 1, o.pos.z, 1)) { g.removeActor(o); continue; }
        o.ai.state = 'calm';
      } else if (o.ai.state === 'calm' || o.ai.state === 'guard') { o.ai.state = 'combat'; o.ai.lastSeen.copy(W.lastSeen); o.ai.lastSeenTime = g.time; }
      if (W.level >= 2 || o.ai.provoked) o.ai.provokedLevel = true;
      o.ai.update(dt, d);
    }
  }
  spawnUnit() {
    const g = this.game, pp = g.focusPos();
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.floor(Math.random() * L.NODE_COUNT); const nbs = L.nodeNeighbors(a); const b = nbs[Math.floor(Math.random() * nbs.length)];
      const t = 0.2 + Math.random() * 0.6; const A = L.nodePos(a), B = L.nodePos(b);
      const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t; const d = Math.hypot(x - pp.x, z - pp.z);
      if (d < 75 || d > 170) continue;
      if (g.isVisible(x, 1, z, 6) && d < 130) continue;
      if (g.vehicles.some((v) => Math.hypot(v.pos.x - x, v.pos.z - z) < 12)) continue;
      const v = g.spawnVehicle(Math.random() < 0.7 ? 'Cop' : 'Cop_SUV', 0, 0, 0);
      v.ai = new DriverAI(g, v, { kind: 'police' }); v.ai.placeOnLane(a, b, t); v.ai.mode = 'respond';
      v.driver = { npc: true, police: true, model: 'Male_Shirt' }; v.crew = 2; v.sirenOn = true;
      const u = { v, state: 'respond', deployT: 0, crewOut: false }; this.units.push(u);
      return u;
    }
    return null;
  }
  updateUnit(u, dt, pp) {
    const g = this.game, v = u.v, W = g.wanted;
    if (!v.driver || !v.driver.npc) return; // stolen
    if (v.dead) return;
    const d = Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z);
    if (W.level === 0) {
      v.sirenOn = false;
      if (v.ai.kind === 'police') { v.ai.mode = 'road'; v.ai.route = null; if (v.ai.path.length === 0) v.ai.attachToNearestLane(); }
      if (d > 120 && !g.isVisible(v.pos.x, 1, v.pos.z, 4)) g.removeVehicle(v);
      else v.ai.update(dt);
      return;
    }
    v.sirenOn = true;
    const p = g.player; const pv = p.inVehicle;
    const los = d < 55 && g.statics.lineOfSight(v.pos.x, 1.5, v.pos.z, pp.x, pp.y + 1, pp.z);
    if (u.crewOut) {
      // parked while officers are on foot; rejoin pursuit if player drives off
      v.throttle = 0; v.brake = 1;
      if (pv && d > 40) { u.crewOut = false; v.ai.mode = 'respond'; v.ai.attachToNearestLane(); }
      return;
    }
    if (los || d < 30) {
      v.ai.mode = 'pursuit'; v.ai.aggro = W.level >= 3 ? 1 : 0;
      v.ai.target = { x: pp.x, z: pp.z, vx: pv ? pv.vx : p.vel.x, vz: pv ? pv.vz : p.vel.z, speed: pv ? pv.speed : p.moveSpeed };
      // deploy officers when player is on foot and close
      if (!pv && d < 18 && v.speed < 3 && !u.crewOut && v.crew > 0) this.deployCrew(u);
    } else {
      if (v.ai.mode === 'pursuit') { v.ai.mode = 'respond'; v.ai.attachToNearestLane(); }
      v.ai.mode = 'respond';
      u.routeT = (u.routeT || 0) - dt;
      if (u.routeT <= 0) { u.routeT = 2; const tgt = W.lastSeen; v.ai.setRouteTo(tgt.x, tgt.z); }
    }
    v.ai.update(dt);
    // despawn units that fell far behind
    if (d > 220 && !g.isVisible(v.pos.x, 1, v.pos.z, 4)) g.removeVehicle(v);
  }
  deployCrew(u) {
    const g = this.game, v = u.v; u.crewOut = true;
    for (let i = 0; i < v.crew; i++) {
      const door = i === 0 ? v.driverDoor() : v.passengerDoor();
      const o = g.spawnOfficer(door.x, door.z);
      o.heading = v.heading; this.officers.push(o);
    }
    v.crew = 0; v.driver = { npc: true, police: true, parked: true };
  }
  clear() {
    for (const u of this.units) u.v.sirenOn = false;
  }
}
