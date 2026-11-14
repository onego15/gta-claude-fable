// Arcade vehicle physics + visuals built from the Quaternius car models.
import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/utils.js';
import { groundHeight } from '../world/layout.js';

const TRIM_NAMES = ['black', 'grey', 'gray'];
export const CAR_SPECS = {
  NormalCar1: { label: 'メリディアン・セダン', mass: 1300, maxSpeed: 38, accel: 9.5, grip: 9, steer: 0.62, paint: true },
  NormalCar2: { label: 'ハーバー・ワゴン', mass: 1400, maxSpeed: 36, accel: 9, grip: 9, steer: 0.6, paint: true },
  SUV: { label: 'ランバー SUV', mass: 1900, maxSpeed: 37, accel: 9.5, grip: 8.5, steer: 0.56, paint: true },
  SportsCar: { label: 'ボルト GT', mass: 1250, maxSpeed: 52, accel: 15, grip: 10.5, steer: 0.62, paint: true },
  SportsCar2: { label: 'ストラーダ RS', mass: 1250, maxSpeed: 50, accel: 14, grip: 10.5, steer: 0.64, paint: true },
  Taxi: { label: 'ベイ・キャブ', mass: 1400, maxSpeed: 39, accel: 10, grip: 9, steer: 0.6, paint: false },
  Cop: { label: 'PMPD インターセプター', mass: 1500, maxSpeed: 47, accel: 13.5, grip: 10, steer: 0.62, paint: false, police: true },
  Cop_SUV: { label: 'PMPD ユーティリティ', mass: 2000, maxSpeed: 43, accel: 12, grip: 9.5, steer: 0.58, paint: false, police: true },
};
const PAINTS = ['#c0392b', '#2c3e50', '#ecf0f1', '#7f8c8d', '#1f5f8b', '#16a085', '#f39c12', '#8e44ad', '#111111', '#d35400', '#2e4053', '#b03a2e', '#5d6d7e', '#e8daef', '#a3e4d7', '#784212', '#f4d03f'];

