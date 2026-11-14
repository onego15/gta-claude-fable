// Builds the whole static city: ground, streets, sidewalks, buildings, parks, harbor and props.
import * as THREE from 'three';
import { BatchSet, Batch } from './geo.js';
import * as P from './props.js';
import * as L from './layout.js';
import * as T from './textures.js';
import { StaticWorld } from './collision.js';
import { rng } from '../core/utils.js';

const { ROAD_HALF, WALK_W, CURB_H, PITCH, LANE_OFF } = L;
const col = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const GF = 4.4; // ground floor height

const STUCCO = ['#f4c7a1', '#bfe3d0', '#bcd9ea', '#f3e2a0', '#f2a490', '#f4f1ea', '#d9c7e6', '#f6d6c4', '#e0ecd8'];
const AWNING = ['#c0392b', '#2e8b57', '#1f5f8b', '#d35400', '#6c3483', '#2c3e50', '#b7950b', '#0e6655'];

export function buildCity(assets) {
  const r = rng(20240611);
  const root = new THREE.Group(); root.name = 'city';
  const statics = new StaticWorld();
  const data = {
    signals: [], lampPoints: [], parkedSpots: [], benches: [], coverPoints: [], enemySpawns: [], treePoints: [],
    signalBulbs: [], pedNodes: null, buildings: [], shopFronts: [],
  };

  // ---------- materials ----------
  const tx = {
    asphalt: T.asphaltTexture(), pavement: T.pavementTexture(), concrete: T.concreteTexture(), grass: T.grassTexture(),
    roof: T.concreteTexture('#77736c', 21), leaf: T.leafTexture(), water: T.waterNormalTexture(),
  };
  const fac = {};
  for (const [k, seed] of [['glass', 1], ['brick', 2], ['stucco', 3], ['office', 4], ['warehouse', 5]]) fac[k] = T.facadeTextures(k, seed);
  const shop = T.storefrontAtlas();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    asphalt: std({ map: tx.asphalt, roughness: 0.92, vertexColors: true }),
    pavement: std({ map: tx.pavement, roughness: 0.85, vertexColors: true }),
    curb: std({ map: tx.concrete, roughness: 0.85, vertexColors: true }),
    concrete: std({ map: tx.concrete, roughness: 0.9, vertexColors: true }),
    roof: std({ map: tx.roof, roughness: 0.95, vertexColors: true }),
    trim: std({ map: tx.concrete, roughness: 0.8, vertexColors: true }),
    grass: std({ map: tx.grass, roughness: 1, vertexColors: true }),
    marking: std({ color: 0xffffff, roughness: 0.75, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    metal: std({ roughness: 0.45, metalness: 0.55, vertexColors: true }),
    paint: std({ roughness: 0.6, metalness: 0.05, vertexColors: true }),
    wood: std({ roughness: 0.85, vertexColors: true }),
    bark: std({ roughness: 0.95, vertexColors: true }),
    foliage: std({ roughness: 0.9, vertexColors: true, flatShading: true }),
    leaf: std({ map: tx.leaf, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, vertexColors: true }),
    glass: std({ roughness: 0.08, metalness: 0.6, vertexColors: true, transparent: true, opacity: 0.55 }),
    fence: std({ color: 0x9aa3a8, roughness: 0.5, metalness: 0.6, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    container: std({ map: makeCorrugated(), roughness: 0.65, metalness: 0.25, vertexColors: true }),
    shop: std({ map: shop.map, emissiveMap: shop.emissive, emissive: 0xffffff, emissiveIntensity: 0.15, roughness: 0.4, metalness: 0.1, vertexColors: true }),
  };
  M.fence.userData.noShadow = true; M.glass.userData.noShadow = true; M.marking.userData.noShadow = true;
  for (const k in fac) {
    M['f_' + k] = std({
      map: fac[k].map, emissiveMap: fac[k].emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true,
      roughness: k === 'glass' ? 0.18 : 0.85, metalness: k === 'glass' ? 0.55 : 0.0,
    });
  }
  data.materials = M; data.facadeMats = Object.keys(fac).map((k) => M['f_' + k]);

  // Batches per city chunk (for frustum culling) + global batch for small stuff
  const chunks = new Map();
  const chunk = (x, z) => {
    const k = Math.floor((x - L.X0 + 40) / PITCH) + ',' + Math.floor((z - L.Z0 + 40) / PITCH);
    let c = chunks.get(k); if (!c) { c = new BatchSet(); chunks.set(k, c); } return c;
  };
  const ground = new BatchSet();

  // ---------- ground & roads ----------
  const ax0 = L.CITY_MIN_X - ROAD_HALF, ax1 = L.CITY_MAX_X + ROAD_HALF, az0 = L.CITY_MIN_Z - ROAD_HALF, az1 = L.CITY_MAX_Z + ROAD_HALF;
  ground.get('asphalt').top(ax0, az0, ax1, az1, 0, 9, [1, 1, 1]);
  // repair patches & manholes
  const mk = ground.get('marking');
  for (let i = 0; i < 160; i++) {
    const onX = r() < 0.5; const ri = Math.floor(r() * L.ROADS_X), t = L.CITY_MIN_X + r() * (L.CITY_MAX_X - L.CITY_MIN_X);
    const px = onX ? t : L.roadX(ri), pz = onX ? L.roadZ(Math.floor(r() * L.ROADS_Z)) : L.CITY_MIN_Z + r() * (L.CITY_MAX_Z - L.CITY_MIN_Z);
    const ox = onX ? 0 : (r() - 0.5) * 8, oz = onX ? (r() - 0.5) * 8 : 0;
    const w = 0.8 + r() * 2.5, h = 0.8 + r() * 2.5;
    const shade = 0.16 + r() * 0.1;
    mk.top(px + ox - w / 2, pz + oz - h / 2, px + ox + w / 2, pz + oz + h / 2, 0.006, 4, [shade, shade, shade * 1.05]);
  }
  for (let i = 0; i < L.ROADS_X; i++) for (let j = 0; j < L.ROADS_Z; j++) {
    const cx = L.roadX(i), cz = L.roadZ(j);
    manhole(mk, cx + 2.5, cz - 1.5);
  }

  const lineCol = col('#f2f0e8'), yel = col('#e8b923');
  const stopDist = ROAD_HALF + 4.2;
  // segments along X (east-west roads)
  for (let j = 0; j < L.ROADS_Z; j++) for (let i = 0; i < L.ROADS_X - 1; i++) {
    const z = L.roadZ(j), xa = L.roadX(i) + stopDist + 0.4, xb = L.roadX(i + 1) - stopDist - 0.4;
    mk.top(xa, z - 0.2, xb, z - 0.08, 0.012, 4, yel); mk.top(xa, z + 0.08, xb, z + 0.2, 0.012, 4, yel);
    for (const s of [-1, 1]) {
      const pz = z + s * 4.6; mk.top(xa, pz - 0.06, xb, pz + 0.06, 0.012, 4, lineCol);
      for (let x = xa + 4; x < xb - 4; x += 6.2) mk.top(x - 0.05, Math.min(pz, pz + s * 2.6), x + 0.05, Math.max(pz, pz + s * 2.6), 0.012, 4, lineCol);
      // parking spots along this side
      for (let x = xa + 7; x < xb - 7; x += 6.2 * 2) if (r() < 0.55) data.parkedSpots.push({ x: x + 3.1, z: z + s * L.PARK_OFF, heading: s > 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
  }
  for (let i = 0; i < L.ROADS_X; i++) for (let j = 0; j < L.ROADS_Z - 1; j++) {
    const x = L.roadX(i), za = L.roadZ(j) + stopDist + 0.4, zb = L.roadZ(j + 1) - stopDist - 0.4;
    mk.top(x - 0.2, za, x - 0.08, zb, 0.012, 4, yel); mk.top(x + 0.08, za, x + 0.2, zb, 0.012, 4, yel);
    for (const s of [-1, 1]) {
      const px = x + s * 4.6; mk.top(px - 0.06, za, px + 0.06, zb, 0.012, 4, lineCol);
      for (let z = za + 4; z < zb - 4; z += 6.2) mk.top(Math.min(px, px + s * 2.6), z - 0.05, Math.max(px, px + s * 2.6), z + 0.05, 0.012, 4, lineCol);
      for (let z = za + 7; z < zb - 7; z += 6.2 * 2) if (r() < 0.55) data.parkedSpots.push({ x: x + s * L.PARK_OFF, z: z + 3.1, heading: s > 0 ? Math.PI : 0 });
    }
  }
  // crosswalks & stop lines & signals at every intersection
  const bulbs = [];
  for (let i = 0; i < L.ROADS_X; i++) for (let j = 0; j < L.ROADS_Z; j++) {
    const cx = L.roadX(i), cz = L.roadZ(j), id = L.nodeId(i, j);
    const dirs = [];
    if (j > 0) dirs.push([0, 1]);           // approach heading +z (coming from north)
    if (j < L.ROADS_Z - 1) dirs.push([0, -1]);
    if (i > 0) dirs.push([1, 0]);
    if (i < L.ROADS_X - 1) dirs.push([-1, 0]);
    const sig = { id, x: cx, z: cz, offset: ((i * 7 + j * 3) % 10) * 2.1, heads: [] };
    const signalized = dirs.length >= 3;
    for (const [dx, dz] of dirs) {
      // approach comes from -d side
      const bx = cx - dx * (ROAD_HALF + 2.2), bz = cz - dz * (ROAD_HALF + 2.2);
      // zebra crossing (stripes run along travel direction)
      for (let k = -6; k <= 6; k++) {
        const o = k * 1.05; if (Math.abs(o) > ROAD_HALF - 0.5) continue;
        if (dx === 0) mk.top(cx + o - 0.3, bz - 1.5, cx + o + 0.3, bz + 1.5, 0.013, 4, lineCol);
        else mk.top(bx - 1.5, cz + o - 0.3, bx + 1.5, cz + o + 0.3, 0.013, 4, lineCol);
      }
      // stop line on the incoming lane (right side of travel)
      const rx = -dz, rz = dx; // right vector
      const sx = cx - dx * stopDist, sz = cz - dz * stopDist;
      const ex = sx + rx * 4.5, ez = sz + rz * 4.5;
      mk.top(Math.min(sx, ex) - (dx ? 0.22 : 0), Math.min(sz, ez) - (dz ? 0.22 : 0), Math.max(sx, ex) + (dx ? 0.22 : 0), Math.max(sz, ez) + (dz ? 0.22 : 0), 0.013, 4, lineCol);
      // traffic light at near-right corner, facing the approaching traffic
      const px = cx - dx * (ROAD_HALF + 0.9) + rx * (ROAD_HALF + 0.9), pz = cz - dz * (ROAD_HALF + 0.9) + rz * (ROAD_HALF + 0.9);
      const yaw = Math.atan2(-dx, -dz);
      const lxX = Math.cos(yaw), lxZ = -Math.sin(yaw);
      const sgn = Math.sign(lxX * -rx + lxZ * -rz) || 1;
      if (!signalized) continue;
      const b = P.trafficLight(chunk(px, pz), px, CURB_H, pz, yaw, sgn * (ROAD_HALF + 0.9 - LANE_OFF));
      statics.addCyl(px, pz, 0.2, 6, 'pole');
      const axis = dx !== 0 ? 'x' : 'z';
      for (const bb of b) { bb.node = id; bb.axis = axis; bulbs.push(bb); }
      sig.heads.push({ axis, dx, dz });
    }
    data.signals[id] = sig;
  }
  data.signalBulbs = bulbs;

  // ---------- sidewalks / blocks ----------
  const curbCol = [0.95, 0.95, 0.93];
  const slab = (x0, z0, x1, z1) => {
    const g = chunk((x0 + x1) / 2, (z0 + z1) / 2);
    g.get('pavement').top(x0, z0, x1, z1, CURB_H, 4, [1, 1, 1]);
    g.get('curb').box(x0, 0, z0, x1, CURB_H, z1, 1, curbCol, { top: false });
  };
  for (let bx = 0; bx < L.BLOCKS_X; bx++) for (let bz = 0; bz < L.BLOCKS_Z; bz++) {
    const x0 = L.roadX(bx) + ROAD_HALF, x1 = L.roadX(bx + 1) - ROAD_HALF, z0 = L.roadZ(bz) + ROAD_HALF, z1 = L.roadZ(bz + 1) - ROAD_HALF;
    slab(x0, z0, x1, z1);
  }
  // outer belt
  const OB = 34;
  slab(ax0 - OB, az0 - OB, ax1 + OB, az0);                    // north
  slab(ax0 - OB, az0, ax0, az1);                               // west
  slab(ax1, az0, ax1 + OB, az1);                               // east
  slab(ax0 - OB, az1, ax1 + OB, L.QUAY_Z);                     // south promenade
  // quay wall
  ground.get('concrete').wall(ax1 + OB, L.QUAY_Z, ax0 - OB, L.QUAY_Z, -4, CURB_H, 0, 60, 0, 1, col('#8e8a80'));
  ground.get('concrete').wall(ax0 - OB, L.QUAY_Z, ax1 + OB, L.QUAY_Z, -4, CURB_H, 0, 60, 0, 1, col('#8e8a80'));
  // boundary colliders (invisible walls where the city ends)
  statics.addBox(L.WORLD_LIMIT.minX - 10, L.WORLD_LIMIT.minX, az0 - 60, L.QUAY_Z + 40, -5, 60, 'bound');
  statics.addBox(L.WORLD_LIMIT.maxX, L.WORLD_LIMIT.maxX + 10, az0 - 60, L.QUAY_Z + 40, -5, 60, 'bound');
  statics.addBox(ax0 - 60, ax1 + 60, L.WORLD_LIMIT.minZ - 10, L.WORLD_LIMIT.minZ, -5, 60, 'bound');
  statics.addBox(ax0 - 60, ax1 + 60, L.QUAY_Z - 0.4, L.QUAY_Z + 10, -5, 1.4, 'quay');

  // ---------- buildings ----------
  const ctx = { r, chunk, statics, data, M };
  for (let bx = 0; bx < L.BLOCKS_X; bx++) for (let bz = 0; bz < L.BLOCKS_Z; bz++) {
    const type = L.blockType(bx, bz);
    const rect = L.blockRect(bx, bz);
    if (type === 'park') buildPark(ctx, rect);
    else if (type === 'containers') buildContainerYard(ctx, rect);
    else if (type === 'market') buildMarket(ctx, rect);
    else if (type === 'showroom') buildShowroom(ctx, rect);
    else buildBlock(ctx, rect, type, bx, bz);
    streetProps(ctx, bx, bz, type);
  }
  // boundary buildings (north, west, east)
  boundaryRow(ctx, ax0 - OB + 4, az0 - WALK_W - 22, ax1 + OB - 4, az0 - WALK_W, 's');
  boundaryRow(ctx, ax0 - WALK_W - 22, az0 - WALK_W - 0.5, ax0 - WALK_W, az1 + 2, 'e');
  boundaryRow(ctx, ax1 + WALK_W, az0 - WALK_W - 0.5, ax1 + WALK_W + 22, az1 + 2, 'w');
  buildPromenade(ctx, ax0 - OB, ax1 + OB);

  // ---------- emit meshes ----------
  for (const sm of data.signMeshes || []) root.add(sm);
  ground.toMeshes(M, root, { castShadow: false });
  for (const [, bs] of chunks) bs.toMeshes(M, root);

  // signal bulbs (instanced, color driven at runtime)
  const bulbGeo = new THREE.SphereGeometry(0.15, 10, 8);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const bulbMesh = new THREE.InstancedMesh(bulbGeo, bulbMat, bulbs.length);
  const m4 = new THREE.Matrix4();
  bulbs.forEach((b, i) => { m4.makeTranslation(b.x, b.y, b.z); bulbMesh.setMatrixAt(i, m4); bulbMesh.setColorAt(i, new THREE.Color(0x222222)); });
  bulbMesh.frustumCulled = false; root.add(bulbMesh);
  data.bulbMesh = bulbMesh;

  // street lamp heads & light pools (instanced)
  const lampGeo = new THREE.SphereGeometry(0.28, 10, 6); lampGeo.scale(1.3, 0.45, 1.3);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1d0, toneMapped: false });
  const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, data.lampPoints.length);
  const poolGeo = new THREE.PlaneGeometry(1, 1); poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({ map: T.radialGlowTexture('rgba(255,214,150,0.55)', 'rgba(255,190,120,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const poolMesh = new THREE.InstancedMesh(poolGeo, poolMat, data.lampPoints.length);
  data.lampPoints.forEach((p, i) => {
    m4.makeTranslation(p.x, p.y, p.z); lampMesh.setMatrixAt(i, m4);
    m4.makeScale(13, 1, 13).setPosition(p.gx, p.gy + 0.03, p.gz); poolMesh.setMatrixAt(i, m4);
  });
  lampMesh.frustumCulled = false; poolMesh.frustumCulled = false; poolMesh.renderOrder = 2;
  root.add(lampMesh, poolMesh);
  data.lampMat = lampMat; data.poolMat = poolMat;

  // water
  const water = makeWater(tx.water);
  root.add(water.mesh); data.water = water;
  // distant scenery
  root.add(makeDistant(r));

  data.statics = statics;
  return { root, statics, data };
}

function manhole(b, x, z) {
  const seg = 12, rr = 0.42, y = 0.008, c = [0.22, 0.22, 0.23];
  for (let k = 0; k < seg; k++) {
    const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
    b.tri([x, y, z], [x + Math.sin(a0) * rr, y, z + Math.cos(a0) * rr], [x + Math.sin(a1) * rr, y, z + Math.cos(a1) * rr], c);
  }
}

function makeCorrugated() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 8) { const g = x.createLinearGradient(i, 0, i + 8, 0); g.addColorStop(0, '#bdbdbd'); g.addColorStop(0.5, '#ffffff'); g.addColorStop(1, '#a8a8a8'); x.fillStyle = g; x.fillRect(i, 0, 8, 128); }
  x.fillStyle = 'rgba(90,50,20,0.15)'; for (let i = 0; i < 30; i++) x.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 10, 2 + Math.random() * 20);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------- building generator ----------------
function pickStyle(type, r) {
  if (type === 'downtown') return r.pick(['glass', 'glass', 'office', 'office', 'stucco']);
  if (type === 'midtown') return r.pick(['stucco', 'stucco', 'brick', 'office']);
  if (type === 'residential' || type === 'garage') return r.pick(['brick', 'brick', 'stucco']);
  if (type === 'harbor') return r.pick(['warehouse', 'warehouse', 'brick']);
  return 'stucco';
}
function tintFor(style, r) {
  if (style === 'stucco') return col(r.pick(STUCCO));
  if (style === 'brick') return r.pick([[1, 1, 1], [0.86, 0.78, 0.76], [1.05, 0.95, 0.86], [0.75, 0.62, 0.58]]);
  if (style === 'glass') return r.pick([[1, 1, 1], [0.85, 1, 0.95], [1.05, 0.95, 0.85], [0.9, 0.95, 1.1]]);
  if (style === 'office') return r.pick([[1, 1, 1], [0.95, 0.92, 0.85], [0.85, 0.88, 0.9], [1, 0.95, 0.9]]);
  if (style === 'warehouse') return r.pick([[1, 1, 1], [0.8, 0.95, 0.9], [1, 0.85, 0.75], [0.85, 0.85, 1]]);
  return [1, 1, 1];
}
function floorsFor(type, r) {
  if (type === 'downtown') return r.int(9, 22);
  if (type === 'midtown') return r.int(3, 7);
  if (type === 'residential' || type === 'garage') return r.int(2, 5);
  if (type === 'harbor') return r.int(1, 2);
  return 3;
}

// sides: {n,s,e,w} -> true when facing a street (gets storefronts)
function building(ctx, x0, z0, x1, z1, o) {
  const { r, statics, data } = ctx; const bs = ctx.chunk((x0 + x1) / 2, (z0 + z1) / 2);
  const style = o.style, floors = o.floors, tint = o.tint || tintFor(style, r);
  const fb = bs.get('f_' + style);
  const shops = o.shops !== false && style !== 'warehouse';
  const H = GF + floors * T.FLOOR_H;
  const uOff = r.int(0, 7) / T.FACADE_BAYS, vOff = r.int(0, 7) / T.FACADE_FLOORS;
  const sides = [
    ['s', x0, z1, x1, z1], ['n', x1, z0, x0, z0], ['e', x1, z1, x1, z0], ['w', x0, z0, x0, z1],
  ];
  const trim = bs.get('trim'); const trimCol = style === 'brick' ? col('#d8cbb6') : style === 'glass' ? col('#8a949c') : [tint[0] * 0.85, tint[1] * 0.85, tint[2] * 0.85];
  for (const [side, ax, az, bx, bz] of sides) {
    const len = Math.hypot(bx - ax, bz - az); const bays = Math.max(1, Math.round(len / T.BAY_W));
    const u1 = uOff + bays / T.FACADE_BAYS;
    // upper floors
    fb.wall(ax, az, bx, bz, GF, H, uOff, u1, vOff, vOff + floors / T.FACADE_FLOORS, tint);
    // ground floor
    const street = o.sides[side];
    const nx = -(bz - az) / len, nz = (bx - ax) / len; // outward normal
    if (street && shops && !o.special) {
      storefronts(ctx, bs, ax, az, bx, bz, nx, nz, len, o.lobby);
    } else if (o.special && street && o.special.side === side) {
      specialFront(ctx, bs, ax, az, bx, bz, nx, nz, len, o.special);
    } else {
      const gb = style === 'warehouse' ? fb : bs.get('trim');
      if (style === 'warehouse') {
        fb.wall(ax, az, bx, bz, 0, GF, uOff, u1, vOff - GF / (T.FLOOR_H * T.FACADE_FLOORS), vOff, tint);
        if (street) rollerDoors(bs, ax, az, bx, bz, nx, nz, len, r);
      } else gb.wall(ax, az, bx, bz, 0, GF, 0, len / 4, 0, GF / 4, [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8]);
    }
    // cornice above ground floor on street sides
    if (street && style !== 'warehouse') ledge(trim, ax, az, bx, bz, nx, nz, GF - 0.05, 0.35, 0.3, trimCol);
  }
  // roof
  bs.get('roof').top(x0, z0, x1, z1, H, 6, [1, 1, 1]);
  // parapet
  const ph = style === 'glass' ? 1.2 : 0.8, pt = 0.35;
  trim.box(x0 - 0.05, H, z0 - 0.05, x1 + 0.05, H + ph, z0 + pt, 2, trimCol);
  trim.box(x0 - 0.05, H, z1 - pt, x1 + 0.05, H + ph, z1 + 0.05, 2, trimCol);
  trim.box(x0 - 0.05, H, z0, x0 + pt, H + ph, z1, 2, trimCol);
  trim.box(x1 - pt, H, z0, x1 + 0.05, H + ph, z1, 2, trimCol);
  if (style !== 'glass' && floors > 2) ledge(trim, x0, z1, x1, z1, 0, 1, H - 0.4, 0.3, 0.4, trimCol), ledge(trim, x1, z0, x0, z0, 0, -1, H - 0.4, 0.3, 0.4, trimCol), ledge(trim, x1, z1, x1, z0, 1, 0, H - 0.4, 0.3, 0.4, trimCol), ledge(trim, x0, z0, x0, z1, -1, 0, H - 0.4, 0.3, 0.4, trimCol);
  // roof props
  const area = (x1 - x0) * (z1 - z0);
  const nAC = Math.min(6, Math.floor(area / 120));
  for (let i = 0; i < nAC; i++) P.acUnit(bs, x0 + 2 + r() * (x1 - x0 - 4), H, z0 + 2 + r() * (z1 - z0 - 4), r);
  if ((style === 'brick' || style === 'stucco') && r() < 0.5 && area > 150) P.waterTank(bs, x0 + 3 + r() * (x1 - x0 - 6), H, z0 + 3 + r() * (z1 - z0 - 6));
  if (style === 'glass' && floors > 12) {
    bs.get('metal').cyl((x0 + x1) / 2, H, (z0 + z1) / 2, 0.15, 0.05, 9, 6, 1, col('#cccccc'));
    data.lampPoints.push({ x: (x0 + x1) / 2, y: H + 9, z: (z0 + z1) / 2, gx: 0, gy: -100, gz: 0, aviation: true });
  }
  if (o.billboard && r() < 0.35 && floors <= 7) billboard(ctx, bs, x0, z0, x1, z1, H, o.billboardSide);
  statics.addBox(x0, x1, z0, z1, -1, H + ph, 'building');
  data.buildings.push({ x0, z0, x1, z1, h: H + ph, style });
  return H;
}

function ledge(b, ax, az, bx, bz, nx, nz, y, out, h, c) {
  const p0 = [ax + nx * out, az + nz * out], p1 = [bx + nx * out, bz + nz * out];
  b.wall(p0[0], p0[1], p1[0], p1[1], y, y + h, 0, 1, 0, 0.1, c);
  b.quad([p0[0], y + h, p0[1]], [p1[0], y + h, p1[1]], [bx, y + h, bz], [ax, y + h, az], [0, 0, 1, 0, 1, 0.1, 0, 0.1], c);
  b.quad([ax, y, az], [bx, y, bz], [p1[0], y, p1[1]], [p0[0], y, p0[1]], [0, 0, 1, 0, 1, 0.1, 0, 0.1], [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6]);
}

function storefronts(ctx, bs, ax, az, bx, bz, nx, nz, len, lobby) {
  const { r, data } = ctx; const sb = bs.get('shop'), aw = bs.get('paint');
  const n = Math.max(1, Math.round(len / 9));
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  for (let i = 0; i < n; i++) {
    const t0 = i / n * len, t1 = (i + 1) / n * len;
    const s = lobby && r() < 0.6 ? T.SHOPS.length - 1 : r.int(0, T.SHOPS.length - 2);
    const cI = s % T.SHOP_COLS, rI = Math.floor(s / T.SHOP_COLS);
    const u0 = cI / T.SHOP_COLS + 0.002, u1 = (cI + 1) / T.SHOP_COLS - 0.002, v0 = 1 - (rI + 1) / T.SHOP_ROWS + 0.002, v1 = 1 - rI / T.SHOP_ROWS - 0.002;
    const p0x = ax + dx * t0 + nx * 0.02, p0z = az + dz * t0 + nz * 0.02, p1x = ax + dx * t1 + nx * 0.02, p1z = az + dz * t1 + nz * 0.02;
    sb.wall(p0x, p0z, p1x, p1z, 0, GF - 0.1, u0, u1, v0, v1, [1, 1, 1]);
    // pilasters between shops
    bs.get('trim').obox(p0x + nx * 0.12, GF / 2, p0z + nz * 0.12, 0.25, GF / 2, 0.15, Math.atan2(nx, nz), 1, col('#5a5450'));
    data.shopFronts.push({ x: (p0x + p1x) / 2 + nx * 1.5, z: (p0z + p1z) / 2 + nz * 1.5, nx, nz });
    // awning
    if (T.SHOPS[s].lobby || r() < 0.35) continue;
    const ac = col(r.pick(AWNING)); const w0 = t0 + 0.4, w1 = t1 - 0.4;
    const A = (t, o, y) => [ax + dx * t + nx * o, y, az + dz * t + nz * o];
    const yTop = 3.55, yLow = 2.75, out = 1.5;
    const stripes = 6;
    for (let k = 0; k < stripes; k++) {
      const ta = w0 + (w1 - w0) * k / stripes, tb = w0 + (w1 - w0) * (k + 1) / stripes;
      const cc = k % 2 ? ac : [Math.min(1, ac[0] * 0.3 + 0.7), Math.min(1, ac[1] * 0.3 + 0.7), Math.min(1, ac[2] * 0.3 + 0.7)];
      aw.quad(A(ta, out, yLow), A(tb, out, yLow), A(tb, 0, yTop), A(ta, 0, yTop), [0, 0, 1, 0, 1, 1, 0, 1], cc);
      aw.quad(A(ta, 0, yTop - 0.01), A(tb, 0, yTop - 0.01), A(tb, out, yLow - 0.01), A(ta, out, yLow - 0.01), [0, 0, 1, 0, 1, 1, 0, 1], [cc[0] * 0.6, cc[1] * 0.6, cc[2] * 0.6]);
      aw.quad(A(ta, out, yLow - 0.35), A(tb, out, yLow - 0.35), A(tb, out, yLow), A(ta, out, yLow), [0, 0, 1, 0, 1, 1, 0, 1], cc);
    }
  }
}

function rollerDoors(bs, ax, az, bx, bz, nx, nz, len, r) {
  const m = bs.get('metal'); const dx = (bx - ax) / len, dz = (bz - az) / len;
  const n = Math.floor(len / 9);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * len / n; const cx = ax + dx * t + nx * 0.05, cz = az + dz * t + nz * 0.05;
    m.wall(cx - dx * 2, cz - dz * 2, cx + dx * 2, cz + dz * 2, 0, 3.8, 0, 1, 0, 1, col(r.pick(['#8c9497', '#6f7b80', '#9a8a6a', '#5d6d7e'])));
    for (let k = 0; k < 12; k++) m.wall(cx - dx * 2 + nx * 0.02, cz - dz * 2 + nz * 0.02, cx + dx * 2 + nx * 0.02, cz + dz * 2 + nz * 0.02, k * 0.31 + 0.05, k * 0.31 + 0.09, 0, 1, 0, 1, [0.35, 0.37, 0.38]);
  }
}

function specialFront(ctx, bs, ax, az, bx, bz, nx, nz, len, sp) {
  const tr = bs.get('trim'), gl = bs.get('glass'); const dx = (bx - ax) / len, dz = (bz - az) / len;
  tr.wall(ax, az, bx, bz, 0, GF, 0, len / 4, 0, 1, col(sp.wall));
  const cx = (ax + bx) / 2 + nx * 0.03, cz = (az + bz) / 2 + nz * 0.03;
  gl.wall(cx - dx * 6, cz - dz * 6, cx + dx * 6, cz + dz * 6, 0.1, 3.6, 0, 1, 0, 1, col('#8fb7cc'));
  // canopy
  const p = bs.get('paint');
  const A = (t, o, y) => [cx + dx * t + nx * o, y, cz + dz * t + nz * o];
  p.quad(A(-7, 3.2, 3.9), A(7, 3.2, 3.9), A(7, 0, 3.9), A(-7, 0, 3.9), [0, 0, 1, 0, 1, 1, 0, 1], col(sp.accent));
  p.quad(A(-7, 0, 3.6), A(7, 0, 3.6), A(7, 3.2, 3.6), A(-7, 3.2, 3.6), [0, 0, 1, 0, 1, 1, 0, 1], col('#dddddd'));
  p.wall(A(-7, 3.2, 0)[0], A(-7, 3.2, 0)[2], A(7, 3.2, 0)[0], A(7, 3.2, 0)[2], 3.6, 3.9, 0, 1, 0, 1, col(sp.accent));
  // sign mesh
  const sign = makeSign(sp.text, sp.sub, sp.accent);
  sign.position.set(cx + nx * 0.06, 6.2, cz + nz * 0.06); sign.rotation.y = Math.atan2(nx, nz);
  ctx.signs = ctx.signs || []; ctx.data.signMeshes = ctx.data.signMeshes || []; ctx.data.signMeshes.push(sign);
}

function makeSign(text, sub, accent) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#f7f7f2'; x.fillRect(0, 0, 1024, 256); x.fillStyle = accent; x.fillRect(0, 0, 1024, 24); x.fillRect(0, 232, 1024, 24);
  x.fillStyle = accent; x.font = 'bold 130px "Bebas Neue", Impact'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 512, 118);
  x.fillStyle = '#333'; x.font = '600 34px Rajdhani, "Noto Sans JP", sans-serif'; x.fillText(sub, 512, 200);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 0.5 }));
  m.userData.nightSign = true;
  return m;
}

