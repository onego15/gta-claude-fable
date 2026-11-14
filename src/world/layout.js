// City layout: a grid of blocks separated by two-lane streets, with a harbor to the south.
// Everything spatial (roads, sidewalks, lots, ground height, landmarks) is derived from here.

export const BLOCKS_X = 5;
export const BLOCKS_Z = 5;
export const PITCH = 84;               // distance between road center lines
export const ROAD_HALF = 7.5;          // half width of asphalt
export const LANE_OFF = 2.4;           // lane center offset from road center
export const PARK_OFF = 5.7;           // parking lane center offset
export const WALK_W = 5;               // sidewalk width
export const CURB_H = 0.16;            // sidewalk height
export const X0 = -(BLOCKS_X * PITCH) / 2;  // first road center x
export const Z0 = -(BLOCKS_Z * PITCH) / 2;
export const ROADS_X = BLOCKS_X + 1;   // number of N-S roads
export const ROADS_Z = BLOCKS_Z + 1;
export const CITY_MIN_X = X0, CITY_MAX_X = X0 + BLOCKS_X * PITCH;
export const CITY_MIN_Z = Z0, CITY_MAX_Z = Z0 + BLOCKS_Z * PITCH;
export const QUAY_Z = CITY_MAX_Z + ROAD_HALF + 16;   // water edge (south)
export const WORLD_LIMIT = { minX: CITY_MIN_X - 26, maxX: CITY_MAX_X + 26, minZ: CITY_MIN_Z - 26, maxZ: QUAY_Z - 0.6 };

export const roadX = (i) => X0 + i * PITCH;
export const roadZ = (j) => Z0 + j * PITCH;

// Block interior rectangle (inside sidewalks)
export function blockRect(bx, bz) {
  const x0 = roadX(bx) + ROAD_HALF + WALK_W, x1 = roadX(bx + 1) - ROAD_HALF - WALK_W;
  const z0 = roadZ(bz) + ROAD_HALF + WALK_W, z1 = roadZ(bz + 1) - ROAD_HALF - WALK_W;
  return { x0, x1, z0, z1 };
}

// District / special block assignment
export const DISTRICT = {
  DOWNTOWN: 'downtown', MIDTOWN: 'midtown', RESIDENTIAL: 'residential', HARBOR: 'harbor', PARK: 'park',
};

export function blockType(bx, bz) {
  if (bx === 2 && bz === 2) return 'park';
  if (bx === 3 && bz === 4) return 'containers';
  if (bx === 1 && bz === 4) return 'market';
  if (bx === 4 && bz === 0) return 'showroom';
  if (bx === 0 && bz === 3) return 'garage';
  if (bz === 4) return DISTRICT.HARBOR;
  if (bz <= 1 && bx >= 2) return DISTRICT.DOWNTOWN;
  if (bx <= 1) return DISTRICT.RESIDENTIAL;
  return DISTRICT.MIDTOWN;
}

export const DISTRICT_NAMES = {
  downtown: 'ソレイユ・ダウンタウン', midtown: 'ミッドタウン', residential: 'オールド・ヒル', harbor: 'ハーバー地区',
  park: 'メリディアン公園', containers: '第7コンテナヤード', market: 'ハーバー・マーケット', showroom: 'ベイライン自動車', garage: 'ウェストサイド',
};

export function districtAt(x, z) {
  const bx = Math.floor((x - X0) / PITCH), bz = Math.floor((z - Z0) / PITCH);
  if (z > CITY_MAX_Z + ROAD_HALF) return 'ハーバー・プロムナード';
  if (bx < 0 || bz < 0 || bx >= BLOCKS_X || bz >= BLOCKS_Z) return '外周道路';
  return DISTRICT_NAMES[blockType(bx, bz)];
}

// Is a point on asphalt?
export function onRoad(x, z) {
  const fx = ((x - X0) % PITCH + PITCH) % PITCH, fz = ((z - Z0) % PITCH + PITCH) % PITCH;
  const nearX = Math.min(fx, PITCH - fx) <= ROAD_HALF && x >= X0 - ROAD_HALF && x <= CITY_MAX_X + ROAD_HALF && z >= Z0 - ROAD_HALF && z <= CITY_MAX_Z + ROAD_HALF;
  const nearZ = Math.min(fz, PITCH - fz) <= ROAD_HALF && z >= Z0 - ROAD_HALF && z <= CITY_MAX_Z + ROAD_HALF && x >= X0 - ROAD_HALF && x <= CITY_MAX_X + ROAD_HALF;
  return nearX || nearZ;
}

