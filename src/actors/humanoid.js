// Skinned human characters (Quaternius CC0 models) with layered procedural aiming.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { clamp, damp, lerp } from '../core/utils.js';

const SKIN = ['#f1c7a5', '#e0ac85', '#c68d63', '#a86f48', '#8a5636', '#5f3a24', '#f5d3b8', '#d49a72'];
const HAIR = ['#1b1410', '#2d1d12', '#4a2e1a', '#6b4423', '#a0703a', '#d6b26e', '#1a1a1a', '#8a8a8a', '#5b2316'];
const TOPS = ['#e4572e', '#29335c', '#f3a712', '#669bbc', '#ffffff', '#2b2d42', '#8d99ae', '#ef476f', '#06d6a0', '#118ab2', '#073b4c', '#9c6644', '#c9ada7', '#f4f1de', '#3d405b', '#81b29a', '#e07a5f', '#b5179e', '#7209b7', '#264653', '#e9c46a'];
const BOTTOMS = ['#2b3a55', '#1d1d1f', '#3e4c59', '#c2b280', '#5a4632', '#6b705c', '#24344d', '#4a4e69', '#2f3e46'];
const SHOES = ['#111111', '#f2f2f2', '#5c3d2e', '#2d2d2d', '#8b1e1e', '#1f3b73'];

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

const _rq = new THREE.Quaternion(), _rq2 = new THREE.Quaternion();
function rotateBoneWorld(bone, qDelta) {
  bone.parent.getWorldQuaternion(_rq2);
  bone.getWorldQuaternion(_rq);
  _rq.premultiply(qDelta);
  bone.quaternion.copy(_rq2.invert().multiply(_rq));
  bone.updateMatrixWorld(true);
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();
function pointBone(bone, child, target, weight = 1) {
  bone.getWorldPosition(_a); child.getWorldPosition(_b);
  _b.sub(_a).normalize(); _c.copy(target).sub(_a).normalize();
  _q.setFromUnitVectors(_b, _c);
  if (weight < 1) _q.slerp(tmpQ.identity(), 1 - weight);
  rotateBoneWorld(bone, _q);
}
// two bone IK: upper->lower->end towards target with pole hint
const _s = new THREE.Vector3(), _t = new THREE.Vector3(), _e = new THREE.Vector3(), _n = new THREE.Vector3(), _d = new THREE.Vector3();
function twoBoneIK(upper, lower, end, target, pole, weight = 1) {
  upper.getWorldPosition(_s); lower.getWorldPosition(_e); end.getWorldPosition(_t);
  const a = _s.distanceTo(_e), b = _e.distanceTo(_t);
  _d.copy(target).sub(_s); let dist = _d.length(); _d.normalize();
  dist = clamp(dist, Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const cosA = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1); const alpha = Math.acos(cosA);
  _n.copy(_d).cross(pole).normalize(); if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0);
  // rotate _d around _n by -alpha to bend the elbow toward pole
  const elbowDir = _d.clone().applyAxisAngle(_n, alpha);
  const elbow = _s.clone().addScaledVector(elbowDir, a);
  const tgt = _s.clone().addScaledVector(_d, dist);
  pointBone(upper, lower, elbow, weight);
  pointBone(lower, end, tgt, weight);
}

export class CharacterFactory {
  constructor(assets) {
    this.assets = assets;
    this.clips = {};
    for (const g of ['male', 'female']) {
      const m = {};
      for (const c of assets.anims[g].animations) m[c.name] = c;
      this.clips[g] = m;
    }
  }
  create(model, opts = {}) { return new Humanoid(this, model, opts); }
}