// ---------- templates ----------
export function buildCarTemplates(assets) {
  const out = {};
  for (const [name, gltf] of Object.entries(assets.cars)) {
    const scene = gltf.scene; scene.updateMatrixWorld(true);
    const parts = { paint: [], trim: [], glass: [], head: [], tail: [], beaconA: [], beaconB: [] };
    const wheels = [];
    let paintName = null;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const geo = dequantize(o.geometry.clone()); geo.applyMatrix4(o.matrixWorld);
      if (/wheel/i.test(o.name)) {
        geo.computeBoundingBox(); const c = new THREE.Vector3(); geo.boundingBox.getCenter(c);
        const size = new THREE.Vector3(); geo.boundingBox.getSize(size);
        geo.translate(-c.x, -c.y, -c.z);
        const baked = bakeColors(geo, mats);
        wheels.push({ name: o.name, geo: baked, center: c, radius: size.y / 2, front: /front/i.test(o.name), left: /left/i.test(o.name) });
        return;
      }
      const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.index ? geo.index.count : geo.attributes.position.count, materialIndex: 0 }];
      for (const gr of groups) {
        const m = mats[gr.materialIndex]; const n = (m.name || '').toLowerCase();
        let cat = 'trim';
        if (n.includes('window')) cat = 'glass';
        else if (n.includes('headlight')) cat = 'head';
        else if (n.includes('taillight')) cat = 'tail';
        else if (n.includes('bluelight')) cat = 'beaconA';
        else if (n.includes('whitelight')) cat = 'beaconB';
        else if (TRIM_NAMES.some((t) => n.includes(t))) cat = 'trim';
        else { cat = 'paint'; paintName = paintName || m.name; }
        parts[cat].push(extractGroup(geo, gr, m.color));
      }
    });
    const merged = {};
    for (const [k, list] of Object.entries(parts)) if (list.length) merged[k] = mergeGeos(list);
    const box = new THREE.Box3(); for (const g of Object.values(merged)) { g.computeBoundingBox(); box.union(g.boundingBox); }
    const size = new THREE.Vector3(); box.getSize(size);
    // original paint color as default
    let paintColor = '#cccccc';
    scene.traverse((o) => { if (o.isMesh) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m.name === paintName) paintColor = '#' + m.color.getHexString(); });
    const frontZ = Math.max(...wheels.filter((w) => w.front).map((w) => w.center.z), 1.3);
    const rearZ = Math.min(...wheels.filter((w) => !w.front).map((w) => w.center.z), -1.3);
    out[name] = { name, parts: merged, wheels, half: new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2), height: size.y, wheelBase: frontZ - rearZ, paintColor, spec: CAR_SPECS[name] };
  }
  return out;
}
// meshopt/quantized GLBs store positions & normals as normalized int arrays; bake to float before transforming
function dequantize(geo) {
  for (const name of ['position', 'normal']) {
    const a = geo.attributes[name]; if (!a || (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute)) continue;
    const out = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) { out[i * 3] = a.getX(i); out[i * 3 + 1] = a.getY(i); out[i * 3 + 2] = a.getZ(i); }
    geo.setAttribute(name, new THREE.BufferAttribute(out, 3));
  }
  if (geo.attributes.normal) geo.attributes.normal.normalized = false;
  return geo;
}
function extractGroup(geo, gr, color) {
  const g = new THREE.BufferGeometry();
  const idx = geo.index; const pos = geo.attributes.position, nor = geo.attributes.normal;
  const P = [], N = [], Cc = [];
  for (let i = gr.start; i < gr.start + gr.count; i++) {
    const v = idx ? idx.getX(i) : i;
    P.push(pos.getX(v), pos.getY(v), pos.getZ(v)); N.push(nor.getX(v), nor.getY(v), nor.getZ(v)); Cc.push(color.r, color.g, color.b);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
  return g;
}
function bakeColors(geo, mats) {
  const parts = [];
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.index ? geo.index.count : geo.attributes.position.count, materialIndex: 0 }];
  for (const gr of groups) parts.push(extractGroup(geo, gr, mats[gr.materialIndex].color));
  return mergeGeos(parts);
}
function mergeGeos(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3); let o = 0;
  for (const g of list) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); C.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(P, 3)); m.setAttribute('normal', new THREE.BufferAttribute(N, 3)); m.setAttribute('color', new THREE.BufferAttribute(C, 3));
  m.computeBoundingSphere(); return m;
}

const sharedMats = {
  trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x1a2630, roughness: 0.05, metalness: 0.9, envMapIntensity: 1.6 }),
  wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 }),
  burnt: new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.95 }),
};