function billboard(ctx, bs, x0, z0, x1, z1, H, side) {
  const { r } = ctx; const m = bs.get('metal');
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; const w = Math.min(14, (x1 - x0) * 0.8);
  // face toward side
  const yaw = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 }[side || 's'];
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  for (const o of [-w / 2 + 1, w / 2 - 1]) m.obox(cx + Math.cos(yaw) * o, H + 2.5, cz - Math.sin(yaw) * o, 0.12, 2.5, 0.12, yaw, 1, col('#3b3f44'));
  m.obox(cx, H + 5.1, cz, w / 2 + 0.2, 2.7, 0.15, yaw, 1, col('#2a2d30'));
  const tex = T.billboardTexture(r.int(0, 3));
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.6 });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2), mat);
  plane.position.set(cx + fx * 0.17, H + 5.1, cz + fz * 0.17); plane.rotation.y = yaw; plane.userData.nightSign = true;
  ctx.data.signMeshes = ctx.data.signMeshes || []; ctx.data.signMeshes.push(plane);
  // spot lamps
  for (const o of [-w / 3, 0, w / 3]) ctx.data.lampPoints.push({ x: cx + Math.cos(yaw) * o + fx * 1.2, y: H + 2.3, z: cz - Math.sin(yaw) * o + fz * 1.2, gx: 0, gy: -100, gz: 0 });
}