export class Humanoid {
  constructor(factory, model, opts) {
    const gltf = factory.assets.chars[model];
    this.gender = model.startsWith('Female') ? 'female' : 'male';
    this.model = SkeletonUtils.clone(gltf.scene);
    this.root = new THREE.Group(); this.root.add(this.model);
    this.root.name = 'char_' + model;
    this.mats = {};
    this.meshes = [];
    const r = opts.rng || Math.random;
    const pick = (a) => a[Math.floor(r() * a.length)];
    const colors = Object.assign({ skin: pick(SKIN), hair: pick(HAIR), top: pick(TOPS), bottom: pick(BOTTOMS), shoes: pick(SHOES) }, opts.colors || {});
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
        const arr = Array.isArray(o.material) ? o.material : [o.material];
        const nm = arr.map((m) => {
          const c = m.clone(); c.roughness = 0.75; c.metalness = 0;
          const n = m.name.toLowerCase();
          if (n.includes('skin')) c.color.set(colors.skin);
          else if (n.includes('hairbase') || n.includes('hair') || n.includes('eyebrow') || n.includes('beard')) c.color.set(colors.hair);
          else if (n.includes('eye')) c.color.set('#141414');
          else if (n.includes('shoe')) c.color.set(colors.shoes);
          else if (n.includes('sock')) c.color.set(colors.socks || '#e8e8e8');
          else if (n.includes('pant') || n.includes('skirt') || n.includes('trouser') || n.includes('legs')) c.color.set(colors.bottom);
          else if (n.includes('tie')) c.color.set(colors.tie || colors.accent || '#7a1f2b');
          else if (n.includes('shirt') || n.includes('top') || n.includes('dress') || n.includes('suit') || n.includes('jacket') || n.includes('tank') || n.includes('cloth')) c.color.set(colors.top);
          if (n.includes('suit') && colors.suit) c.color.set(colors.suit);
          c.emissive = new THREE.Color(0, 0, 0);
          this.mats[m.name] = c;
          return c;
        });
        o.material = Array.isArray(o.material) ? nm : nm[0];
        this.meshes.push(o);
      }
    });
    this.bones = {};
    this.model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    // bind-pose rotations of every bone the procedural layer touches; restored each frame so overrides never accumulate
    this.restQ = [];
    for (const n of ['Torso', 'Chest', 'Head', 'Neck', 'UpperArmR', 'LowerArmR', 'PalmR', 'UpperArmL', 'LowerArmL', 'PalmL']) if (this.bones[n]) this.restQ.push([this.bones[n], this.bones[n].quaternion.clone()]);
    // animation
    this.mixer = new THREE.AnimationMixer(this.model);
    const clips = factory.clips[this.gender];
    this.actions = {};
    for (const [k, c] of Object.entries(clips)) this.actions[k] = this.mixer.clipAction(c);
    for (const k of ['Idle', 'Walk', 'Run']) { const a = this.actions[k]; a.play(); a.setEffectiveWeight(k === 'Idle' ? 1 : 0); }
    this.actions.Walk.time = Math.random(); this.actions.Run.time = Math.random();
    this.oneShot = null; this.dead = false;
    this.speed = 0; this.loco = { idle: 1, walk: 0, run: 0 };
    this.aimWeight = 0; this.aimTarget = new THREE.Vector3(); this.aimPitch = 0;
    this.hitFlash = 0; this.flinch = 0; this.flinchDir = 1;
    this.weapon = null; this.handsUp = 0;
    this.walkRate = opts.walkRate || 1.35; this.runRate = opts.runRate || 3.4;
    if (opts.scale) this.model.scale.setScalar(opts.scale);
    this.height = this.gender === 'female' ? 1.7 : 1.78;
  }
  get position() { return this.root.position; }

  setLocomotion(speed, dt, running = false) {
    this.speed = speed;
    let wi = 1, ww = 0, wr = 0;
    if (speed > 0.15) {
      if (speed < 2.2 && !running) { ww = 1; wi = 0; }
      else { const t = clamp((speed - 2.0) / 1.2, 0, 1); ww = 1 - t; wr = t; wi = 0; }
    }
    const k = 10;
    this.loco.idle = damp(this.loco.idle, wi, k, dt); this.loco.walk = damp(this.loco.walk, ww, k, dt); this.loco.run = damp(this.loco.run, wr, k, dt);
    const shot = this.oneShot ? this.oneShotWeight : 0;
    const base = 1 - shot;
    this.actions.Idle.setEffectiveWeight(this.loco.idle * base);
    this.actions.Walk.setEffectiveWeight(this.loco.walk * base);
    this.actions.Run.setEffectiveWeight(this.loco.run * base);
    this.actions.Walk.timeScale = clamp(speed / this.walkRate, 0.6, 1.8);
    this.actions.Run.timeScale = clamp(speed / this.runRate, 0.8, 1.9);
  }
  play(name, { loop = false, fade = 0.15, timeScale = 1, hold = false } = {}) {
    const a = this.actions[name]; if (!a) return;
    if (this.oneShot && this.oneShot !== a) this.oneShot.fadeOut(fade);
    a.reset(); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = hold || !loop;
    a.timeScale = timeScale; a.setEffectiveWeight(1); a.fadeIn(fade); a.play();
    this.oneShot = a; this.oneShotWeight = 1; this.oneShotHold = hold; this.oneShotLoop = loop;
  }
  stopOneShot(fade = 0.2) { if (this.oneShot) { this.oneShot.fadeOut(fade); this.oneShot = null; } }
  die(dir) {
    if (this.dead) return; this.dead = true; this.aimWeight = 0;
    this.play('Death', { hold: true, fade: 0.1, timeScale: 1.25 });
  }
  revive() { this.dead = false; this.stopOneShot(0.01); this.mixer.stopAllAction(); for (const k of ['Idle', 'Walk', 'Run']) this.actions[k].play(); }

  update(dt) {
    if (this.oneShot && !this.oneShotLoop && !this.oneShotHold) {
      const a = this.oneShot; if (a.time >= a.getClip().duration - 0.05) { a.fadeOut(0.2); this.oneShot = null; }
    }
    for (const [b, q] of this.restQ) b.quaternion.copy(q);
    this.mixer.update(dt);
    this.model.updateMatrixWorld(true);
    this.applyOverrides(dt);
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
      for (const m of Object.values(this.mats)) m.emissive.setRGB(this.hitFlash * 0.9, this.hitFlash * 0.85, this.hitFlash * 0.8);
    }
  }

  applyOverrides(dt) {
    const B = this.bones;
    // flinch from hits
    if (this.flinch > 0.001 && B.Torso) {
      this.flinch = damp(this.flinch, 0, 8, dt);
      tmpV.set(1, 0, 0).applyQuaternion(this.root.quaternion);
      rotateBoneWorld(B.Torso, tmpQ.setFromAxisAngle(tmpV, -this.flinch * 0.6 * this.flinchDir));
    }
    if (this.handsUp > 0.01 && !this.dead && B.UpperArmR) {
      const w = this.handsUp; const p = this.root.position;
      const fwd = tmpV2.set(0, 0, 1).applyQuaternion(this.root.quaternion);
      const side = new THREE.Vector3().crossVectors(UP, fwd);
      const head = new THREE.Vector3(); B.Head.getWorldPosition(head);
      twoBoneIK(B.UpperArmR, B.LowerArmR, B.PalmR, head.clone().addScaledVector(side, -0.3).add(new THREE.Vector3(0, 0.38, 0)).addScaledVector(fwd, 0.05), new THREE.Vector3(0, -1, 0).addScaledVector(side, -1), w);
      twoBoneIK(B.UpperArmL, B.LowerArmL, B.PalmL, head.clone().addScaledVector(side, 0.3).add(new THREE.Vector3(0, 0.38, 0)).addScaledVector(fwd, 0.05), new THREE.Vector3(0, -1, 0).addScaledVector(side, 1), w);
    }
    if (this.aimWeight > 0.01 && !this.dead && B.UpperArmR) {
      const w = this.aimWeight;
      // torso pitch toward target
      const fwd = tmpV2.set(0, 0, 1).applyQuaternion(this.root.quaternion);
      const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
      if (B.Torso) {
        // square the shoulders to the aim direction (the base clips leave the torso twisted)
        const sR = new THREE.Vector3(), sL = new THREE.Vector3(); B.UpperArmR.getWorldPosition(sR); B.UpperArmL.getWorldPosition(sL);
        const ax = sR.x - sL.x, az = sR.z - sL.z; const tx = this.aimTarget.x - this.root.position.x, tz = this.aimTarget.z - this.root.position.z;
        // desired shoulder line: perpendicular to the flat aim direction (right-hand side), slight bladed stance
        const aimYaw = Math.hypot(tx, tz) > 0.5 ? Math.atan2(tx, tz) : Math.atan2(fwd.x, fwd.z);
        const dx = -Math.cos(aimYaw), dz = Math.sin(aimYaw);
        let yawFix = Math.atan2(ax * dz - az * dx, ax * dx + az * dz) + 0.18;
        yawFix = Math.max(-1.6, Math.min(1.6, yawFix));
        rotateBoneWorld(B.Torso, tmpQ.setFromAxisAngle(UP, -yawFix * w));
        rotateBoneWorld(B.Torso, tmpQ.setFromAxisAngle(right, this.aimPitch * 0.55 * w));
      }
      // right arm straight to target
      const sh = new THREE.Vector3(); B.UpperArmR.getWorldPosition(sh);
      const dir = this.aimTarget.clone().sub(sh).normalize();
      const reach = 0.56;
      const handTarget = sh.clone().addScaledVector(dir, reach);
      twoBoneIK(B.UpperArmR, B.LowerArmR, B.PalmR, handTarget, new THREE.Vector3(0, -1, 0).addScaledVector(right, 0.6), w);
      // left hand supports the grip
      const palm = new THREE.Vector3(); B.PalmR.getWorldPosition(palm);
      const leftTarget = palm.clone().addScaledVector(right, -0.06).addScaledVector(dir, -0.02).add(new THREE.Vector3(0, -0.03, 0));
      if (this.weapon && this.weapon.twoHanded) leftTarget.addScaledVector(dir, 0.18);
      twoBoneIK(B.UpperArmL, B.LowerArmL, B.PalmL, leftTarget, new THREE.Vector3(0, -1, 0).addScaledVector(right, -0.8), w * (this.weapon ? 1 : 0));
      if (B.Head) rotateBoneWorld(B.Head, tmpQ.setFromAxisAngle(right, this.aimPitch * 0.3 * w));
    }
    // weapon follows the right palm
    if (this.weapon) {
      const wpn = this.weapon.mesh; const B2 = this.bones;
      const palm = new THREE.Vector3(); B2.PalmR.getWorldPosition(palm);
      const fingers = new THREE.Vector3(); (B2.FingersR || B2.MiddleHandR).getWorldPosition(fingers);
      wpn.position.copy(palm).lerp(fingers, 0.4);
      if (this.aimWeight > 0.5) {
        const look = this.aimTarget.clone();
        wpn.lookAt(look);
      } else {
        // hang along the forearm, barrel forward-down
        const elbow = new THREE.Vector3(); B2.LowerArmR.getWorldPosition(elbow);
        const fdir = palm.clone().sub(elbow).normalize();
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
        const d = fwd.multiplyScalar(0.7).add(fdir).normalize();
        wpn.lookAt(wpn.position.clone().add(d));
      }
      wpn.visible = this.root.visible && this.weaponVisible !== false;
    }
  }
  flash() { this.hitFlash = 1; }
  hitReact(fromDir) { this.flinch = 0.6; this.flinchDir = fromDir || 1; this.flash(); }
  setShadow(on) { for (const m of this.meshes) m.castShadow = on; }
  dispose() { this.mixer.stopAllAction(); this.root.removeFromParent(); if (this.weapon) this.weapon.mesh.removeFromParent(); }
}

