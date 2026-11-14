// Pedestrians: walk a sidewalk graph, wait at crossings, sit on benches, react to danger.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { pedCanCross } from './roads.js';
import { clamp, angleDiff, pick } from '../core/utils.js';

const O = L.ROAD_HALF + 2.9;
function buildGraph() {
  const nodes = [], edges = new Map();
  const id = (i, j, sx, sz) => ((j * L.ROADS_X + i) * 4 + (sx > 0 ? 1 : 0) + (sz > 0 ? 2 : 0));
  for (let j = 0; j < L.ROADS_Z; j++) for (let i = 0; i < L.ROADS_X; i++) for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    nodes[id(i, j, sx, sz)] = { id: id(i, j, sx, sz), x: L.roadX(i) + sx * O, z: L.roadZ(j) + sz * O, i, j, sx, sz, inter: L.nodeId(i, j) };
  }
  const link = (a, b, cross) => { if (!edges.has(a)) edges.set(a, []); if (!edges.has(b)) edges.set(b, []); edges.get(a).push({ to: b, cross }); edges.get(b).push({ to: a, cross }); };
  for (let j = 0; j < L.ROADS_Z; j++) for (let i = 0; i < L.ROADS_X; i++) {
    for (const s of [-1, 1]) {
      if (i < L.ROADS_X - 1) link(id(i, j, 1, s), id(i + 1, j, -1, s), null);
      if (j < L.ROADS_Z - 1) link(id(i, j, s, 1), id(i, j + 1, s, -1), null);
      // crossings at this intersection
      const roadNS = j + s >= 0 && j + s < L.ROADS_Z; // crossing along x over the N-S road
      link(id(i, j, -1, s), id(i, j, 1, s), roadNS ? { node: L.nodeId(i, j), axis: 'z' } : null);
      const roadEW = i + s >= 0 && i + s < L.ROADS_X;
      link(id(i, j, s, -1), id(i, j, s, 1), roadEW ? { node: L.nodeId(i, j), axis: 'x' } : null);
    }
  }
  return { nodes, edges };
}

export class Pedestrians {
  constructor(game) {
    this.game = game; this.graph = buildGraph(); this.target = 30; this.spawnT = 0;
    // exclude promenade bottom-most nodes beyond quay? (they're on the promenade, valid)
  }
  get peds() { return this.game.actors.filter((a) => a.ai && a.ai.kind === 'ped'); }
  randomEdgePoint(minD, maxD, avoidView) {
    const g = this.game, pp = g.focusPos(); const nodes = this.graph.nodes;
    for (let tries = 0; tries < 16; tries++) {
      const n = nodes[Math.floor(Math.random() * nodes.length)]; const e = pick(this.graph.edges.get(n.id));
      if (e.cross) continue; const m = nodes[e.to]; const t = Math.random();
      const x = n.x + (m.x - n.x) * t, z = n.z + (m.z - n.z) * t; const d = Math.hypot(x - pp.x, z - pp.z);
      if (d < minD || d > maxD) continue;
      if (avoidView && d < 70 && g.isVisible(x, 1, z, 1)) continue;
      return { x, z, from: n.id, to: m.id };
    }
    return null;
  }
  spawnOne(initial) {
    const p = this.randomEdgePoint(initial ? 8 : 40, initial ? 80 : 95, !initial); if (!p) return null;
    const a = this.game.spawnPed(p.x, p.z);
    a.ai = new PedAI(this, a, p.from, p.to);
    return a;
  }
  update(dt) {
    const g = this.game, pp = g.focusPos();
    const peds = this.peds;
    this.spawnT -= dt;
    if (peds.length < this.target && this.spawnT <= 0) { this.spawnOne(false); this.spawnT = 0.25; }
    for (const a of peds) {
      const d = Math.hypot(a.pos.x - pp.x, a.pos.z - pp.z);
      if (d > 120 || (!a.alive && g.time - a.deadTime > 30 && d > 25)) { g.removeActor(a); continue; }
      a.ai.update(dt, d);
    }
  }
  // danger event
  alarm(pos, radius, kind, source) {
    for (const a of this.peds) {
      if (!a.alive) continue; const d = a.distTo(pos); if (d > radius) continue;
      a.ai.scare(pos, kind, source, d);
    }
  }
}

