// Small geometry batching helpers: accumulate quads/boxes into one BufferGeometry per material.
import * as THREE from 'three';

export class Batch {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  quad(p0, p1, p2, p3, uv, color = [1, 1, 1]) {
    // p0..p3 counter-clockwise when seen from the front
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let i = 0; i < 4; i++) {
      const p = [p0, p1, p2, p3][i]; this.pos.push(p[0], p[1], p[2]); this.nor.push(nx, ny, nz);
      this.uv.push(uv[i * 2], uv[i * 2 + 1]); this.col.push(color[0], color[1], color[2]);
    }
    const b = this.n; this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3); this.n += 4;
  }
  // vertical wall from (x0,z0) to (x1,z1); front faces the side where normal = (dz, -dx) normalized
  wall(x0, z0, x1, z1, y0, y1, u0, u1, v0, v1, color) {
    this.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], [u0, v0, u1, v0, u1, v1, u0, v1], color);
  }
  // horizontal rect facing up
  top(x0, z0, x1, z1, y, s = 1, color, ou = 0, ov = 0) {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [x0 / s + ou, -z1 / s + ov, x1 / s + ou, -z1 / s + ov, x1 / s + ou, -z0 / s + ov, x0 / s + ou, -z0 / s + ov], color);
  }
  bottom(x0, z0, x1, z1, y, s = 1, color) {
    this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [x0 / s, z0 / s, x1 / s, z0 / s, x1 / s, z1 / s, x0 / s, z1 / s], color);
  }
  // axis aligned box with world-scaled UVs
  box(x0, y0, z0, x1, y1, z1, s = 1, color, { top = true, bottom = false, sides = true } = {}) {
    if (sides) {
      this.wall(x0, z1, x1, z1, y0, y1, x0 / s, x1 / s, y0 / s, y1 / s, color); // south (+z)
      this.wall(x1, z0, x0, z0, y0, y1, -x1 / s, -x0 / s, y0 / s, y1 / s, color); // north (-z)
      this.wall(x1, z1, x1, z0, y0, y1, -z1 / s, -z0 / s, y0 / s, y1 / s, color); // east (+x)
      this.wall(x0, z0, x0, z1, y0, y1, z0 / s, z1 / s, y0 / s, y1 / s, color); // west (-x)
    }
    if (top) this.top(x0, z0, x1, z1, y1, s, color);
    if (bottom) this.bottom(x0, z0, x1, z1, y0, s, color);
  }
  // rotated box around center (cx,cz) with yaw
  obox(cx, cy, cz, hx, hy, hz, yaw, s = 1, color) {
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const P = (lx, ly, lz) => [cx + lx * c + lz * sn, cy + ly, cz - lx * sn + lz * c];
    const v = [P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz)];
    const uvW = (w, h) => [0, 0, w / s, 0, w / s, h / s, 0, h / s];
    this.quad(v[0], v[1], v[2], v[3], uvW(hx * 2, hy * 2), color);
    this.quad(v[4], v[5], v[6], v[7], uvW(hx * 2, hy * 2), color);
    this.quad(v[1], v[4], v[7], v[2], uvW(hz * 2, hy * 2), color);
    this.quad(v[5], v[0], v[3], v[6], uvW(hz * 2, hy * 2), color);
    this.quad(v[3], v[2], v[7], v[6], uvW(hx * 2, hz * 2), color);
    this.quad(v[5], v[4], v[1], v[0], uvW(hx * 2, hz * 2), color);
  }
  // cylinder (vertical)
  cyl(cx, y0, cz, r0, r1, h, seg = 10, s = 1, color, caps = true) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [cx + Math.sin(a0) * r0, y0, cz + Math.cos(a0) * r0], p1 = [cx + Math.sin(a1) * r0, y0, cz + Math.cos(a1) * r0];
      const p2 = [cx + Math.sin(a1) * r1, y0 + h, cz + Math.cos(a1) * r1], p3 = [cx + Math.sin(a0) * r1, y0 + h, cz + Math.cos(a0) * r1];
      this.quad(p0, p1, p2, p3, [i / seg * 3, y0 / s, (i + 1) / seg * 3, y0 / s, (i + 1) / seg * 3, (y0 + h) / s, i / seg * 3, (y0 + h) / s], color);
      if (caps && r1 > 0) this.tri([cx, y0 + h, cz], p3, p2, color);
    }
  }
  tri(a, b, c, color = [1, 1, 1]) {
    const ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2], bx = c[0] - a[0], by = c[1] - a[1], bz = c[2] - a[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1;
    for (const p of [a, b, c]) { this.pos.push(...p); this.nor.push(nx / l, ny / l, nz / l); this.uv.push(p[0] * 0.25, p[2] * 0.25); this.col.push(...color); }
    this.idx.push(this.n, this.n + 1, this.n + 2); this.n += 3;
  }
  // append an existing geometry (non-indexed or indexed) with a matrix
  geometry(geo, matrix, color = [1, 1, 1]) {
    const g = geo.index ? geo : geo;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, col = g.attributes.color;
    const v = new THREE.Vector3(), nn = new THREE.Vector3(); const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const base = this.n;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix); this.pos.push(v.x, v.y, v.z);
      if (nor) { nn.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); this.nor.push(nn.x, nn.y, nn.z); } else this.nor.push(0, 1, 0);
      if (uv) this.uv.push(uv.getX(i), uv.getY(i)); else this.uv.push(0, 0);
      if (col) this.col.push(col.getX(i) * color[0], col.getY(i) * color[1], col.getZ(i) * color[2]); else this.col.push(color[0], color[1], color[2]);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) this.idx.push(base + i);
    this.n += pos.count;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  get empty() { return this.n === 0; }
}

// Group of batches keyed by material name
export class BatchSet {
  constructor() { this.map = new Map(); }
  get(key) { let b = this.map.get(key); if (!b) { b = new Batch(); this.map.set(key, b); } return b; }
  toMeshes(materials, parent, { castShadow = true, receiveShadow = true } = {}) {
    const out = [];
    for (const [k, b] of this.map) {
      if (b.empty) continue;
      const m = new THREE.Mesh(b.build(), materials[k]);
      m.castShadow = castShadow && !(materials[k].userData && materials[k].userData.noShadow);
      m.receiveShadow = receiveShadow; m.name = k; m.matrixAutoUpdate = false; m.updateMatrix();
      parent.add(m); out.push(m);
    }
    return out;
  }
}
