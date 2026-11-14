// NPC driving brain: lane following with signals and car-following, plus pursuit mode for police.
import * as L from '../world/layout.js';
import { laneOf, lanePoints, turnPoints, chooseNext, nearestLane, signalState } from './roads.js';
import { clamp, angleDiff } from '../core/utils.js';

export class DriverAI {
  constructor(game, vehicle, opts = {}) {
    this.game = game; this.v = vehicle; this.kind = opts.kind || 'traffic';
    this.path = []; this.idx = 0; this.prev = -1; this.cur = -1; this.next = -1;
    this.cruise = opts.cruise || 11 + Math.random() * 2.5;
    this.panic = 0; this.stuckT = 0; this.reverseT = 0; this.honkT = 0; this.waitT = 0;
    this.mode = 'road'; this.route = null; this.target = null; this.aggro = 0;
    this.ignoreLights = false; this.blockedBy = null;
  }
  placeOnLane(a, b, t) {
    const l = laneOf(a, b);
    const x = l.p0.x + (l.p1.x - l.p0.x) * t, z = l.p0.z + (l.p1.z - l.p0.z) * t;
    this.v.place(x, z, Math.atan2(l.dir.x, l.dir.z));
    this.prev = a; this.cur = b;
    this.path = lanePoints(a, b).filter((p) => (p.x - x) * l.dir.x + (p.z - z) * l.dir.z > 1);
    if (!this.path.length) this.path = [{ x: l.p1.x, z: l.p1.z, stopAt: { node: b, axis: l.axis } }];
    this.idx = 0;
  }
  attachToNearestLane() {
    const n = nearestLane(this.v.pos.x, this.v.pos.z); if (!n) return;
    // choose direction consistent with heading
    const l = n.lane; const fx = Math.sin(this.v.heading), fz = Math.cos(this.v.heading);
    let a = n.a, b = n.b;
    if (l.dir.x * fx + l.dir.z * fz < -0.2) { a = n.b; b = n.a; }
    const l2 = laneOf(a, b);
    this.prev = a; this.cur = b;
    this.path = lanePoints(a, b).filter((p) => (p.x - this.v.pos.x) * l2.dir.x + (p.z - this.v.pos.z) * l2.dir.z > 3);
    if (!this.path.length) this.path = [{ x: l2.p1.x, z: l2.p1.z, stopAt: { node: b, axis: l2.axis } }];
    this.idx = 0;
  }
  extend() {
    while (this.path.length - this.idx < 8) {
      let nxt;
      if (this.route && this.route.length) {
        const i = this.route.indexOf(this.cur);
        nxt = i >= 0 && i < this.route.length - 1 ? this.route[i + 1] : chooseNext(this.prev, this.cur);
        if (nxt === this.prev && L.nodeNeighbors(this.cur).length > 1) nxt = chooseNext(this.prev, this.cur);
      } else nxt = chooseNext(this.prev, this.cur);
      const turn = turnPoints(this.prev, this.cur, nxt);
      const lane = lanePoints(this.cur, nxt);
      // drop consumed points to keep the array short
      if (this.idx > 20) { this.path.splice(0, this.idx); this.idx = 0; }
      this.path.push(...turn, ...lane.slice(1));
      this.prev = this.cur; this.cur = nxt;
    }
  }
  setRouteTo(x, z) {
    const goal = L.nearestNode(x, z);
    this.route = L.findPath(this.cur, goal);
  }

