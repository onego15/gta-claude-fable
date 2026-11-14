import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, angleDiff } from './utils.js';

export class CameraRig {
  constructor(camera, statics) {
    this.cam = camera; this.statics = statics;
    this.yaw = Math.PI; this.pitch = 0.18; this.dist = 4.4; this.curDist = 4.4;
    this.mode = 'foot'; this.aimBlend = 0; this.fov = 62;
    this.pivot = new THREE.Vector3(); this.trauma = 0; this.t = 0;
    this.lastLookInput = -10; this.vehYaw = 0; this.vehDist = 8;
    this.recoil = 0; this.shoulder = 1;
    this.tmp = new THREE.Vector3(); this.cinematic = null;
  }
  look(dx, dy, sens = 1) {
    this.yaw -= dx * 0.0022 * sens; this.pitch += dy * 0.0022 * sens;
    this.pitch = clamp(this.pitch, -0.95, 1.2);
    if (Math.abs(dx) + Math.abs(dy) > 0.5) this.lastLookInput = this.t;
  }
  shake(a) { this.trauma = Math.min(1, this.trauma + a); }
  forwardFlat(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  update(dt, target) {
    this.t += dt;
    const c = this.cam;
    if (this.cinematic) { this.cinematic(dt, c); this.applyShake(dt); return; }
    let desiredPos, lookAt, fov;
    if (target.vehicle) {
      const v = target.vehicle; const spd = v.speed;
      const velYaw = spd > 3 ? Math.atan2(-v.vx, -v.vz) : Math.atan2(-Math.sin(v.heading), -Math.cos(v.heading));
      // camera yaw is the direction camera looks toward; behind car = car heading
      const behindYaw = Math.atan2(-Math.sin(v.heading), -Math.cos(v.heading)) + Math.PI; // equals heading + PI?
      if (this.t - this.lastLookInput > 1.2) {
        const desired = v.forwardSpeed < -2 ? v.heading : (spd > 4 ? Math.atan2(v.vx, v.vz) : v.heading);
        // camera yaw convention: forward = (-sin yaw, -cos yaw)  => yaw = desiredHeading + PI
        this.yaw = dampAngle(this.yaw, desired + Math.PI, spd > 2 ? 3.2 : 1.2, dt);
        this.pitch = damp(this.pitch, 0.22, 2, dt);
      }
      void velYaw; void behindYaw;
      const d = 7.2 + clamp(spd * 0.06, 0, 3) + (v.tpl.height > 1.6 ? 1 : 0);
      this.vehDist = damp(this.vehDist, d, 3, dt);
      this.pivot.set(v.pos.x, v.pos.y + 1.6, v.pos.z);
      const fwd = this.forwardFlat(this.tmp);
      const cp = Math.cos(this.pitch);
      desiredPos = new THREE.Vector3(this.pivot.x - fwd.x * this.vehDist * cp, this.pivot.y + Math.sin(this.pitch) * this.vehDist + 0.6, this.pivot.z - fwd.z * this.vehDist * cp);
      lookAt = this.pivot.clone().add(new THREE.Vector3(0, 0.3, 0));
      fov = 64 + clamp(spd * 0.32, 0, 16);
    } else {
      const aim = target.aiming ? 1 : 0;
      this.aimBlend = damp(this.aimBlend, aim, 12, dt);
      const p = target.position;
      const sprint = target.sprinting ? 1 : 0;
      this.pivot.set(p.x, p.y + lerp(1.55, 1.58, this.aimBlend), p.z);
      const dist = lerp(4.3 + sprint * 0.5, 1.75, this.aimBlend);
      const side = lerp(0.42, 0.62, this.aimBlend) * this.shoulder;
      const fwd = this.forwardFlat(this.tmp).clone();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x); // camera right
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const pv = this.pivot.clone().addScaledVector(right, side);
      desiredPos = pv.clone().add(new THREE.Vector3(-fwd.x * dist * cp, sp * dist, -fwd.z * dist * cp));
      lookAt = pv.clone().add(new THREE.Vector3(fwd.x * 10 * cp, -sp * 10, fwd.z * 10 * cp));
      fov = lerp(62 + sprint * 6, 50, this.aimBlend);
    }
    // collision: pull camera toward pivot when blocked
    const dir = desiredPos.clone().sub(this.pivot); const len = dir.length(); dir.normalize();
    const hit = this.statics.raycast(this.pivot.x, this.pivot.y, this.pivot.z, dir.x, dir.y, dir.z, len + 0.3);
    let d = len; if (hit < len + 0.3) d = Math.max(0.6, hit - 0.35);
    this.curDist = d < this.curDist ? d : damp(this.curDist, d, 4, dt);
    const pos = this.pivot.clone().addScaledVector(dir, Math.min(this.curDist, len));
    if (pos.y < 0.35) pos.y = 0.35;
    c.position.copy(pos);
    c.lookAt(lookAt);
    // recoil kick (visual pitch)
    if (this.recoil > 0) { c.rotateX(this.recoil * 0.5); this.recoil = damp(this.recoil, 0, 14, dt); }
    this.fov = damp(this.fov, fov, 6, dt);
    if (Math.abs(c.fov - this.fov) > 0.01) { c.fov = this.fov; c.updateProjectionMatrix(); }
    this.applyShake(dt);
  }
  applyShake(dt) {
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma; const t = this.t * 40;
      this.cam.rotateX(Math.sin(t * 1.1) * 0.02 * s); this.cam.rotateY(Math.sin(t * 0.9 + 2) * 0.02 * s); this.cam.rotateZ(Math.sin(t * 1.3 + 4) * 0.03 * s);
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }
  }
  // world-space aim ray from screen center
  aimRay(origin, dir) { this.cam.getWorldPosition(origin); this.cam.getWorldDirection(dir); }
}
