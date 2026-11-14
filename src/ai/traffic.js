// Ambient traffic: keeps a population of NPC-driven cars around the player.
import * as L from '../world/layout.js';
import { DriverAI } from './driver.js';
import { pick } from '../core/utils.js';

const CIVIL = ['NormalCar1', 'NormalCar1', 'NormalCar2', 'NormalCar2', 'SUV', 'SUV', 'Taxi', 'Taxi', 'SportsCar', 'SportsCar2'];

export class Traffic {
  constructor(game) { this.game = game; this.target = 16; this.spawnT = 0; }
  get cars() { return this.game.vehicles.filter((v) => v.ai && v.ai.kind === 'traffic'); }
  spawnOne(near = false) {
    const g = this.game; const pp = g.focusPos();
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.floor(Math.random() * L.NODE_COUNT); const nbs = L.nodeNeighbors(a); const b = nbs[Math.floor(Math.random() * nbs.length)];
      const t = 0.15 + Math.random() * 0.7;
      const A = L.nodePos(a), B = L.nodePos(b);
      const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t;
      const d = Math.hypot(x - pp.x, z - pp.z);
      if (near ? (d < 25 || d > 140) : (d < 70 || d > 160)) continue;
      if (!near && g.isVisible(x, 1, z, 6) && d < 120) continue;
      if (g.vehicles.some((v) => Math.hypot(v.pos.x - x, v.pos.z - z) < 14)) continue;
      const v = g.spawnVehicle(pick(CIVIL), 0, 0, 0);
      v.ai = new DriverAI(g, v, { kind: 'traffic' });
      v.ai.placeOnLane(a, b, t);
      v.driver = g.spawnDriverFor(v);
      return v;
    }
    return null;
  }
  update(dt) {
    const g = this.game; const pp = g.focusPos();
    const cars = this.cars;
    this.spawnT -= dt;
    if (cars.length < this.target && this.spawnT <= 0) { this.spawnOne(); this.spawnT = 0.35; }
    for (const v of cars) {
      const d = Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z);
      if (d > 190 || (d > 130 && !g.isVisible(v.pos.x, 1, v.pos.z, 4)) || (v.dead && d > 80)) { g.removeVehicle(v); continue; }
      if (v.driver && v.ai) v.ai.update(dt);
    }
  }
}
