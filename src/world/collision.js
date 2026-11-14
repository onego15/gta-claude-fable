// Static collision world: axis aligned boxes and vertical cylinders in a uniform hash grid.
// Used by characters, vehicles, cameras, bullets and AI line of sight.

const CELL = 16;

export class StaticWorld {
  constructor() {
    this.boxes = [];     // {minX,maxX,minZ,maxZ,minY,maxY, tag}
    this.cyls = [];      // {x,z,r,h, tag}
    this.grid = new Map();
    this._stamp = 0;
  }
  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  _insert(obj, minX, maxX, minZ, maxZ) {
    const c0 = Math.floor(minX / CELL), c1 = Math.floor(maxX / CELL);
    const r0 = Math.floor(minZ / CELL), r1 = Math.floor(maxZ / CELL);
    for (let cx = c0; cx <= c1; cx++) for (let cz = r0; cz <= r1; cz++) {
      const k = this._key(cx, cz);
      let a = this.grid.get(k); if (!a) { a = []; this.grid.set(k, a); }
      a.push(obj);
    }
  }
  addBox(minX, maxX, minZ, maxZ, minY = 0, maxY = 30, tag = 'wall') {
    const b = { type: 0, minX, maxX, minZ, maxZ, minY, maxY, tag, _s: 0 };
    this.boxes.push(b); this._insert(b, minX, maxX, minZ, maxZ); return b;
  }
  addCyl(x, z, r, h = 3, tag = 'pole') {
    const c = { type: 1, x, z, r, h, tag, _s: 0 };
    this.cyls.push(c); this._insert(c, x - r, x + r, z - r, z + r); return c;
  }
  query(minX, maxX, minZ, maxZ, out = []) {
    out.length = 0; const s = ++this._stamp;
    const c0 = Math.floor(minX / CELL), c1 = Math.floor(maxX / CELL);
    const r0 = Math.floor(minZ / CELL), r1 = Math.floor(maxZ / CELL);
    for (let cx = c0; cx <= c1; cx++) for (let cz = r0; cz <= r1; cz++) {
      const a = this.grid.get(this._key(cx, cz)); if (!a) continue;
      for (const o of a) { if (o._s !== s) { o._s = s; out.push(o); } }
    }
    return out;
  }

  // Push a circle (x,z,r) out of static geometry. y range for height filtering. Returns {x,z,hit,nx,nz}
  resolveCircle(x, z, r, y0 = 0, y1 = 2, res = { x: 0, z: 0, hit: false, nx: 0, nz: 0 }) {
    res.hit = false; res.nx = 0; res.nz = 0;
    const list = this.query(x - r - 1, x + r + 1, z - r - 1, z + r + 1, this._tmp || (this._tmp = []));
    for (let iter = 0; iter < 2; iter++) {
      for (const o of list) {
        if (o.type === 0) {
          if (y1 < o.minY || y0 > o.maxY) continue;
          const cx = Math.max(o.minX, Math.min(x, o.maxX)), cz = Math.max(o.minZ, Math.min(z, o.maxZ));
          let dx = x - cx, dz = z - cz; const d2 = dx * dx + dz * dz;
          if (d2 < r * r) {
            if (d2 > 1e-8) {
              const d = Math.sqrt(d2), p = r - d; dx /= d; dz /= d; x += dx * p; z += dz * p;
              res.nx = dx; res.nz = dz;
            } else {
              // center inside box: push out along smallest axis
              const pl = x - o.minX, pr = o.maxX - x, pt = z - o.minZ, pb = o.maxZ - z;
              const m = Math.min(pl, pr, pt, pb);
              if (m === pl) { x = o.minX - r; res.nx = -1; res.nz = 0; }
              else if (m === pr) { x = o.maxX + r; res.nx = 1; res.nz = 0; }
              else if (m === pt) { z = o.minZ - r; res.nx = 0; res.nz = -1; }
              else { z = o.maxZ + r; res.nx = 0; res.nz = 1; }
            }
            res.hit = true;
          }
        } else {
          if (y0 > o.h) continue;
          let dx = x - o.x, dz = z - o.z; const rr = r + o.r, d2 = dx * dx + dz * dz;
          if (d2 < rr * rr && d2 > 1e-8) {
            const d = Math.sqrt(d2); dx /= d; dz /= d; x = o.x + dx * rr; z = o.z + dz * rr;
            res.nx = dx; res.nz = dz; res.hit = true;
          }
        }
      }
    }
    res.x = x; res.z = z; return res;
  }