export function groundHeight(x, z) {
  if (onRoad(x, z)) return 0;
  if (z > QUAY_Z) return -3;
  return CURB_H;
}

// ---- Road graph for vehicles ------------------------------------------------
// Nodes are intersections (i,j). Edges connect neighbours. Lane positions are offset to the right.
export const nodeId = (i, j) => j * ROADS_X + i;
export const nodePos = (id) => ({ x: roadX(id % ROADS_X), z: roadZ(Math.floor(id / ROADS_X)) });
export function nodeNeighbors(id) {
  const i = id % ROADS_X, j = Math.floor(id / ROADS_X), out = [];
  if (i > 0) out.push(nodeId(i - 1, j));
  if (i < ROADS_X - 1) out.push(nodeId(i + 1, j));
  if (j > 0) out.push(nodeId(i, j - 1));
  if (j < ROADS_Z - 1) out.push(nodeId(i, j + 1));
  return out;
}
export const NODE_COUNT = ROADS_X * ROADS_Z;

export function nearestNode(x, z) {
  const i = Math.max(0, Math.min(ROADS_X - 1, Math.round((x - X0) / PITCH)));
  const j = Math.max(0, Math.min(ROADS_Z - 1, Math.round((z - Z0) / PITCH)));
  return nodeId(i, j);
}

// A* over the intersection grid (uniform cost); returns list of node ids
export function findPath(fromId, toId) {
  if (fromId === toId) return [fromId];
  const open = new Map([[fromId, 0]]), came = new Map(), g = new Map([[fromId, 0]]);
  const h = (a) => { const p = nodePos(a), q = nodePos(toId); return Math.abs(p.x - q.x) + Math.abs(p.z - q.z); };
  while (open.size) {
    let cur = -1, best = Infinity;
    for (const [n] of open) { const f = g.get(n) + h(n); if (f < best) { best = f; cur = n; } }
    if (cur === toId) { const path = [cur]; while (came.has(cur)) { cur = came.get(cur); path.unshift(cur); } return path; }
    open.delete(cur);
    for (const nb of nodeNeighbors(cur)) {
      const t = g.get(cur) + PITCH;
      if (t < (g.get(nb) ?? Infinity)) { g.set(nb, t); came.set(nb, cur); open.set(nb, t); }
    }
  }
  return [fromId];
}

// Closest point on the road network (center line) and its direction axis
export function nearestRoadPoint(x, z) {
  const i = Math.round((x - X0) / PITCH), j = Math.round((z - Z0) / PITCH);
  const rx = roadX(Math.max(0, Math.min(ROADS_X - 1, i))), rz = roadZ(Math.max(0, Math.min(ROADS_Z - 1, j)));
  const cx = Math.max(CITY_MIN_X, Math.min(CITY_MAX_X, x)), cz = Math.max(CITY_MIN_Z, Math.min(CITY_MAX_Z, z));
  const dX = Math.abs(x - rx), dZ = Math.abs(z - rz);
  if (dX < dZ) return { x: rx, z: cz, axis: 'z' };
  return { x: cx, z: rz, axis: 'x' };
}

// ---- Landmarks --------------------------------------------------------------
const bc = (bx, bz) => ({ x: roadX(bx) + PITCH / 2, z: roadZ(bz) + PITCH / 2 });
export const LANDMARKS = {
  playerStart: { x: roadX(2) + 10.5, z: roadZ(3) + 30, heading: Math.PI },
  hospital: { x: roadX(3) + ROAD_HALF + 2.5, z: roadZ(1) + 40, name: 'セント・メリディアン病院' },
  policeStation: { x: roadX(1) - ROAD_HALF - 2.5, z: roadZ(2) + 42, name: '市警 中央分署' },
  park: bc(2, 2),
  containers: bc(3, 4),
  market: bc(1, 4),
  showroom: bc(4, 0),
  garage: { x: roadX(0) + ROAD_HALF + WALK_W + 9, z: roadZ(3) + PITCH / 2 },
};

export const SIGNALIZED = (id) => nodeNeighbors(id).length >= 3;
