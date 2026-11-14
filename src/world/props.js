// Street furniture & landscape props built from batched primitives.
import * as THREE from 'three';
import { rng } from '../core/utils.js';

const C = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// Deciduous street tree: trunk + clustered crown (low poly, vertex colored)
export function tree(bs, x, y, z, r, scale = 1) {
  const trunk = bs.get('bark'), crown = bs.get('foliage');
  const h = (3.2 + r() * 1.6) * scale;
  trunk.cyl(x, y, z, 0.16 * scale, 0.11 * scale, h, 7, 1, C('#5a4636'), false);
  const greens = ['#4f7d2f', '#5c8a34', '#3f6d2a', '#6b9440', '#557a2d'];
  const n = 5 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = (0.4 + r() * 0.9) * scale;
    const cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d, cy = y + h + (r() - 0.2) * 1.4 * scale;
    blob(crown, cx, cy, cz, (1.1 + r() * 0.8) * scale, C(greens[Math.floor(r() * greens.length)]), r);
  }
  blob(crown, x, y + h + 1.0 * scale, z, 1.5 * scale, C('#5a8834'), r);
}

// Icosahedron-ish blob with jittered vertices
const ico = new THREE.IcosahedronGeometry(1, 1);
export function blob(batch, x, y, z, rad, color, r) {
  const g = ico; const pos = g.attributes.position;
  const v = [];
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const k = 0.85 + ((Math.sin(px * 12.9 + py * 78.2 + pz * 37.7 + x) * 43758.5) % 1 + 1) % 1 * 0.3;
    v.push([x + px * rad * k, y + py * rad * 0.8 * k, z + pz * rad * k]);
  }
  for (let i = 0; i < pos.count; i += 3) {
    const shade = 0.85 + (v[i][1] - y) / rad * 0.15;
    batch.tri(v[i], v[i + 1], v[i + 2], [color[0] * shade, color[1] * shade, color[2] * shade]);
  }
}

// Palm tree: curved segmented trunk + frond planes (leaf texture)
export function palm(bs, x, y, z, r) {
  const trunk = bs.get('bark'), fr = bs.get('leaf');
  const h = 7 + r() * 4, lean = (r() - 0.5) * 0.25, la = r() * Math.PI * 2;
  const seg = 9; let px = x, pz = z, py = y;
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg;
    const off0 = Math.pow(t0, 2) * h * lean, off1 = Math.pow(t1, 2) * h * lean;
    const x0 = x + Math.cos(la) * off0, z0 = z + Math.sin(la) * off0, x1 = x + Math.cos(la) * off1, z1 = z + Math.sin(la) * off1;
    const r0 = 0.24 - t0 * 0.08, r1 = 0.24 - t1 * 0.08;
    // ring segment
    const sg = 7;
    for (let k = 0; k < sg; k++) {
      const a0 = k / sg * Math.PI * 2, a1 = (k + 1) / sg * Math.PI * 2;
      const shade = i % 2 ? 0.85 : 1;
      trunk.quad([x0 + Math.sin(a0) * r0, y + t0 * h, z0 + Math.cos(a0) * r0], [x0 + Math.sin(a1) * r0, y + t0 * h, z0 + Math.cos(a1) * r0],
        [x1 + Math.sin(a1) * r1, y + t1 * h, z1 + Math.cos(a1) * r1], [x1 + Math.sin(a0) * r1, y + t1 * h, z1 + Math.cos(a0) * r1], [0, 0, 1, 0, 1, 1, 0, 1], C(shade > 0.9 ? '#8a7457' : '#76624a'));
    }
    px = x1; pz = z1; py = y + t1 * h;
  }
  // fronds
  const nf = 9;
  for (let i = 0; i < nf; i++) {
    const a = (i / nf) * Math.PI * 2 + r() * 0.3, L = 3.4 + r() * 1.2, w = 0.7;
    const droop = 0.6 + r() * 0.6;
    const dx = Math.cos(a), dz = Math.sin(a), sx = -dz, sz = dx;
    const segs = 4;
    for (let k = 0; k < segs; k++) {
      const t0 = k / segs, t1 = (k + 1) / segs;
      const y0 = py + Math.sin(t0 * 1.2) * 0.9 - t0 * t0 * L * droop, y1 = py + Math.sin(t1 * 1.2) * 0.9 - t1 * t1 * L * droop;
      const p0 = [px + dx * t0 * L, y0, pz + dz * t0 * L], p1 = [px + dx * t1 * L, y1, pz + dz * t1 * L];
      fr.quad([p0[0] - sx * w, p0[1], p0[2] - sz * w], [p1[0] - sx * w, p1[1], p1[2] - sz * w], [p1[0] + sx * w, p1[1], p1[2] + sz * w], [p0[0] + sx * w, p0[1], p0[2] + sz * w],
        [t0, 0, t1, 0, t1, 1, t0, 1], C('#ffffff'));
    }
  }
  return h;
}