// ---------- vehicle ----------
let VID = 0;
export class Vehicle {
  constructor(tpl, opts = {}) {
    this.id = ++VID; this.tpl = tpl; this.spec = { ...tpl.spec, ...(opts.spec || {}) }; this.model = tpl.name;
    this.police = !!this.spec.police;
    this.root = new THREE.Group(); this.root.name = 'vehicle_' + tpl.name;
    this.body = new THREE.Group(); this.root.add(this.body);
    const paint = opts.paint || (this.spec.paint ? PAINTS[Math.floor(Math.random() * PAINTS.length)] : tpl.paintColor);
    this.paintMat = new THREE.MeshPhysicalMaterial({ color: paint, roughness: 0.32, metalness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.15 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xfff1d6, emissiveIntensity: 0.0, roughness: 0.2 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x8a1010, emissive: 0xff2010, emissiveIntensity: 0.1, roughness: 0.3 });
    this.beaconAMat = new THREE.MeshStandardMaterial({ color: 0x1030ff, emissive: 0x1a3cff, emissiveIntensity: 0, roughness: 0.3 });
    this.beaconBMat = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff1a1a, emissiveIntensity: 0, roughness: 0.3 });
    const P = tpl.parts;
    const add = (geo, mat) => { if (!geo) return null; const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; this.body.add(m); return m; };
    this.paintMesh = add(P.paint, this.paintMat); add(P.trim, sharedMats.trim); add(P.glass, sharedMats.glass);
    add(P.head, this.headMat); add(P.tail, this.tailMat); add(P.beaconA, this.beaconAMat); add(P.beaconB, this.beaconBMat);
    this.wheels = [];
    for (const w of tpl.wheels) {
      const pivot = new THREE.Group(); pivot.position.copy(w.center);
      const spin = new THREE.Group(); pivot.add(spin);
      const m = new THREE.Mesh(w.geo, sharedMats.wheel); m.castShadow = true; spin.add(m);
      this.root.add(pivot); this.wheels.push({ pivot, spin, front: w.front, radius: w.radius });
    }
    this.half = tpl.half; this.hx = tpl.half.x * 0.96; this.hz = tpl.half.z * 0.97;
    this.wheelBase = tpl.wheelBase;
    // state
    this.pos = new THREE.Vector3(); this.heading = 0; this.vx = 0; this.vz = 0; this.angVel = 0;
    this.throttle = 0; this.brake = 0; this.steer = 0; this.handbrake = 0; this.steerVis = 0;
    this.driver = null; this.health = 1000; this.dead = false; this.burnTimer = 0;
    this.pitch = 0; this.roll = 0; this.pitchV = 0; this.rollV = 0; this.lastSpeedF = 0;
    this.sirenOn = false; this.lightsOn = false; this.slip = 0; this.horn = 0;
    this.mass = this.spec.mass; this.sleeping = false; this.wheelSpin = 0; this.y = 0;
    this.locked = false; this.lastHitTime = -10; this.damageTint = 0; this.allowReverse = true;
    this.onImpact = null;
  }
  get speed() { return Math.hypot(this.vx, this.vz); }
  get forwardSpeed() { return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading); }
  place(x, z, heading) { this.pos.set(x, groundHeight(x, z), z); this.heading = heading; this.vx = this.vz = this.angVel = 0; this.syncVisual(0); }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  rightVec(out = new THREE.Vector3()) { return out.set(-Math.cos(this.heading), 0, Math.sin(this.heading)); }
  driverDoor(out = new THREE.Vector3()) {
    // driver sits on the left (right-hand traffic) -> -right
    const r = this.rightVec(); return out.copy(this.pos).addScaledVector(r, -(this.hx + 0.75)).addScaledVector(this.forward(), 0.3);
  }
  passengerDoor(out = new THREE.Vector3()) { const r = this.rightVec(); return out.copy(this.pos).addScaledVector(r, this.hx + 0.75).addScaledVector(this.forward(), 0.3); }

  update(dt, statics) {
    if (this.dead) { this.throttle = 0; this.brake = 1; this.steer = 0; }
    const s = this.spec;
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    let vF = this.vx * sh + this.vz * ch;
    let vR = this.vx * -ch + this.vz * sh;
    const absF = Math.abs(vF);
    // engine / brake
    let accF = 0;
    const thr = this.throttle, brk = this.brake;
    if (thr > 0) {
      const lim = s.maxSpeed; accF += thr * s.accel * clamp(1 - Math.max(0, vF) / lim, 0, 1) * (vF < -0.5 ? 2.2 : 1);
    }
    if (brk > 0) {
      if (vF > 0.6) accF -= brk * 22;
      else if (this.allowReverse) accF -= brk * s.accel * 0.6 * clamp(1 - Math.max(0, -vF) / 11, 0, 1); // reverse
      else if (vF > 0) accF -= Math.min(vF / dt, brk * 22);
    }
    if (this.handbrake > 0) accF -= Math.sign(vF) * Math.min(absF / dt, 7 * this.handbrake);
    // drag & rolling resistance
    accF -= vF * absF * 0.0028 + Math.sign(vF) * (thr === 0 && brk === 0 ? 1.6 : 0.3);
    if (Math.abs(vF) < 0.15 && thr === 0) { vF = 0; accF = 0; }
    vF += accF * dt;
    // lateral grip
    const gripBase = s.grip * (this.handbrake > 0 ? 0.18 : 1) * (this.dead ? 0.5 : 1);
    const slipFactor = clamp(1 - (Math.abs(vR) - 3) / 10, 0.35, 1);
    vR *= Math.exp(-gripBase * slipFactor * dt);
    this.slip = Math.abs(vR) + (this.handbrake > 0 ? absF * 0.15 : 0) + (thr > 0.9 && absF < 6 && s.accel > 12 ? 2 : 0);
    // steering
    const steerLimit = s.steer * clamp(1.2 - absF / 55, 0.32, 1);
    this.steerVis = damp(this.steerVis, this.steer * steerLimit, 10, dt);
    const targetYaw = (vF * Math.tan(this.steerVis)) / this.wheelBase * (this.handbrake > 0 ? 1.5 : 1);
    this.angVel = damp(this.angVel, targetYaw, this.handbrake > 0 ? 4 : 9, dt);
    this.heading += this.angVel * dt;
    // rebuild world velocity in new frame
    const nh = Math.sin(this.heading), nc = Math.cos(this.heading);
    this.vx = nh * vF + -nc * vR; this.vz = nc * vF + nh * vR;
    this.pos.x += this.vx * dt; this.pos.z += this.vz * dt;
    // statics collision
    if (statics) {
      const res = statics.resolveOBB(this.pos.x, this.pos.z, this.hx, this.hz, this.heading, this.pos.y + 0.2, this.pos.y + this.tpl.height);
      if (res.hit) {
        this.pos.x += res.nx * res.depth; this.pos.z += res.nz * res.depth;
        const vn = this.vx * res.nx + this.vz * res.nz;
        if (vn < 0) {
          const e = 0.25; this.vx -= (1 + e) * vn * res.nx; this.vz -= (1 + e) * vn * res.nz;
          this.vx *= 0.92; this.vz *= 0.92;
          // spin from off-center impact
          const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
          const side = fx * res.nz - fz * res.nx; this.angVel += side * vn * 0.03;
          if (-vn > 2.5) this.impact(-vn, res.tag);
        }
      }
    }
    // ground following (curbs)
    const gh = groundHeight(this.pos.x, this.pos.z);
    this.y = damp(this.y, gh, 18, dt); this.pos.y = this.y;
    // body dynamics (visual)
    const aF = (vF - this.lastSpeedF) / Math.max(dt, 1e-4); this.lastSpeedF = vF;
    const aR = vF * this.angVel;
    const k = 60, c = 9;
    this.pitchV += (-clamp(aF, -25, 25) * 0.0035 - this.pitch) * k * dt - this.pitchV * c * dt; this.pitch += this.pitchV * dt;
    this.rollV += (clamp(aR, -30, 30) * 0.0045 - this.roll) * k * dt - this.rollV * c * dt; this.roll += this.rollV * dt;
    this.wheelSpin += vF / 0.36 * dt;
    this.simTime = (this.simTime || 0) + dt;
    if (this.burnTimer > 0) { this.burnTimer -= dt; if (this.burnTimer <= 0 && !this.dead) this.explode(); }
    this.syncVisual(dt);
  }
  syncVisual() {
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.heading, 0);
    this.body.rotation.set(this.pitch, 0, this.roll);
    for (const w of this.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      w.pivot.rotation.y = w.front ? this.steerVis : 0;
    }
  }
  impact(speed, tag, other) {
    const now = this.simTime || 0;
    if (now - this.lastHitTime > 0.3) {
      this.lastHitTime = now;
      const s = Math.max(0, speed - 4); this.damage(s * s * 0.95);
      if (this.onImpact) this.onImpact(this, speed, tag, other);
    }
  }
  damage(amount) {
    if (this.dead) return;
    this.health -= amount;
    this.damageTint = clamp(1 - this.health / 1000, 0, 1);
    if (this.health < 160 && this.burnTimer <= 0) this.burnTimer = 7;
    if (this.health <= 0) this.explode();
  }
  explode() {
    if (this.dead) return;
    this.dead = true; this.health = 0; this.burnTimer = 0;
    this.paintMesh && (this.paintMesh.material = sharedMats.burnt);
    this.headMat.emissiveIntensity = 0; this.tailMat.emissiveIntensity = 0;
    this.sirenOn = false;
    this.vx *= 0.3; this.vz *= 0.3;
    if (this.onExplode) this.onExplode(this);
  }
  updateLights(night, time) {
    const braking = this.brake > 0.1 && this.forwardSpeed > 0.5;
    const hasDriver = !!this.driver;
    this.headMat.emissiveIntensity = this.dead ? 0 : hasDriver ? lerp(0.6, 3.5, night) : 0;
    this.tailMat.emissiveIntensity = this.dead ? 0 : (hasDriver ? lerp(0.15, 1.2, night) : 0.05) + (braking ? 3 : 0);
    if (this.police) {
      const on = this.sirenOn && !this.dead;
      const ph = Math.floor(time * 6) % 2; const ph2 = Math.floor(time * 6 + 0.5) % 2;
      this.beaconAMat.emissiveIntensity = on ? (ph ? 6 : 0.3) : 0.1;
      this.beaconBMat.emissiveIntensity = on ? (ph2 ? 0.3 : 6) : 0.1;
    }
  }
  dispose() { this.root.removeFromParent(); this.paintMat.dispose(); this.headMat.dispose(); this.tailMat.dispose(); }
}

