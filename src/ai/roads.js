// Lane geometry and traffic signal timing shared by traffic, police and pedestrians.
import * as L from '../world/layout.js';

export const STOP_DIST = L.ROAD_HALF + 4.2;
export const SIGNAL_PERIOD = 26;

// state of the light for traffic moving along `axis` ('x' or 'z') at node id
export function signalState(id, axis, t) {
  if (!L.SIGNALIZED(id)) return 'G';
  const off = ((id * 7.3) % SIGNAL_PERIOD);
  const p = (t + off) % SIGNAL_PERIOD;
  // x: green 0-10, yellow 10-12.5, red after; z: green 13-23, yellow 23-25.5
  if (axis === 'x') return p < 10 ? 'G' : p < 12.5 ? 'Y' : 'R';
  return p >= 13 && p < 23 ? 'G' : p >= 23 && p < 25.5 ? 'Y' : 'R';
}
// pedestrians crossing a road that runs along `roadAxis` may walk when that road's traffic is red
export function pedCanCross(id, roadAxis, t) { return signalState(id, roadAxis, t) === 'R'; }

// lane polyline for edge a->b (right-hand traffic). returns {p0, p1, dir:{x,z}, right:{x,z}, axis}
export function laneOf(a, b) {
  const A = L.nodePos(a), B = L.nodePos(b);
  const dx = Math.sign(B.x - A.x), dz = Math.sign(B.z - A.z);
  const rx = -dz, rz = dx;
  const off = L.LANE_OFF;
  return {
    a, b, axis: dx !== 0 ? 'x' : 'z', dir: { x: dx, z: dz }, right: { x: rx, z: rz },
    p0: { x: A.x + dx * STOP_DIST + rx * off, z: A.z + dz * STOP_DIST + rz * off },
    p1: { x: B.x - dx * STOP_DIST + rx * off, z: B.z - dz * STOP_DIST + rz * off },
  };
}
// points of a turn through node b from lane (a->b) into lane (b->c)
export function turnPoints(a, b, c, step = 1.5) {
  const l1 = laneOf(a, b), l2 = laneOf(b, c);
  const p0 = l1.p1, p2 = l2.p0;
  let ctrl;
  if (l1.axis === l2.axis) ctrl = { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 };
  else ctrl = l1.axis === 'x' ? { x: p2.x, z: p0.z } : { x: p0.x, z: p2.z };
  const len = Math.hypot(p2.x - p0.x, p2.z - p0.z); const n = Math.max(3, Math.ceil(len / step));
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push({ x: u * u * p0.x + 2 * u * t * ctrl.x + t * t * p2.x, z: u * u * p0.z + 2 * u * t * ctrl.z + t * t * p2.z, turn: l1.axis !== l2.axis, node: b });
  }
  return pts;
}
export function lanePoints(a, b, step = 4) {
  const l = laneOf(a, b); const len = Math.hypot(l.p1.x - l.p0.x, l.p1.z - l.p0.z); const n = Math.max(1, Math.ceil(len / step));
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push({ x: l.p0.x + (l.p1.x - l.p0.x) * t, z: l.p0.z + (l.p1.z - l.p0.z) * t, node: null }); }
  pts[pts.length - 1].stopAt = { node: b, axis: l.axis };
  return pts;
}
export function chooseNext(prev, cur, rnd = Math.random) {
  const nb = L.nodeNeighbors(cur).filter((n) => n !== prev);
  if (!nb.length) return prev;
  // prefer straight a bit
  const P = L.nodePos(prev), C = L.nodePos(cur);
  const dx = Math.sign(C.x - P.x), dz = Math.sign(C.z - P.z);
  const straight = nb.find((n) => { const N = L.nodePos(n); return Math.sign(N.x - C.x) === dx && Math.sign(N.z - C.z) === dz; });
  if (straight !== undefined && rnd() < 0.5) return straight;
  return nb[Math.floor(rnd() * nb.length)];
}
// nearest lane (edge) to a world point, with projection
export function nearestLane(x, z) {
  let best = null, bd = Infinity;
  for (let id = 0; id < L.NODE_COUNT; id++) for (const nb of L.nodeNeighbors(id)) {
    const l = laneOf(id, nb);
    const vx = l.p1.x - l.p0.x, vz = l.p1.z - l.p0.z; const len2 = vx * vx + vz * vz;
    let t = ((x - l.p0.x) * vx + (z - l.p0.z) * vz) / len2; t = Math.max(0, Math.min(1, t));
    const px = l.p0.x + vx * t, pz = l.p0.z + vz * t; const d = Math.hypot(px - x, pz - z);
    if (d < bd) { bd = d; best = { a: id, b: nb, t, x: px, z: pz, d, lane: l }; }
  }
  return best;
}