function buildBlock(ctx, rect, type, bx, bz) {
  const { r } = ctx;
  const W = rect.x1 - rect.x0, D = rect.z1 - rect.z0;
  const nx = type === 'downtown' ? 2 : r.pick([2, 3]); const nz = 2;
  // split positions
  const xs = [rect.x0]; for (let i = 1; i < nx; i++) xs.push(rect.x0 + W * (i / nx) + (r() - 0.5) * 8); xs.push(rect.x1);
  const zs = [rect.z0, rect.z0 + D / 2 + (r() - 0.5) * 8, rect.z1];
  const gap = 1.6; // alleys between lots
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    let x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
    const sides = { w: i === 0, e: i === nx - 1, n: j === 0, s: j === nz - 1 };
    if (!sides.w) x0 += gap; if (!sides.e) x1 -= gap; if (!sides.n) z0 += gap; if (!sides.s) z1 -= gap;
    let special = null;
    if (bx === 3 && bz === 1 && i === 0 && j === 1) special = { side: 'w', text: 'HOSPITAL', sub: 'セント・メリディアン病院  ✚  救急', wall: '#e9eef0', accent: '#d64541' };
    if (bx === 0 && bz === 2 && i === nx - 1 && j === 1) special = { side: 'e', text: 'POLICE', sub: 'ポート・メリディアン市警  中央分署', wall: '#dfe5ee', accent: '#1f4e8c' };
    if (type === 'garage' && i === 0 && j === 1) { garageLot(ctx, x0, z0, x1, z1); continue; }
    if (!special && type !== 'downtown' && r() < 0.12) { parkingLot(ctx, x0, z0, x1, z1, sides); continue; }
    let style = pickStyle(type, r), floors = floorsFor(type, r);
    if (special) { style = 'office'; floors = 5; }
    const streetSide = sides.s ? 's' : sides.n ? 'n' : sides.e ? 'e' : 'w';
    if (type === 'downtown' && floors > 8 && !special) {
      // podium + setback tower
      const pod = 3;
      const ph = building(ctx, x0, z0, x1, z1, { style: r.pick(['office', 'stucco']), floors: pod, sides, lobby: true });
      const inset = 3.2;
      buildingTower(ctx, x0 + inset, z0 + inset, x1 - inset, z1 - inset, ph, style, floors - pod);
    } else {
      building(ctx, x0, z0, x1, z1, { style, floors, sides, lobby: type === 'residential', special, billboard: type === 'midtown', billboardSide: streetSide });
    }
    if (special) ctx.data[special.text === 'HOSPITAL' ? 'hospitalFront' : 'policeFront'] = { x: special.side === 'w' ? x0 - 3 : x1 + 3, z: (z0 + z1) / 2 };
  }
}