export class PedAI {
  constructor(sys, actor, from, to) {
    this.sys = sys; this.a = actor; this.kind = 'ped'; this.from = from; this.to = to;
    this.state = 'walk'; this.t = 0; this.speed = 1.15 + Math.random() * 0.4; this.off = (Math.random() - 0.5) * 1.4;
    this.fleeFrom = new THREE.Vector3(); this.waitCross = false; this.bench = null; this.thinkT = Math.random();
    this.lastPos = new THREE.Vector3(); this.stuckT = 0;
  }
  nodePos(id) {
    const n = this.sys.graph.nodes[id];
    // lateral offset toward/away from block interior
    return { x: n.x + n.sx * this.off * 0.6, z: n.z + n.sz * this.off * 0.6 };
  }
  scare(pos, kind, source, d) {
    if (this.state === 'dead') return;
    if (kind === 'aim') { if (this.state !== 'flee') { this.state = 'cower'; this.t = 1.2 + Math.random(); this.fleeFrom.copy(pos); } return; }
    if (this.state === 'sit') this.a.hum.stopOneShot(0.2);
    this.state = 'flee'; this.t = 6 + Math.random() * 6; this.fleeFrom.copy(pos);
  }
  update(dt, distToPlayer) {
    const a = this.a, g = a.game, hum = a.hum;
    if (!a.alive) { a.vel.multiplyScalar(0.9); a.physics(dt); if (distToPlayer < 60) hum.update(dt); return; }
    this.t -= dt; let desired = null, speed = 0, running = false;
    hum.handsUp = Math.max(0, hum.handsUp - dt * 2);
    switch (this.state) {
      case 'walk': {
        const tp = this.nodePos(this.to); const dx = tp.x - a.pos.x, dz = tp.z - a.pos.z; const d = Math.hypot(dx, dz);
        if (this.waitCross) {
          const e = this.sys.graph.edges.get(this.from).find((x) => x.to === this.to);
          if (e && e.cross && !pedCanCross(e.cross.node, e.cross.axis, g.time)) { speed = 0; this.faceTo = Math.atan2(dx, dz); break; }
          this.waitCross = false;
        }
        if (d < 0.8) {
          // choose next edge
          const opts = this.sys.graph.edges.get(this.to).filter((e) => e.to !== this.from);
          const e = opts.length ? pick(opts) : this.sys.graph.edges.get(this.to)[0];
          this.from = this.to; this.to = e.to; this.waitCross = !!e.cross;
          if (Math.random() < 0.08) { this.state = 'idle'; this.t = 3 + Math.random() * 6; }
          else if (Math.random() < 0.25) this.tryBench();
          break;
        }
        desired = Math.atan2(dx, dz); speed = this.speed;
        break;
      }
      case 'idle': if (this.t <= 0) this.state = 'walk'; break;
      case 'toBench': {
        const b = this.bench; const dx = b.x - a.pos.x, dz = b.z - a.pos.z; const d = Math.hypot(dx, dz);
        if (d < 0.6 || this.t <= 0) { if (d < 1.2) { this.state = 'sit'; this.t = 12 + Math.random() * 20; a.pos.x = b.x + Math.sin(b.yaw) * 0.25; a.pos.z = b.z + Math.cos(b.yaw) * 0.25; a.heading = b.yaw; hum.play('Sitting', { hold: true, timeScale: 1 }); hum.actions.Sitting.time = 1.8; } else this.state = 'walk'; break; }
        desired = Math.atan2(dx, dz); speed = this.speed; break;
      }
      case 'sit': {
        a.vel.set(0, 0, 0);
        if (this.t <= 0) { hum.stopOneShot(0.4); this.bench.used = false; this.bench = null; this.state = 'walk'; }
        break;
      }
      case 'cower': hum.handsUp = Math.min(1, hum.handsUp + dt * 6); this.faceTo = Math.atan2(this.fleeFrom.x - a.pos.x, this.fleeFrom.z - a.pos.z); if (this.t <= 0) { this.state = 'flee'; this.t = 6 + Math.random() * 4; } break;
      case 'flee': {
        const dx = a.pos.x - this.fleeFrom.x, dz = a.pos.z - this.fleeFrom.z;
        desired = Math.atan2(dx, dz) + Math.sin(g.time * 0.7 + a.id) * 0.5; speed = 4.6; running = true;
        if (a.blocked) { this.fleeDev = (this.fleeDev || 0) + dt * 2; desired += this.fleeDev; }
        if (this.t <= 0) { this.state = 'recover'; }
        break;
      }
      case 'recover': {
        // walk back to nearest sidewalk node
        let best = null, bd = Infinity; for (const n of this.sys.graph.nodes) { const d = Math.hypot(n.x - a.pos.x, n.z - a.pos.z); if (d < bd) { bd = d; best = n; } }
        const opts = this.sys.graph.edges.get(best.id).filter((e) => !e.cross);
        this.from = opts.length ? pick(opts).to : best.id; this.to = best.id; this.state = 'walk'; this.waitCross = false;
        break;
      }
    }
    if (desired !== null) {
      // simple separation from other actors
      a.heading = a.heading + angleDiff(a.heading, desired) * Math.min(1, dt * 6);
      a.vel.x = Math.sin(a.heading) * speed; a.vel.z = Math.cos(a.heading) * speed;
    } else { a.vel.x *= 0.8; a.vel.z *= 0.8; if (this.faceTo !== undefined) a.heading += angleDiff(a.heading, this.faceTo) * Math.min(1, dt * 4); }
    if (this.state !== 'sit') a.physics(dt); else { a.hum.root.rotation.y = a.heading; a.pos.y = L.groundHeight(a.pos.x, a.pos.z); }
    // stuck handling while walking
    if (this.state === 'walk' && speed > 0) {
      if (a.blocked) { this.stuckT += dt; if (this.stuckT > 2.5) { this.stuckT = 0; const t = this.to; this.to = this.from; this.from = t; } }
      else this.stuckT = 0;
    }
    if (distToPlayer < 70) { hum.setLocomotion(Math.hypot(a.vel.x, a.vel.z), dt, running); hum.update(dt); hum.setShadow(distToPlayer < 35); }
    hum.root.visible = distToPlayer < 95;
  }
  tryBench() {
    const g = this.a.game; const bs = g.city.data.benches;
    let best = null, bd = 14;
    for (const b of bs) { if (b.used) continue; const d = Math.hypot(b.x - this.a.pos.x, b.z - this.a.pos.z); if (d < bd) { bd = d; best = b; } }
    if (best) { best.used = true; this.bench = best; this.state = 'toBench'; this.t = 15; }
  }
}