// OBB vs OBB between two vehicles; resolves overlap and exchanges impulse
export function collideVehicles(a, b) {
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const rr = Math.hypot(a.hx, a.hz) + Math.hypot(b.hx, b.hz);
  if (dx * dx + dz * dz > rr * rr) return false;
  const ax = [[Math.cos(a.heading), -Math.sin(a.heading)], [Math.sin(a.heading), Math.cos(a.heading)], [Math.cos(b.heading), -Math.sin(b.heading)], [Math.sin(b.heading), Math.cos(b.heading)]];
  let minO = Infinity, nx = 0, nz = 0;
  for (const [x, z] of ax) {
    const pa = a.hx * Math.abs(Math.cos(a.heading) * x - Math.sin(a.heading) * z) + a.hz * Math.abs(Math.sin(a.heading) * x + Math.cos(a.heading) * z);
    const pb = b.hx * Math.abs(Math.cos(b.heading) * x - Math.sin(b.heading) * z) + b.hz * Math.abs(Math.sin(b.heading) * x + Math.cos(b.heading) * z);
    const d = dx * x + dz * z; const o = pa + pb - Math.abs(d);
    if (o <= 0) return false;
    if (o < minO) { minO = o; const s = d < 0 ? -1 : 1; nx = x * s; nz = z * s; }
  }
  // n points from a to b
  const ma = a.sleeping ? a.mass * 1.5 : a.mass, mb = b.sleeping ? b.mass * 1.5 : b.mass; const tot = ma + mb;
  a.pos.x -= nx * minO * (mb / tot); a.pos.z -= nz * minO * (mb / tot);
  b.pos.x += nx * minO * (ma / tot); b.pos.z += nz * minO * (ma / tot);
  const rvx = b.vx - a.vx, rvz = b.vz - a.vz; const vn = rvx * nx + rvz * nz;
  if (vn < 0) {
    const e = 0.3; const j = -(1 + e) * vn / (1 / ma + 1 / mb);
    a.vx -= j * nx / ma; a.vz -= j * nz / ma; b.vx += j * nx / mb; b.vz += j * nz / mb;
    b.sleeping = false; a.sleeping = false;
    if (-vn > 2.5) { a.impact(-vn, 'car', b); b.impact(-vn, 'car', a); }
    // small spin
    a.angVel += (Math.random() - 0.5) * -vn * 0.02; b.angVel += (Math.random() - 0.5) * -vn * 0.02;
  }
  return true;
}