function buildingTower(ctx, x0, z0, x1, z1, baseY, style, floors) {
  const { r, statics } = ctx; const bs = ctx.chunk((x0 + x1) / 2, (z0 + z1) / 2);
  const fb = bs.get('f_' + style); const tint = tintFor(style, r);
  const H = baseY + floors * T.FLOOR_H;
  const uOff = r.int(0, 7) / T.FACADE_BAYS, vOff = r.int(0, 7) / T.FACADE_FLOORS;
  for (const [ax, az, bx, bz] of [[x0, z1, x1, z1], [x1, z0, x0, z0], [x1, z1, x1, z0], [x0, z0, x0, z1]]) {
    const len = Math.hypot(bx - ax, bz - az); const bays = Math.max(1, Math.round(len / T.BAY_W));
    fb.wall(ax, az, bx, bz, baseY, H, uOff, uOff + bays / T.FACADE_BAYS, vOff, vOff + floors / T.FACADE_FLOORS, tint);
  }
  bs.get('roof').top(x0, z0, x1, z1, H, 6, [1, 1, 1]);
  const trim = bs.get('trim'); const tc = col('#9aa3aa');
  trim.box(x0 - 0.3, H, z0 - 0.3, x1 + 0.3, H + 1.4, z0 + 0.2, 2, tc); trim.box(x0 - 0.3, H, z1 - 0.2, x1 + 0.3, H + 1.4, z1 + 0.3, 2, tc);
  trim.box(x0 - 0.3, H, z0, x0 + 0.2, H + 1.4, z1, 2, tc); trim.box(x1 - 0.2, H, z0, x1 + 0.3, H + 1.4, z1, 2, tc);
  // mechanical penthouse
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, pw = Math.min(8, (x1 - x0) / 3), pd = Math.min(8, (z1 - z0) / 3);
  trim.box(cx - pw, H, cz - pd, cx + pw, H + 4, cz + pd, 3, col('#b9bcbf'));
  if (floors > 10) { bs.get('metal').cyl(cx, H + 4, cz, 0.18, 0.05, 10, 6, 1, col('#dddddd')); ctx.data.lampPoints.push({ x: cx, y: H + 14, z: cz, gx: 0, gy: -100, gz: 0, aviation: true }); }
  statics.addBox(x0, x1, z0, z1, -1, H + 1.4, 'building');
}

