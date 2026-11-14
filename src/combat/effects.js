// Pooled visual effects: muzzle flashes, tracers, impacts, smoke, fire, explosions, decals.
import * as THREE from 'three';
import { radialGlowTexture, smokeTexture } from '../world/textures.js';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.glowTex = radialGlowTexture('rgba(255,240,200,1)', 'rgba(255,160,60,0)');
    this.smokeTex = smokeTexture();
    this.sparkTex = radialGlowTexture('rgba(255,255,220,1)', 'rgba(255,200,80,0)');
    this.particles = [];
    this.pool = { add: [], norm: [] };
    for (let i = 0; i < 260; i++) this._mk('add');
    for (let i = 0; i < 180; i++) this._mk('norm');
    // tracers
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true); tg.rotateX(Math.PI / 2); tg.translate(0, 0, 0.5);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(tg, this.tracerMat.clone()); m.visible = false; m.frustumCulled = false; scene.add(m); this.tracers.push({ m, t: 0 }); }
    // flash light (single, reused)
    this.flashLight = new THREE.PointLight(0xffc070, 0, 12, 2); scene.add(this.flashLight); this.flashT = 0;
    this.boomLight = new THREE.PointLight(0xff8030, 0, 40, 2); scene.add(this.boomLight); this.boomT = 0;
    // bullet hole decals
    const dg = new THREE.CircleGeometry(0.06, 8);
    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x1a1816, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false });
    this.decals = []; this.decalI = 0;
    for (let i = 0; i < 80; i++) { const m = new THREE.Mesh(dg, this.decalMat); m.visible = false; scene.add(m); this.decals.push(m); }
    // skid marks
    const sg = new THREE.PlaneGeometry(0.22, 0.5); sg.rotateX(-Math.PI / 2);
    this.skidMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    this.skidMesh = new THREE.InstancedMesh(sg, this.skidMat, 600); this.skidMesh.count = 0; this.skidI = 0; this.skidMesh.frustumCulled = false; scene.add(this.skidMesh);
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(1, 1, 1);
  }
  _mk(kind) {
    const mat = new THREE.SpriteMaterial({ map: kind === 'add' ? this.glowTex : this.smokeTex, transparent: true, depthWrite: false, blending: kind === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: kind !== 'add' });
    const s = new THREE.Sprite(mat); s.visible = false; this.scene.add(s); this.pool[kind].push(s);
  }
  spawn(kind, pos, o) {
    const s = this.pool[kind].pop(); if (!s) return null;
    s.visible = true; s.position.copy(pos);
    const p = { s, kind, t: 0, life: o.life || 0.5, vel: o.vel ? o.vel.clone() : new THREE.Vector3(), size0: o.size || 0.5, size1: o.size1 ?? (o.size || 0.5), a0: o.alpha ?? 1, grav: o.grav || 0, drag: o.drag || 0, color: o.color };
    s.material.color.set(o.color || 0xffffff); s.material.map = o.map === 'spark' ? this.sparkTex : kind === 'add' ? this.glowTex : this.smokeTex;
    s.material.rotation = Math.random() * 6.28; s.scale.setScalar(p.size0); s.material.opacity = p.a0;
    this.particles.push(p); return p;
  }
  muzzle(pos, dir) {
    this.spawn('add', pos, { life: 0.06, size: 0.55, size1: 0.3, color: 0xffd28a });
    this.spawn('add', pos.clone().addScaledVector(dir, 0.15), { life: 0.05, size: 0.35, size1: 0.1, color: 0xffffff });
    this.spawn('norm', pos.clone().addScaledVector(dir, 0.2), { life: 0.6, size: 0.15, size1: 0.6, alpha: 0.25, vel: dir.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.4, 0)), color: 0xcfcfcf });
    this.flashLight.position.copy(pos); this.flashLight.intensity = 30; this.flashT = 0.05;
  }
  tracer(from, to) {
    const t = this.tracers.find((x) => !x.m.visible) || this.tracers[0];
    const len = from.distanceTo(to); if (len < 0.5) return;
    t.m.position.copy(from); t.m.lookAt(to); t.m.scale.set(1, 1, len); t.m.visible = true; t.t = 0; t.m.material.opacity = 0.85;
  }
  impact(pos, normal, kind = 'wall') {
    const n = normal || new THREE.Vector3(0, 1, 0);
    if (kind === 'flesh') {
      // stylised hit pop (no gore): white flash + small dust ring
      this.spawn('add', pos, { life: 0.12, size: 0.45, size1: 0.1, color: 0xfff0d0 });
      for (let i = 0; i < 4; i++) this.spawn('norm', pos, { life: 0.35, size: 0.12, size1: 0.35, alpha: 0.35, vel: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2), color: 0xd8d2c8 });
      return;
    }
    const sparks = kind === 'metal' ? 7 : 3;
    for (let i = 0; i < sparks; i++) {
      const v = n.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4));
      this.spawn('add', pos, { life: 0.25 + Math.random() * 0.2, size: 0.08, size1: 0.02, vel: v, grav: 12, color: 0xffc070, map: 'spark' });
    }
    this.spawn('norm', pos.clone().addScaledVector(n, 0.05), { life: 0.7, size: 0.2, size1: 0.9, alpha: 0.45, vel: n.clone().multiplyScalar(0.8), color: kind === 'ground' ? 0xa89a86 : 0xbdb8b0 });
    if (kind !== 'metal' && kind !== 'ground') this.decal(pos, n);
  }
  decal(pos, n) {
    const m = this.decals[this.decalI++ % this.decals.length];
    m.position.copy(pos).addScaledVector(n, 0.01); m.lookAt(pos.clone().add(n)); m.visible = true;
  }
  explosion(pos) {
    for (let i = 0; i < 18; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 8 + 2, (Math.random() - 0.5) * 10);
      this.spawn('add', pos.clone().add(new THREE.Vector3(0, 1, 0)), { life: 0.6 + Math.random() * 0.5, size: 2.5, size1: 4.5, vel: v.multiplyScalar(0.6), drag: 2, color: i % 3 ? 0xff8a30 : 0xffd060 });
    }
    for (let i = 0; i < 16; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5 + 2, (Math.random() - 0.5) * 6);
      this.spawn('norm', pos.clone().add(new THREE.Vector3(0, 1.5, 0)), { life: 2.5 + Math.random() * 1.5, size: 2, size1: 7, alpha: 0.55, vel: v, drag: 1, color: 0x3a3632 });
    }
    for (let i = 0; i < 24; i++) this.spawn('add', pos.clone().add(new THREE.Vector3(0, 1, 0)), { life: 0.8 + Math.random() * 0.6, size: 0.12, size1: 0.04, vel: new THREE.Vector3((Math.random() - 0.5) * 18, Math.random() * 14, (Math.random() - 0.5) * 18), grav: 14, color: 0xffb050, map: 'spark' });
    this.boomLight.position.copy(pos).add(new THREE.Vector3(0, 2, 0)); this.boomLight.intensity = 800; this.boomT = 0.6;
  }
  smoke(pos, dark = 0.4, size = 1) {
    const c = new THREE.Color().setScalar(0.85 - dark * 0.7);
    this.spawn('norm', pos, { life: 1.6, size: 0.6 * size, size1: 2.4 * size, alpha: 0.4, vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.6, (Math.random() - 0.5) * 0.6), color: c.getHex(), drag: 0.5 });
  }
  fire(pos) {
    this.spawn('add', pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), { life: 0.45, size: 0.9, size1: 0.3, vel: new THREE.Vector3(0, 2.4, 0), color: Math.random() < 0.5 ? 0xff7a20 : 0xffb040 });
  }
  tireSmoke(pos) { this.spawn('norm', pos, { life: 1.2, size: 0.5, size1: 2.2, alpha: 0.28, vel: new THREE.Vector3((Math.random() - 0.5), 0.8, (Math.random() - 0.5)), color: 0xe8e8e8, drag: 1.2 }); }
  skid(x, y, z, heading) {
    this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this._m4.compose(new THREE.Vector3(x, y + 0.02, z), this._q, this._s);
    this.skidMesh.setMatrixAt(this.skidI % 600, this._m4); this.skidI++;
    this.skidMesh.count = Math.min(600, this.skidI); this.skidMesh.instanceMatrix.needsUpdate = true;
  }
  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.t += dt; const k = p.t / p.life;
      if (k >= 1) { p.s.visible = false; this.pool[p.kind].push(p.s); this.particles.splice(i, 1); continue; }
      p.vel.y -= p.grav * dt; if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.setScalar(p.size0 + (p.size1 - p.size0) * k);
      p.s.material.opacity = p.a0 * (1 - k) * (p.kind === 'norm' ? Math.min(1, k * 6) : 1);
    }
    for (const t of this.tracers) if (t.m.visible) { t.t += dt; t.m.material.opacity = 0.85 * (1 - t.t / 0.07); if (t.t > 0.07) t.m.visible = false; }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flashLight.intensity = 0; }
    if (this.boomT > 0) { this.boomT -= dt; this.boomLight.intensity = Math.max(0, this.boomT / 0.6) * 800; }
  }
}