  // Oriented box (vehicle) vs static: returns minimal translation {hit, nx, nz, depth}
  resolveOBB(cx, cz, hx, hz, ang, y0, y1, res = { hit: false, nx: 0, nz: 0, depth: 0, tag: null }) {
    res.hit = false; res.depth = 0; res.tag = null;
    const c = Math.cos(ang), s = Math.sin(ang);
    // forward axis (local z) = (s, c), right axis (local x) = (c, -s)
    const ext = Math.abs(hx * c) + Math.abs(hz * s), ezt = Math.abs(hx * s) + Math.abs(hz * c);
    const list = this.query(cx - ext - 1, cx + ext + 1, cz - ezt - 1, cz + ezt + 1, this._tmp2 || (this._tmp2 = []));
    let best = 0, bnx = 0, bnz = 0, btag = null;
    for (const o of list) {
      if (o.type === 0) {
        if (y1 < o.minY || y0 > o.maxY) continue;
        const bx = (o.minX + o.maxX) / 2, bz = (o.minZ + o.maxZ) / 2, bhx = (o.maxX - o.minX) / 2, bhz = (o.maxZ - o.minZ) / 2;
        const dx = cx - bx, dz = cz - bz;
        // axes: world X, world Z, car right, car fwd
        const axes = [[1, 0], [0, 1], [c, -s], [s, c]];
        let minO = Infinity, mnx = 0, mnz = 0, sep = false;
        for (const [ax, az] of axes) {
          const rA = hx * Math.abs(c * ax - s * az) + hz * Math.abs(s * ax + c * az);
          const rB = bhx * Math.abs(ax) + bhz * Math.abs(az);
          const d = dx * ax + dz * az, o2 = rA + rB - Math.abs(d);
          if (o2 <= 0) { sep = true; break; }
          if (o2 < minO) { minO = o2; const sg = d < 0 ? -1 : 1; mnx = ax * sg; mnz = az * sg; }
        }
        if (!sep && minO > best) { best = minO; bnx = mnx; bnz = mnz; btag = o.tag; }
      } else {
        if (y0 > o.h) continue;
        // circle vs OBB: transform to local
        const dx = o.x - cx, dz = o.z - cz;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        const qx = Math.max(-hx, Math.min(hx, lx)), qz = Math.max(-hz, Math.min(hz, lz));
        let ex = lx - qx, ez = lz - qz; const d2 = ex * ex + ez * ez;
        if (d2 < o.r * o.r) {
          const d = Math.sqrt(d2) || 1e-4, pen = o.r - d;
          if (d2 < 1e-8) { ex = 0; ez = lz > 0 ? 1 : -1; } else { ex /= d; ez /= d; }
          // normal pointing from circle to car in world = -(local dir) rotated back
          const wx = ex * c + ez * s, wz = -ex * s + ez * c;
          if (pen > best) { best = pen; bnx = -wx; bnz = -wz; btag = o.tag; }
        }
      }
    }
    if (best > 0) { res.hit = true; res.nx = bnx; res.nz = bnz; res.depth = best; res.tag = btag; }
    return res;
  }

  // Ray cast against static geometry. Returns distance or Infinity. dir must be normalized.
  raycast(ox, oy, oz, dx, dy, dz, maxD, out) {
    let best = maxD, hitObj = null, nX = 0, nY = 0, nZ = 0;
    // traverse cells along the ray (sampled) — rays are short, so step by cell size
    const steps = Math.ceil(maxD / (CELL * 0.5)) + 1;
    const s = ++this._stamp;
    const candidates = this._rc || (this._rc = []); candidates.length = 0;
    for (let i = 0; i <= steps; i++) {
      const t = Math.min(maxD, i * CELL * 0.5);
      const px = ox + dx * t, pz = oz + dz * t;
      for (let ax = -1; ax <= 1; ax++) for (let az = -1; az <= 1; az++) {
        const a = this.grid.get(this._key(Math.floor(px / CELL) + ax, Math.floor(pz / CELL) + az)); if (!a) continue;
        for (const o of a) if (o._s !== s) { o._s = s; candidates.push(o); }
      }
    }
    for (const o of candidates) {
      if (o.type === 0) {
        let tmin = 0, tmax = best, nx = 0, ny = 0, nz = 0;
        const bounds = [[ox, dx, o.minX, o.maxX, 0], [oy, dy, o.minY, o.maxY, 1], [oz, dz, o.minZ, o.maxZ, 2]];
        let ok = true;
        for (const [o0, d, lo, hi, axis] of bounds) {
          if (Math.abs(d) < 1e-9) { if (o0 < lo || o0 > hi) { ok = false; break; } continue; }
          let t1 = (lo - o0) / d, t2 = (hi - o0) / d, sgn = -1;
          if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; sgn = 1; }
          if (t1 > tmin) { tmin = t1; nx = axis === 0 ? sgn : 0; ny = axis === 1 ? sgn : 0; nz = axis === 2 ? sgn : 0; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) { ok = false; break; }
        }
        if (ok && tmin < best && tmin > 0) { best = tmin; hitObj = o; nX = nx; nY = ny; nZ = nz; }
      } else {
        // vertical cylinder
        const fx = ox - o.x, fz = oz - o.z;
        const a = dx * dx + dz * dz; if (a < 1e-9) continue;
        const b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - o.r * o.r;
        const disc = b * b - 4 * a * c; if (disc < 0) continue;
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        if (t > 0 && t < best) {
          const y = oy + dy * t; if (y < 0 || y > o.h) continue;
          best = t; hitObj = o; nX = (fx + dx * t) / o.r; nY = 0; nZ = (fz + dz * t) / o.r;
        }
      }
    }
    // ground plane
    if (dy < -1e-6) { const t = -oy / dy; if (t > 0 && t < best) { best = t; hitObj = { tag: 'ground' }; nX = 0; nY = 1; nZ = 0; } }
    if (out) { out.obj = hitObj; out.nx = nX; out.ny = nY; out.nz = nZ; out.t = best; }
    return hitObj ? best : Infinity;
  }

  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az; const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const t = this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d);
    return t >= d - 0.05;
  }
}