function parkingLot(ctx, x0, z0, x1, z1, sides) {
  const bs = ctx.chunk((x0 + x1) / 2, (z0 + z1) / 2);
  bs.get('asphalt').top(x0, z0, x1, z1, L.CURB_H + 0.01, 9, [0.85, 0.85, 0.85]);
  const mk = bs.get('marking');
  for (let x = x0 + 3; x < x1 - 3; x += 3) { mk.top(x - 0.06, z0 + 2, x + 0.06, z0 + 6.5, L.CURB_H + 0.02, 4, [0.9, 0.9, 0.9]); mk.top(x - 0.06, z1 - 6.5, x + 0.06, z1 - 2, L.CURB_H + 0.02, 4, [0.9, 0.9, 0.9]); }
  for (let x = x0 + 4.5; x < x1 - 4; x += 6) {
    if (ctx.r() < 0.6) ctx.data.parkedSpots.push({ x, z: z0 + 4.3, heading: Math.PI, lot: true });
    if (ctx.r() < 0.6) ctx.data.parkedSpots.push({ x, z: z1 - 4.3, heading: 0, lot: true });
  }
  // low walls on non-street sides
  const tr = bs.get('trim');
  if (!sides.n) tr.box(x0, L.CURB_H, z0, x1, 1.4, z0 + 0.3, 2, col('#b0aaa0')), ctx.statics.addBox(x0, x1, z0, z0 + 0.3, 0, 1.4);
  if (!sides.s) tr.box(x0, L.CURB_H, z1 - 0.3, x1, 1.4, z1, 2, col('#b0aaa0')), ctx.statics.addBox(x0, x1, z1 - 0.3, z1, 0, 1.4);
  if (!sides.w) tr.box(x0, L.CURB_H, z0, x0 + 0.3, 1.4, z1, 2, col('#b0aaa0')), ctx.statics.addBox(x0, x0 + 0.3, z0, z1, 0, 1.4);
  if (!sides.e) tr.box(x1 - 0.3, L.CURB_H, z0, x1, 1.4, z1, 2, col('#b0aaa0')), ctx.statics.addBox(x1 - 0.3, x1, z0, z1, 0, 1.4);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  streetLamp(ctx, bs, cx, cz, 0, true);
}

function garageLot(ctx, x0, z0, x1, z1) {
  const bs = ctx.chunk((x0 + x1) / 2, (z0 + z1) / 2);
  // safehouse garage: brick building with large door facing west
  const H = building(ctx, x0 + 8, z0, x1, z1, { style: 'brick', floors: 2, sides: { n: false, s: false, e: false, w: false }, shops: false, tint: [0.8, 0.7, 0.65] });
  // forecourt
  bs.get('asphalt').top(x0, z0, x0 + 8, z1, L.CURB_H + 0.01, 9, [0.8, 0.8, 0.8]);
  const cz = (z0 + z1) / 2; const m = bs.get('metal');
  m.wall(x0 + 7.95, cz - 3.2, x0 + 7.95, cz + 3.2, CURB_H, 4.2, 0, 1, 0, 1, col('#3a6b7a'));
  for (let k = 0; k < 13; k++) m.wall(x0 + 7.93, cz - 3.2, x0 + 7.93, cz + 3.2, CURB_H + k * 0.31, CURB_H + k * 0.31 + 0.05, 0, 1, 0, 1, [0.2, 0.3, 0.35]);
  const sign = makeSign('SAFEHOUSE', 'ウェストサイド・ガレージ', '#e0812d');
  sign.scale.setScalar(0.6); sign.position.set(x0 + 7.9, 5.6, cz); sign.rotation.y = -Math.PI / 2;
  ctx.data.signMeshes = ctx.data.signMeshes || []; ctx.data.signMeshes.push(sign);
  ctx.data.garageDoor = { x: x0 + 3.5, z: cz, heading: Math.PI / 2 };
  streetLamp(ctx, bs, x0 + 1, z0 + 2, Math.PI / 2, false);
}

function boundaryRow(ctx, x0, z0, x1, z1, facing) {
  const { r } = ctx;
  const alongX = facing === 's' || facing === 'n';
  const len = alongX ? x1 - x0 : z1 - z0; let t = 0;
  while (t < len - 6) {
    const w = Math.min(len - t, 14 + r() * 18);
    const sides = { n: facing === 'n', s: facing === 's', e: facing === 'e', w: facing === 'w' };
    const style = r.pick(['brick', 'stucco', 'office', 'glass', 'stucco']);
    const floors = style === 'glass' ? r.int(8, 16) : r.int(3, 8);
    if (alongX) building(ctx, x0 + t, z0, x0 + t + w - 0.5, z1, { style, floors, sides, billboard: true, billboardSide: facing });
    else building(ctx, x0, z0 + t, x1, z0 + t + w - 0.5, { style, floors, sides, billboard: true, billboardSide: facing });
    t += w;
  }
}

