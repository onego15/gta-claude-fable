// Gameplay wrapper around a Humanoid: movement physics, health, weapons.
import * as THREE from 'three';
import { clamp, damp, dampAngle, angleDiff } from '../core/utils.js';
import { groundHeight } from '../world/layout.js';
import { makeGunMesh } from './humanoid.js';

export const WEAPONS = {
  pistol: { name: 'ピストル', label: 'P-9 HANDGUN', damage: 34, rate: 0.24, auto: false, mag: 12, reload: 1.35, spread: 0.010, hipSpread: 0.03, range: 140, recoil: 0.035, kick: 0.12, sound: 'pistol', twoHanded: false },
  smg: { name: 'サブマシンガン', label: 'VX-30 SMG', damage: 17, rate: 0.085, auto: true, mag: 30, reload: 1.8, spread: 0.022, hipSpread: 0.05, range: 110, recoil: 0.016, kick: 0.06, sound: 'smg', twoHanded: true },
};

let AID = 0;
export class Actor {
  constructor(game, hum, opts = {}) {
    this.id = ++AID; this.game = game; this.hum = hum; this.team = opts.team || 'civ';
    this.pos = hum.root.position; this.heading = opts.heading || 0;
    this.vel = new THREE.Vector3(); this.vy = 0; this.grounded = true;
    this.radius = 0.32; this.hp = this.maxHp = opts.hp || 100; this.armor = opts.armor || 0;
    this.alive = true; this.inVehicle = null; this.deadTime = 0;
    this.weapons = {}; this.weaponKey = null; this.cooldown = 0; this.reloadT = 0;
    this.lastDamageTime = -100; this.lastAttacker = null;
    this.moveSpeed = 0; this.hidden = false;
    if (opts.weapon) this.giveWeapon(opts.weapon, opts.ammo ?? 999);
  }
  get weapon() { return this.weaponKey ? this.weapons[this.weaponKey] : null; }
  giveWeapon(key, ammo) {
    const def = WEAPONS[key];
    if (!this.weapons[key]) this.weapons[key] = { key, def, mag: def.mag, reserve: 0 };
    this.weapons[key].reserve += ammo;
    if (!this.weaponKey) this.equip(key);
  }
  equip(key) {
    if (key && !this.weapons[key]) return;
    this.weaponKey = key; this.reloadT = 0;
    if (this.hum.weapon) { this.hum.weapon.mesh.removeFromParent(); this.hum.weapon = null; }
    if (key) {
      const mesh = makeGunMesh(key); this.game.scene.add(mesh);
      this.hum.weapon = { mesh, twoHanded: WEAPONS[key].twoHanded };
    }
  }
  muzzleWorld(out = new THREE.Vector3()) {
    if (this.hum.weapon) { const m = this.hum.weapon.mesh; m.updateMatrixWorld(); return out.copy(m.userData.muzzle).applyMatrix4(m.matrixWorld); }
    return out.copy(this.pos).add(new THREE.Vector3(0, 1.4, 0));
  }
  canFire() { const w = this.weapon; return w && this.cooldown <= 0 && this.reloadT <= 0 && w.mag > 0; }
  startReload() {
    const w = this.weapon; if (!w || this.reloadT > 0 || w.mag >= w.def.mag || w.reserve <= 0) return false;
    this.reloadT = w.def.reload; return true;
  }
  tickWeapon(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { const w = this.weapon; const need = w.def.mag - w.mag; const take = Math.min(need, w.reserve); w.mag += take; w.reserve -= take; }
    }
  }
  takeDamage(amount, from, dirX = 0, dirZ = 0, kind = 'bullet') {
    if (!this.alive) return;
    if (this.armor > 0 && kind !== 'fall') { const a = Math.min(this.armor, amount * 0.7); this.armor -= a; amount -= a; }
    this.hp -= amount; this.lastDamageTime = this.game.time; this.lastAttacker = from;
    // flinch direction relative to facing
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.hum.hitReact(fx * dirX + fz * dirZ > 0 ? -1 : 1);
    if (this.hp <= 0) this.die(from, dirX, dirZ, kind);
    else if (this.onHurt) this.onHurt(from, amount);
  }
  die(from, dirX, dirZ, kind) {
    this.alive = false; this.hp = 0; this.deadTime = this.game.time; this.vel.set(dirX * 2, 0, dirZ * 2);
    this.hum.die(); if (this.hum.weapon) this.hum.weaponVisible = false;
    this.game.onActorDeath(this, from, kind);
  }
  // physics step for on-foot movement; desired velocity is set by controller in this.vel
  physics(dt) {
    if (this.inVehicle) return;
    const st = this.game.statics;
    if (!this.alive) { this.vel.multiplyScalar(Math.exp(-4 * dt)); }
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    const res = st.resolveCircle(this.pos.x, this.pos.z, this.radius, this.pos.y + 0.3, this.pos.y + 1.7);
    this.pos.x = res.x; this.pos.z = res.z; this.blocked = res.hit;
    // vehicles
    for (const v of this.game.vehicles) {
      if (this.enterState && this.enterState.vehicle === v) continue;
      const dx = this.pos.x - v.pos.x, dz = this.pos.z - v.pos.z;
      if (dx * dx + dz * dz > 16) continue;
      const c = Math.cos(v.heading), s = Math.sin(v.heading);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const qx = clamp(lx, -v.hx, v.hx), qz = clamp(lz, -v.hz, v.hz);
      let ex = lx - qx, ez = lz - qz; let d = Math.hypot(ex, ez);
      const r = this.radius;
      if (d < r) {
        const vs = v.speed;
        const dl = Math.hypot(dx, dz) || 1; const closing = (v.vx * dx + v.vz * dz) / dl; // car velocity toward the actor
        if (vs > 4.5 && closing > 3 && this.alive && this !== this.game.player?.ignoreHit) { this.game.onVehicleHitActor(v, this, vs); }
        if (d < 1e-4) { // inside: push out the nearest side
          const px = v.hx - Math.abs(lx), pz = v.hz - Math.abs(lz);
          if (px < pz) { ex = Math.sign(lx) || 1; ez = 0; d = 0; const push = px + r; this.pos.x += (ex * c + 0 * s) * push; this.pos.z += (-ex * s) * push; }
          else { ex = 0; ez = Math.sign(lz) || 1; const push = pz + r; this.pos.x += ez * s * push; this.pos.z += ez * c * push; }
        } else {
          ex /= d; ez /= d; const push = r - d;
          this.pos.x += (ex * c + ez * s) * push; this.pos.z += (-ex * s + ez * c) * push;
        }
      }
    }
    // vertical
    const gh = groundHeight(this.pos.x, this.pos.z);
    if (!this.grounded || this.vy > 0) {
      this.vy -= 18 * dt; this.pos.y += this.vy * dt;
      if (this.pos.y <= gh) { this.pos.y = gh; this.vy = 0; this.grounded = true; if (this.onLand) this.onLand(); }
    } else {
      this.pos.y = damp(this.pos.y, gh, 25, dt);
    }
    this.hum.root.rotation.y = this.heading;
  }
  faceTowards(yaw, dt, rate = 12) { this.heading = dampAngle(this.heading, yaw, rate, dt); }
  distTo(o) { return Math.hypot(this.pos.x - o.x, this.pos.z - o.z); }
  get headPos() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.62, this.pos.z); }
  get chestPos() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.25, this.pos.z); }
  dispose() { this.hum.dispose(); }
}