// --- Weapon meshes (procedural, stylised) -----------------------------------
const gunMats = {
  dark: new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.35, metalness: 0.8 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.8 }),
  accent: new THREE.MeshStandardMaterial({ color: 0x6b7378, roughness: 0.3, metalness: 0.9 }),
};
export function makeGunMesh(type) {
  const g = new THREE.Group();
  const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; g.add(b); return b; };
  if (type === 'pistol') {
    box(0.034, 0.04, 0.2, 0, 0.03, 0.07, gunMats.dark);       // slide (barrel along +z)
    box(0.03, 0.03, 0.17, 0, 0.0, 0.06, gunMats.accent);       // frame
    const grip = box(0.03, 0.11, 0.045, 0, -0.05, -0.0, gunMats.grip); grip.rotation.x = -0.25;
    box(0.008, 0.012, 0.012, 0, 0.056, 0.16, gunMats.accent);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, 0.18);
  } else {
    box(0.045, 0.06, 0.32, 0, 0.03, 0.1, gunMats.dark);
    box(0.02, 0.02, 0.12, 0, 0.035, 0.31, gunMats.accent);
    const grip = box(0.032, 0.1, 0.04, 0, -0.05, 0.0, gunMats.grip); grip.rotation.x = -0.25;
    box(0.03, 0.14, 0.035, 0, -0.07, 0.12, gunMats.dark);       // magazine
    box(0.03, 0.04, 0.16, 0, 0.02, -0.12, gunMats.accent);      // stock
    g.userData.muzzle = new THREE.Vector3(0, 0.035, 0.38);
  }
  return g;
}