function streetLamp(ctx, bs, x, z, yaw, park) {
  const m = bs.get('metal'); const y = L.CURB_H;
  m.cyl(x, y, z, 0.12, 0.08, 6.4, 8, 1, col('#2c3034'));
  const hx = x + Math.sin(yaw) * 1.6, hz = z + Math.cos(yaw) * 1.6;
  m.obox((x + hx) / 2, y + 6.35, (z + hz) / 2, 0.05, 0.05, 0.85, yaw, 1, col('#2c3034'));
  m.obox(hx, y + 6.3, hz, 0.3, 0.1, 0.45, yaw, 1, col('#3a3f44'));
  ctx.statics.addCyl(x, z, 0.18, 6, 'pole');
  ctx.data.lampPoints.push({ x: hx, y: y + 6.18, z: hz, gx: hx, gy: y, gz: hz });
}

function streetProps(ctx, bx, bz, type) {
  const { r, statics, data } = ctx;
  const x0 = L.roadX(bx) + ROAD_HALF, x1 = L.roadX(bx + 1) - ROAD_HALF, z0 = L.roadZ(bz) + ROAD_HALF, z1 = L.roadZ(bz + 1) - ROAD_HALF;
  const y = CURB_H; const inset = 0.9;
  // edges: [start, end, fixed coord, axis, yaw toward road]
  const edges = [
    { a: x0, b: x1, c: z0 + inset, axis: 'x', toRoad: Math.PI, side: 'n' },
    { a: x0, b: x1, c: z1 - inset, axis: 'x', toRoad: 0, side: 's' },
    { a: z0, b: z1, c: x0 + inset, axis: 'z', toRoad: -Math.PI / 2, side: 'w' },
    { a: z0, b: z1, c: x1 - inset, axis: 'z', toRoad: Math.PI / 2, side: 'e' },
  ];
  for (const e of edges) {
    const bs = ctx.chunk(e.axis === 'x' ? (e.a + e.b) / 2 : e.c, e.axis === 'x' ? e.c : (e.a + e.b) / 2);
    const lenE = e.b - e.a;
    const P2 = (t, off = 0) => e.axis === 'x' ? [e.a + t, e.c + (e.side === 'n' ? off : -off)] : [e.c + (e.side === 'w' ? off : -off), e.a + t];
    // lamps every ~24m
    for (let t = 12; t < lenE - 10; t += 23) { const [px, pz] = P2(t); streetLamp(ctx, bs, px, pz, e.toRoad, false); }
    // trees between lamps
    if (type !== 'containers') for (let t = 18; t < lenE - 12; t += 23) {
      if (r() < 0.25) continue;
      const [px, pz] = P2(t, 0.4);
      const tb = bs.get('concrete'); tb.box(px - 0.75, y + 0.005, pz - 0.75, px + 0.75, y + 0.06, pz + 0.75, 1, [0.45, 0.4, 0.35]);
      if (type === 'harbor' || type === 'market' || r() < 0.2) P.palm(bs, px, y, pz, r); else P.tree(bs, px, y, pz, r, 0.9 + r() * 0.3);
      statics.addCyl(px, pz, 0.3, 4, 'tree'); data.treePoints.push({ x: px, z: pz });
    }
    // misc furniture
    for (let t = 8; t < lenE - 8; t += 7) {
      const q = r(); const [px, pz] = P2(t + (r() - 0.5) * 2, 0.15);
      if (q < 0.08) { P.hydrant(bs, px, y, pz); statics.addCyl(px, pz, 0.2, 0.8, 'small'); }
      else if (q < 0.15) { P.trashBin(bs, px, y, pz); statics.addCyl(px, pz, 0.3, 1, 'small'); }
      else if (q < 0.2) { P.newsBox(bs, px, y, pz, e.toRoad, r.pick(['#1f5f8b', '#c0392b', '#f1c40f'])); statics.addCyl(px, pz, 0.3, 1.1, 'small'); }
      else if (q < 0.25 && type !== 'downtown') {
        const [qx, qz] = P2(t, 2.6); P.bench(bs, qx, y, qz, e.toRoad + Math.PI); statics.addCyl(qx, qz, 0.5, 0.9, 'small');
        data.benches.push({ x: qx, z: qz, yaw: e.toRoad + Math.PI });
      }
    }
    // bus stop occasionally
    if (r() < 0.18) { const [px, pz] = P2(lenE / 2 + 5, 1.2); P.busStop(bs, px, y, pz, e.toRoad + Math.PI); statics.addBox(px - 1.2, px + 1.2, pz - 1.2, pz + 1.2, 0, 2.6, 'small'); }
  }
}

function buildPark(ctx, rect) {
  const { r, statics, data } = ctx; const bs = ctx.chunk((rect.x0 + rect.x1) / 2, (rect.z0 + rect.z1) / 2);
  const y = CURB_H; const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
  bs.get('grass').top(rect.x0, rect.z0, rect.x1, rect.z1, y + 0.02, 6, [1, 1, 1]);
  const path = bs.get('pavement'); const pc = [0.95, 0.9, 0.8];
  // paths: cross + ring
  path.top(cx - 2, rect.z0, cx + 2, rect.z1, y + 0.03, 3, pc); path.top(rect.x0, cz - 2, rect.x1, cz + 2, y + 0.03, 3, pc);
  const seg = 40;
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    const R0 = 10, R1 = 13;
    path.quad([cx + Math.sin(a0) * R1, y + 0.035, cz + Math.cos(a0) * R1], [cx + Math.sin(a1) * R1, y + 0.035, cz + Math.cos(a1) * R1], [cx + Math.sin(a1) * R0, y + 0.035, cz + Math.cos(a1) * R0], [cx + Math.sin(a0) * R0, y + 0.035, cz + Math.cos(a0) * R0],
      [a0 * 3, 0, a1 * 3, 0, a1 * 3, 1, a0 * 3, 1], pc);
  }
  // plaza disc
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    path.tri([cx, y + 0.036, cz], [cx + Math.sin(a0) * 10, y + 0.036, cz + Math.cos(a0) * 10], [cx + Math.sin(a1) * 10, y + 0.036, cz + Math.cos(a1) * 10], pc);
  }
  P.fountain(bs, cx, y, cz); statics.addCyl(cx, cz, 6.1, 0.7, 'fountain'); statics.addCyl(cx, cz, 2.5, 4, 'fountain');
  data.fountain = { x: cx, y: y, z: cz };
  // benches around ring
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + Math.PI / 8; const bx = cx + Math.sin(a) * 13.9, bz = cz + Math.cos(a) * 13.9;
    P.bench(bs, bx, y, bz, a + Math.PI); statics.addCyl(bx, bz, 0.6, 0.9, 'small'); data.benches.push({ x: bx, z: bz, yaw: a + Math.PI });
  }
  // lamps along ring (decorative)
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; streetLamp(ctx, bs, cx + Math.sin(a) * 14.6, cz + Math.cos(a) * 14.6, a + Math.PI, true); }
  // trees (avoid paths)
  for (let k = 0; k < 70; k++) {
    const px = rect.x0 + 3 + r() * (rect.x1 - rect.x0 - 6), pz = rect.z0 + 3 + r() * (rect.z1 - rect.z0 - 6);
    const d = Math.hypot(px - cx, pz - cz);
    if (Math.abs(px - cx) < 4 || Math.abs(pz - cz) < 4 || d < 17) continue;
    if (data.treePoints.some((t) => Math.hypot(t.x - px, t.z - pz) < 5)) continue;
    if (r() < 0.3) P.palm(bs, px, y, pz, r); else P.tree(bs, px, y, pz, r, 1 + r() * 0.5);
    statics.addCyl(px, pz, 0.35, 4, 'tree'); data.treePoints.push({ x: px, z: pz });
  }
  // flower beds
  for (let k = 0; k < 14; k++) { const a = r() * Math.PI * 2, d = 16 + r() * 6; const px = cx + Math.sin(a) * d, pz = cz + Math.cos(a) * d; if (Math.abs(px - cx) < 4 || Math.abs(pz - cz) < 4) continue; for (let q = 0; q < 5; q++) P.blob(bs.get('foliage'), px + (r() - 0.5) * 2, y + 0.3, pz + (r() - 0.5) * 2, 0.5, col(r.pick(['#d94f70', '#f2c14e', '#f78154', '#9d4edd', '#5c8a34'])), r); }
  // hedge border with gaps for paths
  const hedge = (x0, z0, x1, z1) => { bs.get('foliage').box(x0, y, z0, x1, y + 1.0, z1, 1, col('#3f6b2a')); statics.addBox(x0, x1, z0, z1, 0, 1.0, 'hedge'); };
  const hx0 = rect.x0 + 0.6, hx1 = rect.x1 - 0.6, hz0 = rect.z0 + 0.6, hz1 = rect.z1 - 0.6, t = 0.8;
  hedge(hx0, hz0, cx - 3, hz0 + t); hedge(cx + 3, hz0, hx1, hz0 + t); hedge(hx0, hz1 - t, cx - 3, hz1); hedge(cx + 3, hz1 - t, hx1, hz1);
  hedge(hx0, hz0 + t, hx0 + t, cz - 3); hedge(hx0, cz + 3, hx0 + t, hz1 - t); hedge(hx1 - t, hz0 + t, hx1, cz - 3); hedge(hx1 - t, cz + 3, hx1, hz1 - t);
  // kiosk
  const kx = cx + 20, kz = cz - 20; const k = bs.get('paint');
  k.box(kx - 2, y, kz - 1.5, kx + 2, y + 2.6, kz + 1.5, 1, col('#2e7d6b')); k.box(kx - 2.4, y + 2.6, kz - 1.9, kx + 2.4, y + 2.8, kz + 1.9, 1, col('#f2e8cf'));
  statics.addBox(kx - 2, kx + 2, kz - 1.5, kz + 1.5, 0, 2.8, 'small');
  data.parkCenter = { x: cx, z: cz };
}

