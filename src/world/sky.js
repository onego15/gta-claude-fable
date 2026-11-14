// Time of day: sky dome, sun/moon light, hemisphere fill, fog and environment reflections.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { clamp, lerp, smooth } from '../core/utils.js';

const DAY_LENGTH = 24 * 60; // real seconds for a full in-game day (1 game hour = 1 real minute)

export class TimeOfDay {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.hours = 18.0; this.speed = 24 / DAY_LENGTH; this.paused = false;
    this.sky = new Sky(); this.sky.scale.setScalar(4500); scene.add(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.86;
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const s = this.sun.shadow; s.mapSize.set(2048, 2048); s.bias = -0.0004; s.normalBias = 0.04;
    const c = s.camera; c.left = -70; c.right = 70; c.top = 70; c.bottom = -70; c.near = 1; c.far = 400;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd7ff, 0x3b3328, 0.9); scene.add(this.hemi);
    this.fog = new THREE.Fog(0xc9b8a8, 120, 620); scene.fog = this.fog;
    this.sunDir = new THREE.Vector3();
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene(); this.envSky = new Sky(); this.envSky.scale.setScalar(100); this.envScene.add(this.envSky);
    this.envTimer = 999; this.envRT = null;
    this.night = 0; // 0 day .. 1 night
    this.dusk = 0;
  }
  get timeString() { const h = Math.floor(this.hours) % 24, m = Math.floor((this.hours % 1) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
  setHours(h) { this.hours = ((h % 24) + 24) % 24; this.envTimer = 999; }

  update(dt, focus) {
    if (!this.paused) this.hours = (this.hours + dt * this.speed) % 24;
    const h = this.hours;
    // sun path: rises 6:00 (east, +x), sets 19:30 (west, -x), peaks south-ish
    const dayT = (h - 6) / 13.5; // 0..1 while sun above horizon
    const elev = Math.sin(clamp(dayT, -0.25, 1.25) * Math.PI) * 62 * Math.PI / 180;
    const azim = lerp(-Math.PI * 0.6, Math.PI * 0.6, clamp(dayT, -0.2, 1.2));
    this.sunDir.set(Math.sin(azim) * Math.cos(elev) * -1, Math.sin(elev), Math.cos(azim) * Math.cos(elev) * 0.6 + 0.35).normalize();
    const elevDeg = elev * 180 / Math.PI;
    const dayAmt = smooth(clamp((elevDeg + 4) / 16, 0, 1));      // 0 at night, 1 in day
    const golden = smooth(clamp(1 - Math.abs(elevDeg - 7) / 17, 0, 1)) * dayAmt;
    this.night = 1 - dayAmt; this.dusk = golden;
    const u = this.sky.material.uniforms; u.sunPosition.value.copy(this.sunDir).multiplyScalar(1000);
    u.rayleigh.value = lerp(2.2, 3.4, golden); u.turbidity.value = lerp(8, 10, golden); u.mieDirectionalG.value = 0.8;
    // light
    const sunCol = new THREE.Color().setRGB(1, lerp(0.95, 0.62, golden), lerp(0.88, 0.4, golden));
    const moonCol = new THREE.Color(0x8fa6d6);
    if (dayAmt > 0.02) {
      this.sun.color.copy(sunCol); this.sun.intensity = lerp(0.0, 3.4, dayAmt) * lerp(1, 0.85, golden);
      this.lightDir = this.sunDir;
    } else {
      this.sun.color.copy(moonCol); this.sun.intensity = 0.45; this.lightDir = new THREE.Vector3(0.3, 0.8, 0.4).normalize();
    }
    const ld = dayAmt > 0.02 ? this.sunDir : this.lightDir;
    // keep shadow frustum centered on the focus point
    if (focus) {
      const snap = 2; const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
      this.sun.target.position.set(fx, 0, fz);
      this.sun.position.set(fx + ld.x * 200, Math.max(20, ld.y * 200), fz + ld.z * 200);
    }
    this.hemi.intensity = lerp(0.28, 0.75, dayAmt);
    this.hemi.color.setRGB(lerp(0.35, 0.74, dayAmt), lerp(0.42, 0.84, dayAmt), lerp(0.7, 1.0, dayAmt));
    this.hemi.groundColor.setRGB(lerp(0.08, 0.32, dayAmt) + golden * 0.08, lerp(0.07, 0.27, dayAmt), lerp(0.08, 0.2, dayAmt));
    // fog color tracks the horizon
    const fogDay = new THREE.Color(0x9fb6c9), fogGold = new THREE.Color(0xd9a27e), fogNight = new THREE.Color(0x0e1424);
    const fc = fogDay.clone().lerp(fogGold, golden).lerp(fogNight, this.night);
    this.fog.color.copy(fc); this.fog.near = lerp(60, 220, dayAmt); this.fog.far = lerp(480, 1400, dayAmt);
    this.renderer.toneMappingExposure = lerp(0.62, 0.46, dayAmt) + golden * 0.05;
    this.sky.material.uniforms.up.value.set(0, 1, 0);
    this.sky.visible = true;
    // stars/night tint: darken sky by lowering exposure handled above
    // env reflections refresh
    this.envTimer += dt;
    if (this.envTimer > 6) { this.envTimer = 0; this.refreshEnv(); }
  }
  refreshEnv() {
    const eu = this.envSky.material.uniforms, u = this.sky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) eu[k].value = u[k].value;
    eu.sunPosition.value.copy(u.sunPosition.value);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = lerp(0.12, 0.85, 1 - this.night);
  }
}
