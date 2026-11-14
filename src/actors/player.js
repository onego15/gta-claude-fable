import * as THREE from 'three';
import { Actor } from './actor.js';
import { clamp, damp, angleDiff } from '../core/utils.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

export class Player extends Actor {
  constructor(game, hum) {
    super(game, hum, { team: 'player', hp: 100 });
    this.money = 250; this.aiming = false; this.sprinting = false; this.stamina = 1;
    this.enterState = null; // {vehicle, t, from}
    this.aimPoint = new THREE.Vector3(); this.spreadBloom = 0;
    this.footT = 0; this.radius = 0.34;
  }
  update(dt) {
    const g = this.game, inp = g.input, rig = g.rig;
    this.tickWeapon(dt);
    if (!this.alive || g.state !== 'play') { this.vel.set(0, 0, 0); this.aiming = false; this.hum.aimWeight = damp(this.hum.aimWeight, 0, 10, dt); this.hum.setLocomotion(0, dt); return; }
    // vehicle enter animation
    if (this.enterState) return this.updateEnter(dt);
    if (this.inVehicle) return this.updateDriving(dt);

    // weapon switching
    if (inp.hit('Digit1')) this.equip(this.weapons.pistol ? 'pistol' : this.weaponKey);
    if (inp.hit('Digit2') && this.weapons.smg) this.equip('smg');
    if (inp.hit('Digit3')) this.equip(null);
    if (inp.mouse.wheel) { const keys = [null, ...Object.keys(this.weapons)]; const i = keys.indexOf(this.weaponKey); this.equip(keys[(i + (inp.mouse.wheel > 0 ? 1 : keys.length - 1)) % keys.length]); }
    if (inp.hit('KeyR')) { if (this.startReload()) g.audio.play('reload'); }

    // movement relative to camera
    const mx = inp.axis('moveX'), my = inp.axis('moveY');
    const fwd = rig.forwardFlat(tmp); const right = tmp2.set(-fwd.z, 0, fwd.x);
    const dir = new THREE.Vector3().addScaledVector(fwd, my).addScaledVector(right, mx);
    const mag = Math.min(1, dir.length()); if (mag > 0) dir.normalize();
    this.aiming = (inp.aim || inp.fire) && !!this.weapon;
    this.sprinting = inp.down('ShiftLeft') && mag > 0.1 && !this.aiming && this.stamina > 0.05;
    const speed = this.aiming ? 2.3 : this.sprinting ? 6.6 : inp.down('AltLeft') || inp.down('KeyC') ? 1.5 : 4.0;
    this.stamina = clamp(this.stamina + (this.sprinting ? -0.08 : 0.15) * dt, 0, 1);
    const tvx = dir.x * speed * mag, tvz = dir.z * speed * mag;
    const accel = this.grounded ? 12 : 2;
    this.vel.x = damp(this.vel.x, tvx, accel, dt); this.vel.z = damp(this.vel.z, tvz, accel, dt);
    const sp = Math.hypot(this.vel.x, this.vel.z); this.moveSpeed = sp;
    // facing
    const camYawFacing = Math.atan2(fwd.x, fwd.z);
    if (this.aiming) this.faceTowards(camYawFacing, dt, 20);
    else if (sp > 0.3) this.faceTowards(Math.atan2(this.vel.x, this.vel.z), dt, 10);
    // jump
    if ((inp.hit('Space') || inp.btn(0)) && this.grounded) { this.vy = 5.2; this.grounded = false; this.hum.play(sp > 3 ? 'RunningJump' : 'Jump', { timeScale: 1.3 }); g.audio.play('jump'); }
    this.hum.setLocomotion(sp, dt, this.sprinting);
    // aim
    this.updateAim(dt);
    // shooting
    const w = this.weapon;
    const wantFire = w && (w.def.auto ? inp.fire : (inp.mouse.leftPressed || inp.virtual.get('fire')));
    if (wantFire && this.reloadT <= 0) {
      if (w.mag <= 0) { if (!this.startReload()) { if (this.cooldown <= 0) { g.audio.play('dry'); this.cooldown = 0.25; } } else g.audio.play('reload'); }
      else if (this.cooldown <= 0) this.shoot();
    }
    if (w && w.mag === 0 && w.reserve > 0 && this.reloadT <= 0 && !inp.fire) { this.startReload(); g.audio.play('reload'); }
    this.spreadBloom = damp(this.spreadBloom, 0, 5, dt);
    // interact
    if (inp.hit('KeyF') || inp.btn(3)) this.tryEnterVehicle();
    // footsteps
    if (this.grounded && sp > 1) { this.footT += dt * sp * 0.62; if (this.footT > 1) { this.footT = 0; g.audio.footstep(this.pos, sp > 5); } }
    // health regen (up to half)
    if (g.time - this.lastDamageTime > 7 && this.hp < 50) this.hp = Math.min(50, this.hp + dt * 4);
  }
  updateAim(dt) {
    const g = this.game, rig = g.rig;
    // ray from camera center to find aim point
    const o = new THREE.Vector3(), d = new THREE.Vector3(); rig.aimRay(o, d);
    const hit = g.combat.traceAim(o, d, 150, this);
    this.aimPoint.copy(hit.point);
    this.aimHitActor = hit.actor;
    const target = this.aiming ? 1 : 0;
    this.hum.aimWeight = damp(this.hum.aimWeight, target, 14, dt);
    this.hum.aimTarget.copy(this.aimPoint);
    const chest = this.chestPos; const dx = this.aimPoint.x - chest.x, dz = this.aimPoint.z - chest.z, dy = this.aimPoint.y - chest.y;
    this.hum.aimPitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -1, 1);
  }
  shoot() {
    const g = this.game, w = this.weapon; const def = w.def;
    w.mag--; this.cooldown = def.rate;
    if (!this.aiming) { this.hum.aimWeight = Math.max(this.hum.aimWeight, 0.8); this.heading = Math.atan2(g.rig.forwardFlat(tmp).x, tmp.z); }
    const muzzle = this.muzzleWorld();
    const spread = (this.aiming ? def.spread : def.hipSpread) + this.spreadBloom + this.moveSpeed * 0.004;
    const aim = this.aimPoint.clone().sub(muzzle).normalize();
    aim.x += (Math.random() - 0.5) * spread * 2; aim.y += (Math.random() - 0.5) * spread * 2; aim.z += (Math.random() - 0.5) * spread * 2; aim.normalize();
    g.combat.fire(this, muzzle, aim, def);
    this.spreadBloom = Math.min(0.06, this.spreadBloom + def.recoil * 0.6);
    g.rig.recoil += def.kick * 0.25; g.rig.pitch = clamp(g.rig.pitch - def.recoil * 0.35, -0.95, 1.2); g.rig.yaw += (Math.random() - 0.5) * def.recoil * 0.3;
    g.rig.shake(def.auto ? 0.06 : 0.12);
  }
  nearestVehicle(maxD = 3.6) {
    let best = null, bd = maxD;
    for (const v of this.game.vehicles) {
      if (v.dead) continue;
      const door = v.driverDoor(); const d = Math.min(Math.hypot(door.x - this.pos.x, door.z - this.pos.z), Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z) - 1);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }
  tryEnterVehicle() {
    const v = this.nearestVehicle(); if (!v) return;
    if (v.locked) { this.game.hud.toast('この車はロックされている'); return; }
    if (v.speed > 6) return; // too fast to grab the door
    const from = this.pos.clone();
    this.enterState = { vehicle: v, t: 0, from, jack: !!v.driver && v.driver !== this };
    this.aiming = false; this.hum.aimWeight = 0;
    if (this.enterState.jack) this.game.onCarjack(v, this);
    this.game.audio.play('door');
  }
  updateEnter(dt) {
    const es = this.enterState; const v = es.vehicle; es.t += dt;
    const door = v.driverDoor();
    const T1 = 0.45, T2 = 0.75;
    if (es.t < T1) {
      const k = es.t / T1; this.pos.x = es.from.x + (door.x - es.from.x) * k; this.pos.z = es.from.z + (door.z - es.from.z) * k;
      this.heading = Math.atan2(v.pos.x - this.pos.x, v.pos.z - this.pos.z) * 0.5 + this.heading * 0.5; this.hum.root.rotation.y = this.heading; this.hum.setLocomotion(3, dt);
    } else if (es.t < T2) {
      const k = (es.t - T1) / (T2 - T1); const seat = v.pos.clone().addScaledVector(v.rightVec(), -0.35);
      this.pos.lerpVectors(door, seat, k); this.pos.y = v.pos.y + 0.2 * k; this.hum.setLocomotion(1, dt);
      this.heading = v.heading; this.hum.root.rotation.y = this.heading;
    } else {
      this.enterState = null; this.inVehicle = v; v.driver = this; v.sleeping = false; this.hum.root.visible = false;
      if (this.hum.weapon) this.hum.weapon.mesh.visible = false;
      this.game.onPlayerEnteredVehicle(v);
    }
  }
  updateDriving(dt) {
    const g = this.game, inp = g.input, v = this.inVehicle;
    let thr = 0, brk = 0, steer = 0;
    thr = Math.max(0, inp.axis('moveY')); brk = Math.max(0, -inp.axis('moveY'));
    const p = inp.pad(); if (p) { thr = Math.max(thr, p.buttons[7]?.value || 0); brk = Math.max(brk, p.buttons[6]?.value || 0); }
    steer = -inp.axis('moveX');
    v.throttle = thr; v.brake = brk; v.steer = damp(v.steer, steer, 8, dt); v.handbrake = inp.down('Space') || inp.btn(0) ? 1 : 0;
    if (inp.hit('KeyH') || inp.btn(10)) g.audio.horn(v);
    if (inp.hit('KeyR')) g.radio.toggle();
    this.pos.copy(v.pos); this.heading = v.heading;
    if (inp.hit('KeyF') || inp.btn(3)) this.exitVehicle();
    this.hum.aimWeight = 0;
  }
  exitVehicle(force = false) {
    const v = this.inVehicle; if (!v) return;
    const sp = v.speed;
    // pick a free side
    const st = this.game.statics; let door = v.driverDoor();
    let ok = !st.resolveCircle(door.x, door.z, 0.4, 0.3, 1.6).hit;
    if (!ok) { door = v.passengerDoor(); }
    v.driver = null; v.throttle = 0; v.brake = sp > 2 && !force ? 0 : 0.3; v.handbrake = 0; v.steer = 0;
    this.inVehicle = null; this.hum.root.visible = true; if (this.hum.weapon) this.hum.weapon.mesh.visible = true;
    this.pos.set(door.x, v.pos.y + 0.1, door.z); this.heading = v.heading; this.vel.set(0, 0, 0);
    this.grounded = true;
    if (sp > 7) { this.vel.set(v.vx * 0.4, 0, v.vz * 0.4); this.takeDamage(Math.min(30, sp * 1.2), null, 0, 0, 'fall'); this.hum.play('Jump'); }
    this.game.onPlayerExitedVehicle(v);
    this.game.audio.play('door');
  }
}