function buildContainerYard(ctx, rect) {
  const { r, statics, data } = ctx; const bs = ctx.chunk((rect.x0 + rect.x1) / 2, (rect.z0 + rect.z1) / 2);
  const y = CURB_H;
  bs.get('concrete').top(rect.x0, rect.z0, rect.x1, rect.z1, y + 0.01, 6, [0.75, 0.74, 0.72]);
  const mk = bs.get('marking');
  for (let x = rect.x0 + 4; x < rect.x1 - 4; x += 9) mk.top(x - 0.08, rect.z0 + 3, x + 0.08, rect.z1 - 3, y + 0.02, 4, col('#e8b923'));
  // fence with gates on north & west
  const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
  const f = (a, b, c, d) => { P.fenceLine(bs, a, b, c, d, y); const t = 0.15; statics.addBox(Math.min(a, c) - t, Math.max(a, c) + t, Math.min(b, d) - t, Math.max(b, d) + t, 0, 2.3, 'fence'); };
  f(rect.x0, rect.z0, cx - 5, rect.z0); f(cx + 5, rect.z0, rect.x1, rect.z0);
  f(rect.x0, rect.z0, rect.x0, cz - 5); f(rect.x0, cz + 5, rect.x0, rect.z1);
  f(rect.x1, rect.z0, rect.x1, rect.z1); f(rect.x0, rect.z1, cx - 6, rect.z1); f(cx + 6, rect.z1, rect.x1, rect.z1);
  // gate sign
  const sign = makeSign('DOCK 7', 'コンテナヤード  関係者以外立入禁止', '#e2a12b'); sign.scale.setScalar(0.45); sign.position.set(cx, 3.2, rect.z0 - 0.1); sign.rotation.y = Math.PI;
  data.signMeshes = data.signMeshes || []; data.signMeshes.push(sign);
  bs.get('metal').box(cx - 5.4, y, rect.z0 - 0.2, cx - 5.1, 3.9, rect.z0 + 0.1, 1, col('#555')); bs.get('metal').box(cx + 5.1, y, rect.z0 - 0.2, cx + 5.4, 3.9, rect.z0 + 0.1, 1, col('#555'));
  // container stacks in rows (leave aisles) -> cover
  const colors = ['#b03a2e', '#1f618d', '#117a65', '#d68910', '#7d3c98', '#566573', '#a04000', '#2e86c1'];
  const rows = [rect.z0 + 9, rect.z0 + 22, rect.z0 + 35, rect.z0 + 48];
  for (const rz of rows) {
    for (let x = rect.x0 + 6; x < rect.x1 - 6; x += 7.2) {
      if (r() < 0.28) continue;
      const stack = r() < 0.4 ? 2 : 1; const yaw = Math.PI / 2;
      for (let s = 0; s < stack; s++) P.container(bs, x, y + s * 2.6, rz, yaw, r.pick(colors));
      statics.addBox(x - 1.25, x + 1.25, rz - 3.05, rz + 3.05, 0, y + stack * 2.6, 'container');
      data.coverPoints.push({ x: x, z: rz - 3.7 }, { x: x, z: rz + 3.7 }, { x: x - 1.9, z: rz }, { x: x + 1.9, z: rz });
    }
  }
  // crates / barrels as low cover
  for (let i = 0; i < 14; i++) {
    const px = rect.x0 + 4 + r() * (rect.x1 - rect.x0 - 8), pz = rect.z0 + 4 + r() * (rect.z1 - rect.z0 - 8);
    if (statics.query(px - 1.6, px + 1.6, pz - 1.6, pz + 1.6).length) continue;
    bs.get('wood').box(px - 0.6, y, pz - 0.6, px + 0.6, y + 1.2, pz + 0.6, 1.2, col('#9c7a4c'));
    statics.addBox(px - 0.6, px + 0.6, pz - 0.6, pz + 0.6, 0, 1.3, 'crate');
  }
  data.yard = { rect, cx, cz };
  // gang spawn positions inside
  for (let i = 0; i < 10; i++) data.enemySpawns.push({ x: rect.x0 + 6 + r() * (rect.x1 - rect.x0 - 12), z: rect.z0 + 12 + r() * (rect.z1 - rect.z0 - 16) });
  // floodlight masts
  for (const [px, pz] of [[rect.x0 + 2, rect.z0 + 2], [rect.x1 - 2, rect.z1 - 2], [rect.x1 - 2, rect.z0 + 2]]) {
    bs.get('metal').cyl(px, y, pz, 0.2, 0.15, 14, 8, 1, col('#555b60')); statics.addCyl(px, pz, 0.25, 14);
    data.lampPoints.push({ x: px, y: 14, z: pz, gx: px + (cx - px) * 0.15, gy: y, gz: pz + (cz - pz) * 0.15 });
  }
}

function buildMarket(ctx, rect) {
  const { r, statics, data } = ctx; const bs = ctx.chunk((rect.x0 + rect.x1) / 2, (rect.z0 + rect.z1) / 2);
  const y = CURB_H; const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
  bs.get('pavement').top(rect.x0, rect.z0, rect.x1, rect.z1, y + 0.01, 3, [0.95, 0.88, 0.8]);
  // market hall (south half) — brick with arched sign
  building(ctx, rect.x0, cz + 4, rect.x1, rect.z1, { style: 'brick', floors: 1, sides: { n: false, s: true, e: true, w: true }, tint: [1, 0.9, 0.8], shops: true });
  const sign = makeSign('HARBOR MARKET', 'ハーバー・マーケット  鮮魚・青果・屋台', '#0e6655'); sign.scale.setScalar(0.8); sign.position.set(cx, 6.6, cz + 3.95); sign.rotation.y = Math.PI;
  data.signMeshes = data.signMeshes || []; data.signMeshes.push(sign);
  // stalls in north half
  const cols = ['#c0392b', '#f39c12', '#16a085', '#2980b9', '#8e44ad', '#d35400'];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
    const sx = rect.x0 + 9 + i * ((rect.x1 - rect.x0 - 18) / 3), sz = rect.z0 + 10 + j * 12;
    P.stall(bs, sx, y, sz, j ? Math.PI : 0, r.pick(cols), r); statics.addBox(sx - 1.5, sx + 1.5, sz - 0.8, sz + 0.8, 0, 1.2, 'stall');
  }
  // string lights posts
  for (let i = 0; i < 4; i++) { const px = rect.x0 + 4 + i * ((rect.x1 - rect.x0 - 8) / 3); bs.get('metal').cyl(px, y, rect.z0 + 3, 0.08, 0.08, 4.5, 6, 1, col('#333')); data.lampPoints.push({ x: px, y: 4.6, z: rect.z0 + 3, gx: px, gy: y, gz: rect.z0 + 5 }); }
  data.marketDrop = { x: cx, z: rect.z0 - 2.5 - WALK_W };
  data.marketCenter = { x: cx, z: rect.z0 + 16 };
}