  update(dt) {
    const v = this.v, g = this.game; if (v.dead) { v.throttle = 0; v.brake = 1; return; }
    if (this.panic > 0) this.panic -= dt;
    v.allowReverse = this.reverseT > 0;
    if (this.reverseT > 0) {
      this.reverseT -= dt; v.throttle = 0; v.brake = 1; v.steer = -this.revSteer; v.handbrake = 0;
      if (this.reverseT <= 0 && this.mode === 'road') this.attachToNearestLane();
      return;
    }
    let tx, tz, vTarget;
    const speed = v.speed, fwdSpeed = v.forwardSpeed;
    if (this.mode === 'pursuit' && this.target) {
      const t = this.target; const lead = Math.min(1.2, Math.hypot(t.x - v.pos.x, t.z - v.pos.z) / 30);
      tx = t.x + (t.vx || 0) * lead; tz = t.z + (t.vz || 0) * lead;
      const d = Math.hypot(t.x - v.pos.x, t.z - v.pos.z);
      vTarget = d > 25 ? v.spec.maxSpeed * 0.95 : this.aggro > 0.5 ? Math.max(8, (t.speed || 0) + 6) : clamp((d - 7) * 0.9, 0, 20);
    } else {
      this.extend();
      // advance along path
      while (this.idx < this.path.length - 1) {
        const p = this.path[this.idx]; const dx = p.x - v.pos.x, dz = p.z - v.pos.z;
        const ahead = dx * Math.sin(v.heading) + dz * Math.cos(v.heading);
        if (dx * dx + dz * dz < 9 || ahead < 0) this.idx++; else break;
      }
      // lookahead
      const Ld = 4.5 + speed * 0.45; let acc = 0, li = this.idx, px = v.pos.x, pz = v.pos.z;
      while (li < this.path.length - 1) { const p = this.path[li]; acc += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z; if (acc >= Ld) break; li++; }
      tx = this.path[li].x; tz = this.path[li].z;
      vTarget = this.kind === 'police' ? (this.mode === 'respond' ? 26 : 14) : this.cruise + (this.panic > 0 ? 7 : 0);
      // slow for turns ahead & signals
      let dist = 0; px = v.pos.x; pz = v.pos.z;
      for (let i = this.idx; i < Math.min(this.path.length, this.idx + 14); i++) {
        const p = this.path[i]; dist += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z;
        if (p.turn && dist < 22) vTarget = Math.min(vTarget, this.kind === 'police' && this.mode === 'respond' ? 11 : 6.5 + dist * 0.25);
        if (p.stopAt && dist < 40 && !this.ignoreLights && this.panic <= 0 && !(this.kind === 'police' && this.mode === 'respond')) {
          const st = signalState(p.stopAt.node, p.stopAt.axis, g.time);
          if (st === 'R' || (st === 'Y' && dist > 9 && speed > 2)) vTarget = Math.min(vTarget, Math.sqrt(Math.max(0, 2 * 4.5 * (dist - 1.2))) * (dist < 1.5 ? 0 : 1));
        }
      }
    }
    // obstacle avoidance (vehicles, people)
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    let near = 99; this.blockedBy = null;
    const scan = (ox, oz, halfW, who) => {
      const dx = ox - v.pos.x, dz = oz - v.pos.z; const ah = dx * fx + dz * fz; if (ah < 0 || ah > 26) return;
      const lat = Math.abs(dx * -fz + dz * fx); if (lat > halfW) return;
      const d = ah - v.hz; if (d < near) { near = d; this.blockedBy = who; }
    };
    for (const o of g.vehicles) if (o !== v) scan(o.pos.x, o.pos.z, 1.9 + (Math.abs(Math.sin(o.heading - v.heading)) * 1.2), o);
    if (this.kind !== 'police' || this.mode !== 'pursuit') {
      for (const a of g.actors) if (!a.inVehicle && a.alive && Math.abs(a.pos.x - v.pos.x) < 28 && Math.abs(a.pos.z - v.pos.z) < 28) scan(a.pos.x, a.pos.z, 1.4, a);
    }
    if (near < 99 && !(this.mode === 'pursuit' && this.blockedBy && this.blockedBy.driver === g.player)) {
      vTarget = Math.min(vTarget, Math.max(0, (near - 3.5) * 0.9));
      if (near < 3) vTarget = 0;
    }
    // honk when the player blocks the way
    if (this.kind === 'traffic' && vTarget < 1 && this.blockedBy && (this.blockedBy === g.player || this.blockedBy.driver === g.player)) {
      this.waitT += dt; if (this.waitT > 2.5 && this.honkT <= 0) { g.audio.horn(v); this.honkT = 3 + Math.random() * 3; }
    } else this.waitT = 0;
    if (this.honkT > 0) this.honkT -= dt;
    // steering
    const desired = Math.atan2(tx - v.pos.x, tz - v.pos.z);
    const diff = angleDiff(v.heading, desired);
    v.steer = clamp(diff * 2.4, -1, 1);
    v.handbrake = 0;
    if (this.mode === 'pursuit' && Math.abs(diff) > 1.6 && speed < 6) { // target behind: reverse-turn
      v.allowReverse = true; v.throttle = 0; v.brake = 1; v.steer = -Math.sign(diff); this.vTarget = 0;
      return;
    }
    // speed control
    if (fwdSpeed < vTarget - 0.4) { v.throttle = clamp((vTarget - fwdSpeed) * 0.35, 0.25, 1); v.brake = 0; }
    else if (fwdSpeed > vTarget + 0.6) { v.throttle = 0; v.brake = clamp((fwdSpeed - vTarget) * 0.25, 0.15, 1); }
    else { v.throttle = 0.15; v.brake = 0; }
    if (vTarget < 0.3 && fwdSpeed < 0.6) { v.throttle = 0; v.brake = 0.3; }
    this.vTarget = vTarget;
    // stuck detection
    if (vTarget > 4 && Math.abs(fwdSpeed) < 0.7) { this.stuckT += dt; if (this.stuckT > 2.2) { this.stuckT = 0; this.reverseT = 1.3; this.revSteer = v.steer; } }
    else this.stuckT = Math.max(0, this.stuckT - dt);
  }
}