export function bench(bs, x, y, z, yaw) {
  const w = bs.get('wood'), m = bs.get('metal');
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  for (let i = 0; i < 3; i++) { const [px, pz] = P(0, -0.15 + i * 0.16); w.obox(px, y + 0.45, pz, 0.85, 0.025, 0.06, yaw, 1, C('#8b5a33')); }
  for (let i = 0; i < 2; i++) { const [px, pz] = P(0, -0.27); w.obox(px, y + 0.65 + i * 0.16, pz, 0.85, 0.05, 0.02, yaw, 1, C('#8b5a33')); }
  for (const lx of [-0.7, 0.7]) { const [px, pz] = P(lx, -0.05); m.obox(px, y + 0.23, pz, 0.03, 0.23, 0.22, yaw, 1, C('#2a2d30')); const [qx, qz] = P(lx, -0.28); m.obox(qx, y + 0.55, qz, 0.03, 0.3, 0.03, yaw, 1, C('#2a2d30')); }
}

export function trashBin(bs, x, y, z) {
  const m = bs.get('metal'); m.cyl(x, y, z, 0.28, 0.3, 0.9, 10, 1, C('#2e4a3a')); m.cyl(x, y + 0.9, z, 0.32, 0.2, 0.08, 10, 1, C('#1f2a24'));
}
export function hydrant(bs, x, y, z) {
  const m = bs.get('paint'); m.cyl(x, y, z, 0.16, 0.14, 0.6, 8, 1, C('#c8321e')); m.cyl(x, y + 0.6, z, 0.14, 0.02, 0.18, 8, 1, C('#c8321e'));
  m.obox(x, y + 0.42, z, 0.24, 0.05, 0.05, 0, 1, C('#b02a18'));
}
export function newsBox(bs, x, y, z, yaw, color) { const m = bs.get('paint'); m.obox(x, y + 0.55, z, 0.25, 0.55, 0.22, yaw, 1, C(color)); m.obox(x, y + 0.85, z, 0.2, 0.12, 0.23, yaw, 1, C('#dfe8ee')); }
export function planter(bs, x, y, z, r) {
  const c = bs.get('concrete'); c.box(x - 0.6, y, z - 0.6, x + 0.6, y + 0.5, z + 0.6, 1, C('#b8b2a6'));
  const f = bs.get('foliage'); for (let i = 0; i < 4; i++) blob(f, x + (r() - 0.5) * 0.6, y + 0.7, z + (r() - 0.5) * 0.6, 0.45, C(['#4f7d2f', '#6c9a3c', '#c0566e', '#e6b23a'][i % 4]), r);
}

export function busStop(bs, x, y, z, yaw) {
  const m = bs.get('metal'), g = bs.get('glass'), p = bs.get('paint');
  const c = Math.cos(yaw), s = Math.sin(yaw); const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  for (const lx of [-1.8, 1.8]) { const [px, pz] = P(lx, -0.6); m.obox(px, y + 1.25, pz, 0.05, 1.25, 0.05, yaw, 1, C('#3a3f44')); }
  const [rx, rz] = P(0, 0); m.obox(rx, y + 2.55, rz, 2.0, 0.06, 0.9, yaw, 1, C('#2d3237'));
  const [bx, bz] = P(0, -0.65); g.obox(bx, y + 1.3, bz, 1.8, 1.0, 0.02, yaw, 1, C('#9fc3d6'));
  const [ax, az] = P(-1.85, 0); p.obox(ax, y + 1.25, az, 0.04, 0.9, 0.55, yaw, 1, C('#2ec4b6'));
  const [sx, sz] = P(0, -0.35); bs.get('wood').obox(sx, y + 0.5, sz, 1.4, 0.04, 0.2, yaw, 1, C('#7b5a3a'));
}

// Procedural traffic light: pole + arm + housing. Returns bulb positions [{x,y,z, color}]
export function trafficLight(bs, x, y, z, yaw, armLen) {
  const m = bs.get('metal');
  const c = Math.cos(yaw), s = Math.sin(yaw); const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  m.cyl(x, y, z, 0.13, 0.11, 5.6, 8, 1, C('#33383d'));
  // arm extends along local +x (or -x when armLen is negative)
  const L = Math.abs(armLen), sg = Math.sign(armLen) || 1;
  const [ax, az] = P(sg * L / 2, 0); m.obox(ax, y + 5.4, az, L / 2, 0.07, 0.07, yaw, 1, C('#33383d'));
  const [hx, hz] = P(sg * (L - 0.4), 0);
  m.obox(hx, y + 4.75, hz, 0.22, 0.62, 0.18, yaw, 1, C('#1d2124'));
  // backplate
  m.obox(hx, y + 4.75, hz - 0.0, 0.32, 0.72, 0.03, yaw, 1, C('#111315'));
  const bulbs = [];
  const fz = 0.2; // bulbs face local +z
  const [bx, bz] = P(sg * (L - 0.4), fz);
  bulbs.push({ x: bx, y: y + 5.15, z: bz, k: 'R' }, { x: bx, y: y + 4.75, z: bz, k: 'Y' }, { x: bx, y: y + 4.35, z: bz, k: 'G' });
  // pedestrian box on pole
  const [qx, qz] = P(-0.18 * sg, 0.0); m.obox(qx, y + 2.6, qz, 0.12, 0.18, 0.12, yaw, 1, C('#1d2124'));
  return bulbs;
}