function buildShowroom(ctx, rect) {
  const { r, statics, data } = ctx; const bs = ctx.chunk((rect.x0 + rect.x1) / 2, (rect.z0 + rect.z1) / 2);
  const y = CURB_H; const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
  // glass showroom in north half
  const z1 = cz - 2;
  const g = bs.get('glass'), m = bs.get('metal');
  const H = 7;
  bs.get('roof').top(rect.x0, rect.z0, rect.x1, z1, H, 6, [1, 1, 1]);
  bs.get('trim').box(rect.x0 - 0.3, H, rect.z0 - 0.3, rect.x1 + 0.3, H + 0.8, z1 + 0.3, 2, col('#e8e8e8'));
  g.wall(rect.x0, z1, rect.x1, z1, y, H, 0, 1, 0, 1, col('#a8c8d8'));
  g.wall(rect.x1, z1, rect.x1, rect.z0, y, H, 0, 1, 0, 1, col('#a8c8d8'));
  g.wall(rect.x0, rect.z0, rect.x0, z1, y, H, 0, 1, 0, 1, col('#a8c8d8'));
  bs.get('trim').wall(rect.x1, rect.z0, rect.x0, rect.z0, y, H, 0, 10, 0, 2, col('#dcdcdc'));
  for (let x = rect.x0; x <= rect.x1; x += 6) m.box(x - 0.15, y, z1 - 0.15, x + 0.15, H, z1 + 0.15, 1, col('#c8ccd0'));
  bs.get('pavement').top(rect.x0, rect.z0, rect.x1, z1, y + 0.02, 2, [0.95, 0.95, 0.97]);
  statics.addBox(rect.x0, rect.x1, z1 - 0.2, z1 + 0.2, 0, H, 'glass');
  statics.addBox(rect.x0 - 0.2, rect.x0 + 0.2, rect.z0, z1, 0, H, 'glass');
  statics.addBox(rect.x1 - 0.2, rect.x1 + 0.2, rect.z0, z1, 0, H, 'glass');
  statics.addBox(rect.x0, rect.x1, rect.z0 - 0.2, rect.z0 + 0.2, 0, H, 'glass');
  // display lot
  bs.get('asphalt').top(rect.x0, z1, rect.x1, rect.z1, y + 0.01, 9, [0.75, 0.75, 0.78]);
  const sign = makeSign('BAYLINE MOTORS', 'ベイライン自動車  新車・中古車', '#c0392b'); sign.position.set(cx, H + 2.4, z1 + 0.3); sign.scale.setScalar(0.9);
  data.signMeshes = data.signMeshes || []; data.signMeshes.push(sign);
  // flags
  for (let x = rect.x0 + 3; x < rect.x1; x += 8) { m.cyl(x, y, rect.z1 - 1, 0.05, 0.05, 6, 6, 1, col('#ddd')); bs.get('paint').obox(x + 0.6, y + 5.3, rect.z1 - 1, 0.6, 0.7, 0.01, 0, 1, col(r.pick(['#c0392b', '#f1c40f', '#2980b9']))); statics.addCyl(x, rect.z1 - 1, 0.1, 6); }
  data.showroomLot = { x: cx, z: (z1 + rect.z1) / 2 + 2 };
  data.showroomInside = [{ x: cx - 12, z: (rect.z0 + z1) / 2 }, { x: cx + 12, z: (rect.z0 + z1) / 2 }];
  data.lampPoints.push({ x: cx - 10, y: H - 0.3, z: (rect.z0 + z1) / 2, gx: cx - 10, gy: y, gz: (rect.z0 + z1) / 2 }, { x: cx + 10, y: H - 0.3, z: (rect.z0 + z1) / 2, gx: cx + 10, gy: y, gz: (rect.z0 + z1) / 2 });
}

function buildPromenade(ctx, x0, x1) {
  const { r, statics, data } = ctx;
  const z0 = L.CITY_MAX_Z + ROAD_HALF, z1 = L.QUAY_Z; const y = CURB_H;
  for (let x = x0 + 4; x < x1 - 4; x += 12) {
    const bs = ctx.chunk(x, z0 + 5);
    if (x > L.roadX(3) + 10 && x < L.roadX(4) - 10) continue; // crane zone
    P.palm(bs, x, y, z1 - 4.5, r); statics.addCyl(x, z1 - 4.5, 0.3, 6, 'tree'); data.treePoints.push({ x, z: z1 - 4.5 });
    if ((x / 12 | 0) % 2 === 0) { P.bench(bs, x + 5, y, z1 - 2.6, 0); statics.addCyl(x + 5, z1 - 2.6, 0.6, 0.9); data.benches.push({ x: x + 5, z: z1 - 2.6, yaw: 0 }); }
    else streetLamp(ctx, bs, x + 6, z1 - 1.6, Math.PI, true);
  }
  for (let x = x0; x < x1; x += 20) P.railing(ctx.chunk(x + 10, z1), x, z1 - 0.3, Math.min(x + 20, x1), z1 - 0.3, y);
  // piers + boats
  const piers = [L.roadX(1) + 20, L.roadX(2) + 30, L.roadX(4) + 50];
  for (const px of piers) {
    const bs = ctx.chunk(px, z1 + 10);
    bs.get('wood').box(px - 2, -0.6, z1, px + 2, -0.3, z1 + 28, 1, col('#7a5c3e'));
    for (let k = 0; k < 8; k++) bs.get('wood').cyl(px + (k % 2 ? 2 : -2), -4, z1 + 2 + Math.floor(k / 2) * 8, 0.18, 0.18, 4, 6, 1, col('#5a4330'));
    P.boat(bs, px + 5.5, -1.3, z1 + 12, 0.05, r, 10); P.boat(bs, px - 5.8, -1.3, z1 + 18, -0.08, r, 8);
  }
  // gantry crane at the container yard quay
  const cxr = (L.roadX(3) + L.roadX(4)) / 2; P.gantryCrane(ctx.chunk(cxr, z1), cxr, y, z1 - 6, 0, r);
  for (const lx of [-9, 9]) statics.addBox(cxr + lx - 0.6, cxr + lx + 0.6, z1 - 11.6, z1 - 10.4, 0, 28), statics.addBox(cxr + lx - 0.6, cxr + lx + 0.6, z1 - 1.6, z1 - 0.4, 0, 28);
}

function makeWater(normalTex) {
  normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping;
  const geo = new THREE.PlaneGeometry(2400, 1200, 1, 1); geo.rotateX(-Math.PI / 2); geo.translate(0, -1.2, L.QUAY_Z + 600);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1d4a5c, roughness: 0.08, metalness: 0.9, normalMap: normalTex, normalScale: new THREE.Vector2(0.35, 0.35) });
  normalTex.repeat.set(160, 80);
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; mesh.name = 'water';
  return { mesh, update: (t) => { normalTex.offset.set(t * 0.004, t * 0.0025); } };
}

function makeDistant(r) {
  const g = new THREE.Group();
  const b = new Batch();
  // mountain ring across the bay and behind the city
  const ring = (R, cxo, czo, count, hmin, hmax, colr, arcA, arcB) => {
    for (let i = 0; i < count; i++) {
      const a0 = arcA + (arcB - arcA) * i / count, a1 = arcA + (arcB - arcA) * (i + 1) / count;
      const h0 = hmin + (hmax - hmin) * (0.5 + 0.5 * Math.sin(i * 0.9 + r() * 2)), h1 = hmin + (hmax - hmin) * (0.5 + 0.5 * Math.sin((i + 1) * 0.9 + r() * 2));
      const p0 = [cxo + Math.sin(a0) * R, -2, czo + Math.cos(a0) * R], p1 = [cxo + Math.sin(a1) * R, -2, czo + Math.cos(a1) * R];
      b.quad(p1, p0, [p0[0], h0, p0[2]], [p1[0], h1, p1[2]], [0, 0, 1, 0, 1, 1, 0, 1], colr);
    }
  };
  ring(900, 0, 300, 60, 40, 140, [0.42, 0.5, 0.55], Math.PI * 0.55, Math.PI * 1.45);   // north hills behind city
  ring(1100, 0, 0, 50, 30, 90, [0.48, 0.56, 0.62], -Math.PI * 0.45, Math.PI * 0.45);  // across the bay
  const m = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide }));
  g.add(m);
  // distant skyline silhouettes beyond the boundary
  const sb = new Batch();
  for (let i = 0; i < 90; i++) {
    const a = Math.PI * 0.55 + r() * Math.PI * 0.9, d = 330 + r() * 160;
    const x = Math.sin(a) * d, z = Math.cos(a) * d * 0.9 - 40, w = 12 + r() * 20, h = 20 + r() * 90;
    sb.box(x - w / 2, 0, z - w / 2, x + w / 2, h, z + w / 2, 10, [0.5 + r() * 0.1, 0.55 + r() * 0.1, 0.62 + r() * 0.1]);
  }
  const sm = new THREE.Mesh(sb.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  sm.name = 'skyline'; g.add(sm);
  // lighthouse
  const lb = new Batch(); lb.cyl(260, -2, L.QUAY_Z + 230, 4, 2.6, 26, 12, 1, [0.95, 0.95, 0.92]); lb.cyl(260, 24, L.QUAY_Z + 230, 2.8, 2.8, 3, 12, 1, [0.8, 0.15, 0.12]);
  lb.cyl(220, -3, L.QUAY_Z + 230, 60, 40, 3, 16, 1, [0.4, 0.45, 0.35]);
  g.add(new THREE.Mesh(lb.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
  return g;
}