export function streetLampBulbPos(x, y, z, yaw) {
  return { x: x + Math.sin(yaw) * 1.6, y: y + 6.15, z: z + Math.cos(yaw) * 1.6 };
}

// Shipping container (corrugated look via material map), with door details
export function container(bs, x, y, z, yaw, color, len = 6.1) {
  const b = bs.get('container');
  b.obox(x, y + 1.3, z, len / 2, 1.3, 1.22, yaw, 2.6, C(color));
  const m = bs.get('metal'); const c = Math.cos(yaw), s = Math.sin(yaw);
  // corner posts
  for (const lx of [-len / 2, len / 2]) for (const lz of [-1.22, 1.22]) m.obox(x + lx * c + lz * s, y + 1.3, z - lx * s + lz * c, 0.06, 1.31, 0.06, yaw, 1, C('#2a2a2a'));
}

export function gantryCrane(bs, x, y, z, yaw, r) {
  const p = bs.get('paint');
  const col = C('#e2a12b'), dark = C('#3a3a3a');
  const c = Math.cos(yaw), s = Math.sin(yaw); const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  for (const lx of [-9, 9]) for (const lz of [-5, 5]) { const [px, pz] = P(lx, lz); p.obox(px, y + 14, pz, 0.5, 14, 0.5, yaw, 1, col); }
  for (const lz of [-5, 5]) { const [px, pz] = P(0, lz); p.obox(px, y + 28.5, pz, 11, 0.7, 0.5, yaw, 1, col); }
  for (const lx of [-9, 9]) { const [px, pz] = P(lx, 0); p.obox(px, y + 1.2, pz, 0.8, 0.6, 6, yaw, 1, dark); p.obox(px, y + 20, pz, 0.35, 0.35, 5, yaw, 1, col); }
  // boom out over water
  const [bx, bz] = P(0, 14); p.obox(bx, y + 29.5, bz, 1.2, 0.6, 22, yaw, 1, col);
  const [tx, tz] = P(0, -3); p.obox(tx, y + 31.5, tz, 2.5, 1.6, 3, yaw, 1, C('#d0d4d8'));
  const [cx, cz] = P(0, 12); p.obox(cx, y + 26.5, cz, 1.4, 0.8, 1.8, yaw, 1, dark);
}

export function boat(bs, x, y, z, yaw, r, len = 9) {
  const p = bs.get('paint');
  const hull = C(r() < 0.5 ? '#f3f1ea' : '#2c4a6b');
  const c = Math.cos(yaw), s = Math.sin(yaw); const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  // hull as tapered stack
  for (let i = 0; i < 4; i++) { const t = i / 4; const [px, pz] = P(0, 0); p.obox(px, y + 0.2 + i * 0.25, pz, 1.1 + t * 0.5, 0.13, len / 2 * (0.82 + t * 0.18), yaw, 1, hull); }
  const [bx, bz] = P(0, len * 0.42); p.obox(bx, y + 0.9, bz, 0.9, 0.3, 0.6, yaw, 1, hull);
  const [cx, cz] = P(0, -len * 0.1); p.obox(cx, y + 1.7, cz, 1.0, 0.55, len * 0.18, yaw, 1, C('#e8e8e2'));
  bs.get('glass').obox(cx, y + 1.9, cz, 1.02, 0.25, len * 0.17, yaw, 1, C('#3e5a6a'));
  const [mx, mz] = P(0, -len * 0.05); bs.get('metal').obox(mx, y + 3.2, mz, 0.04, 1.2, 0.04, yaw, 1, C('#cccccc'));
}

export function fountain(bs, x, y, z) {
  const c = bs.get('concrete');
  const rim = C('#d6cfc2');
  const seg = 24;
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    for (const [rr, h] of [[6, 0.6], [5.6, 0.6]]) {
      // ring wall
      const p0 = [x + Math.sin(a0) * rr, y, z + Math.cos(a0) * rr], p1 = [x + Math.sin(a1) * rr, y, z + Math.cos(a1) * rr];
      const q0 = [p0[0], y + h, p0[2]], q1 = [p1[0], y + h, p1[2]];
      if (rr === 6) c.quad(p0, p1, q1, q0, [0, 0, 1, 0, 1, 1, 0, 1], rim); else c.quad(p1, p0, q0, q1, [0, 0, 1, 0, 1, 1, 0, 1], rim);
    }
    const a = [x + Math.sin(a0) * 6, y + 0.6, z + Math.cos(a0) * 6], b = [x + Math.sin(a1) * 6, y + 0.6, z + Math.cos(a1) * 6];
    const a2 = [x + Math.sin(a0) * 5.6, y + 0.6, z + Math.cos(a0) * 5.6], b2 = [x + Math.sin(a1) * 5.6, y + 0.6, z + Math.cos(a1) * 5.6];
    c.quad(a2, b2, b, a, [0, 0, 1, 0, 1, 1, 0, 1], rim);
  }
  c.cyl(x, y, z, 1.2, 0.8, 1.6, 16, 1, rim);
  c.cyl(x, y + 1.6, z, 2.4, 2.2, 0.3, 20, 1, rim);
  c.cyl(x, y + 1.9, z, 0.35, 0.3, 1.2, 10, 1, rim);
  c.cyl(x, y + 3.1, z, 1.1, 1.0, 0.2, 16, 1, rim);
}

export function stall(bs, x, y, z, yaw, color, r) {
  const w = bs.get('wood'), p = bs.get('paint');
  const c = Math.cos(yaw), s = Math.sin(yaw); const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  w.obox(x, y + 0.45, z, 1.4, 0.45, 0.7, yaw, 1, C('#8a6a48'));
  for (const lx of [-1.35, 1.35]) for (const lz of [-0.65, 0.65]) { const [px, pz] = P(lx, lz); w.obox(px, y + 1.25, pz, 0.04, 1.25, 0.04, yaw, 1, C('#6b5036')); }
  const [tx, tz] = P(0, 0.1); p.obox(tx, y + 2.5, tz, 1.6, 0.06, 1.0, yaw, 1, C(color));
  // goods
  const goods = ['#e85d3a', '#f2c94c', '#6fcf97', '#bb6bd9', '#f2994a', '#56ccf2'];
  for (let i = 0; i < 6; i++) { const [gx, gz] = P(-1.1 + i * 0.44, 0.2); p.obox(gx, y + 0.98, gz, 0.18, 0.08, 0.3, yaw, 1, C(goods[Math.floor(r() * goods.length)])); }
}

export function fenceLine(bs, x0, z0, x1, z1, y, h = 2.2) {
  const m = bs.get('metal'); const L = Math.hypot(x1 - x0, z1 - z0); const n = Math.max(1, Math.round(L / 3));
  for (let i = 0; i <= n; i++) { const t = i / n; m.cyl(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, 0.05, 0.05, h, 6, 1, C('#7d868c'), false); }
  const f = bs.get('fence'); const yaw = Math.atan2(x1 - x0, z1 - z0);
  f.obox((x0 + x1) / 2, y + h / 2, (z0 + z1) / 2, 0.01, h / 2 - 0.05, L / 2, yaw, 1, C('#ffffff'));
}

export function railing(bs, x0, z0, x1, z1, y) {
  const m = bs.get('metal'); const L = Math.hypot(x1 - x0, z1 - z0); const n = Math.max(1, Math.round(L / 2));
  const yaw = Math.atan2(x1 - x0, z1 - z0);
  for (let i = 0; i <= n; i++) { const t = i / n; m.cyl(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, 0.04, 0.04, 1.05, 6, 1, C('#d9d9d4'), false); }
  m.obox((x0 + x1) / 2, y + 1.05, (z0 + z1) / 2, 0.05, 0.04, L / 2, yaw, 1, C('#e6e6e0'));
  m.obox((x0 + x1) / 2, y + 0.55, (z0 + z1) / 2, 0.02, 0.02, L / 2, yaw, 1, C('#d0d0ca'));
}

export function acUnit(bs, x, y, z, r) { const m = bs.get('metal'); m.box(x - 0.7, y, z - 0.5, x + 0.7, y + 0.9, z + 0.5, 1, C('#b9bdc0')); m.cyl(x, y + 0.9, z, 0.38, 0.38, 0.05, 10, 1, C('#55595c')); }
export function waterTank(bs, x, y, z) {
  const w = bs.get('wood'), m = bs.get('metal');
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.box(x + dx * 1.1 - 0.06, y, z + dz * 1.1 - 0.06, x + dx * 1.1 + 0.06, y + 2.2, z + dz * 1.1 + 0.06, 1, C('#3b3b3b'));
  w.cyl(x, y + 2.2, z, 1.6, 1.6, 2.8, 14, 1, C('#7b5b3e'));
  w.cyl(x, y + 5.0, z, 1.7, 0.2, 1.0, 14, 1, C('#4a3a2c'));
}
