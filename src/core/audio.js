// WebAudio sound engine: synthesized weapons/UI/sirens + sampled engine, skid, impact, ambience.
import * as THREE from 'three';
import { clamp, lerp } from './utils.js';

export class Audio {
  constructor() {
    this.ctx = null; this.ready = false; this.buffers = {};
    this.listener = { pos: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0) };
    this.volumes = { master: 0.8, sfx: 1, music: 0.55, ambience: 0.7 };
    this.engineVoices = []; this.sirens = new Map();
  }
  async init(raw) {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = this.volumes.master; this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.volumes.sfx; this.sfx.connect(comp);
    this.music = ctx.createGain(); this.music.gain.value = this.volumes.music; this.music.connect(comp);
    this.amb = ctx.createGain(); this.amb.gain.value = this.volumes.ambience; this.amb.connect(comp);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this.impulse(2.2, 2.5);
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.5; this.reverbSend.connect(this.reverb); this.reverb.connect(this.sfx);
    this.noiseBuf = this.makeNoise(2);
    for (const [k, ab] of Object.entries(raw || {})) { try { this.buffers[k] = await ctx.decodeAudioData(ab.slice(0)); } catch (e) { console.warn('decode fail', k); } }
    this.startAmbience();
    this.ready = true;
  }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }
  setVolume(k, v) { this.volumes[k] = v; if (!this.ctx) return; const n = { master: this.master, sfx: this.sfx, music: this.music, ambience: this.amb }[k]; if (n) n.gain.value = v; }
  makeNoise(sec) { const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
  impulse(sec, decay) {
    const ctx = this.ctx, len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 2000 ? i / 2000 : 1); }
    return b;
  }
  setListener(cam) { this.listener.pos.copy(cam.position); this.listener.right.set(1, 0, 0).applyQuaternion(cam.quaternion); }
  spatial(pos, ref = 8, max = 160) {
    if (!pos) return { gain: 1, pan: 0, dist: 0 };
    const d = this.listener.pos.distanceTo(pos);
    const gain = d < ref ? 1 : clamp(ref / d, 0, 1) * clamp(1 - (d - ref) / max, 0, 1);
    const dir = pos.clone().sub(this.listener.pos).normalize();
    return { gain, pan: clamp(dir.dot(this.listener.right), -1, 1) * 0.8, dist: d };
  }
  out(pos, gain = 1, reverb = 0.15, ref, max) {
    const ctx = this.ctx; const sp = this.spatial(pos, ref, max);
    const g = ctx.createGain(); g.gain.value = gain * sp.gain;
    const p = ctx.createStereoPanner(); p.pan.value = sp.pan; g.connect(p); p.connect(this.sfx);
    if (reverb > 0) { const r = ctx.createGain(); r.gain.value = reverb * (0.4 + clamp(sp.dist / 60, 0, 1)) * gain * Math.max(0.15, sp.gain); g.connect(r); r.connect(this.reverbSend); }
    return { node: g, gain: sp.gain };
  }
  noise(dest, t, dur, f0, f1, q = 1, type = 'bandpass', vol = 1, attack = 0.002) {
    const ctx = this.ctx; const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.playbackRate.value = 1;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(dest); src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  tone(dest, t, dur, f0, f1, type = 'sine', vol = 1, attack = 0.003) {
    const ctx = this.ctx; const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  sample(name, pos, { gain = 1, rate = 1, reverb = 0.1 } = {}) {
    const b = this.buffers[name]; if (!b) return;
    const o = this.out(pos, gain, reverb); if (o.gain < 0.01) return;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate; s.connect(o.node); s.start();
  }
  gunshot(kind, pos, isPlayer) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const o = this.out(isPlayer ? null : pos, isPlayer ? 0.9 : 1.1, 0.45, 10, 260); if (o.gain < 0.005) return;
    const d = o.node; const smg = kind === 'smg';
    this.noise(d, t, smg ? 0.09 : 0.16, 4000, 800, 0.6, 'lowpass', 1.0);
    this.noise(d, t, smg ? 0.05 : 0.08, 2500, 1200, 1.2, 'bandpass', 0.9);
    this.tone(d, t, smg ? 0.08 : 0.14, smg ? 140 : 120, 45, 'sine', 1.0);
    this.noise(d, t + 0.005, 0.35, 900, 200, 0.7, 'lowpass', 0.25, 0.01);
  }
  ricochet(pos) { if (!this.ready) return; const t = this.ctx.currentTime; const o = this.out(pos, 0.3, 0.2); if (o.gain < 0.02) return; this.tone(o.node, t, 0.18, 2400 + Math.random() * 800, 900, 'sine', 0.35); this.noise(o.node, t, 0.05, 3000, 2000, 2, 'bandpass', 0.4); }
  whiz(pos) { if (!this.ready) return; const t = this.ctx.currentTime; const o = this.out(pos, 0.5, 0); this.noise(o.node, t, 0.16, 5000, 1500, 4, 'bandpass', 0.7, 0.04); }
  footstep(pos, run) { if (!this.ready) return; const t = this.ctx.currentTime; const o = this.out(pos, run ? 0.22 : 0.14, 0.02, 4, 30); this.noise(o.node, t, 0.06, 1400 + Math.random() * 600, 300, 1, 'bandpass', 1); this.noise(o.node, t + 0.02, 0.05, 400, 120, 1, 'lowpass', 0.6); }
  explosion(pos) {
    if (!this.ready) return; const t = this.ctx.currentTime; const o = this.out(pos, 1.6, 0.6, 15, 400);
    this.noise(o.node, t, 1.8, 1200, 60, 0.5, 'lowpass', 1, 0.005); this.tone(o.node, t, 0.9, 80, 25, 'sine', 1.2); this.noise(o.node, t + 0.05, 2.5, 400, 60, 0.4, 'lowpass', 0.5, 0.05);
  }
  crash(pos, strength) {
    if (!this.ready) return; const g = clamp(strength / 15, 0.2, 1.3);
    this.sample('impact', pos, { gain: g, rate: 0.8 + Math.random() * 0.3, reverb: 0.15 });
    const t = this.ctx.currentTime; const o = this.out(pos, g * 0.6, 0.1); this.noise(o.node, t, 0.3, 2500, 300, 0.8, 'lowpass', 0.8); this.tone(o.node, t, 0.2, 90, 40, 'sine', 0.8);
    if (strength > 10) this.noise(o.node, t + 0.05, 0.5, 6000, 3000, 2, 'bandpass', 0.25); // glass
  }
  horn(v) {
    if (!this.ready) return; const t = this.ctx.currentTime; const o = this.out(v ? v.pos : null, 0.35, 0.1);
    for (const f of [392, 494]) { const os = this.ctx.createOscillator(); os.type = 'square'; os.frequency.value = f; const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.25, t + 0.02); g.gain.setValueAtTime(0.25, t + 0.32); g.gain.linearRampToValueAtTime(0, t + 0.38); const lp = this.ctx.createBiquadFilter(); lp.frequency.value = 1800; os.connect(lp); lp.connect(g); g.connect(o.node); os.start(t); os.stop(t + 0.4); }
  }
  play(name, pos) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const ui = this.out(pos || null, 0.5, 0.02);
    const d = ui.node;
    switch (name) {
      case 'reload': this.noise(d, t, 0.05, 2500, 1500, 3, 'bandpass', 0.6); this.noise(d, t + 0.35, 0.06, 3000, 1800, 3, 'bandpass', 0.7); this.noise(d, t + 0.9, 0.05, 2000, 1200, 3, 'bandpass', 0.6); break;
      case 'dry': this.noise(d, t, 0.03, 4000, 3000, 4, 'bandpass', 0.6); break;
      case 'jump': break;
      case 'door': this.noise(d, t, 0.12, 600, 150, 1, 'lowpass', 0.8); this.tone(d, t, 0.1, 120, 70, 'sine', 0.5); break;
      case 'blip': this.tone(d, t, 0.08, 1200, 1200, 'triangle', 0.25); break;
      case 'select': this.tone(d, t, 0.07, 880, 880, 'triangle', 0.25); this.tone(d, t + 0.06, 0.09, 1320, 1320, 'triangle', 0.2); break;
      case 'pickup': [880, 1108, 1318, 1760].forEach((f, i) => this.tone(d, t + i * 0.05, 0.12, f, f, 'triangle', 0.25)); break;
      case 'cash': [1318, 1760, 2093].forEach((f, i) => this.tone(d, t + i * 0.06, 0.18, f, f, 'square', 0.08)); break;
      case 'hit': this.tone(d, t, 0.05, 1800, 1400, 'square', 0.12); break;
      case 'kill': this.tone(d, t, 0.06, 1500, 1500, 'square', 0.1); this.tone(d, t + 0.05, 0.1, 2200, 2200, 'square', 0.1); break;
      case 'wanted': [523, 466, 392].forEach((f, i) => this.tone(d, t + i * 0.09, 0.2, f, f, 'sawtooth', 0.12)); break;
      case 'cleared': [392, 523, 659, 784].forEach((f, i) => this.tone(d, t + i * 0.08, 0.25, f, f, 'triangle', 0.2)); break;
      case 'success': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(d, t + i * 0.11, 0.35, f, f, 'triangle', 0.25)); this.tone(d, t + 0.66, 0.9, 523, 523, 'sine', 0.2); break;
      case 'fail': [392, 349, 311, 262].forEach((f, i) => this.tone(d, t + i * 0.16, 0.4, f, f, 'sawtooth', 0.1)); break;
      case 'checkpoint': this.tone(d, t, 0.12, 988, 988, 'triangle', 0.3); this.tone(d, t + 0.1, 0.2, 1318, 1318, 'triangle', 0.3); break;
      case 'death': this.tone(d, t, 1.6, 220, 55, 'sawtooth', 0.15); this.noise(d, t, 1.4, 500, 80, 0.5, 'lowpass', 0.4); break;
      case 'arrest': [659, 523, 659, 523].forEach((f, i) => this.tone(d, t + i * 0.25, 0.22, f, f, 'square', 0.08)); break;
      case 'punch': this.noise(d, t, 0.08, 800, 200, 1, 'lowpass', 0.8); break;
    }
  }
  // ---- continuous voices ----
  startAmbience() {
    const ctx = this.ctx;
    if (this.buffers.ambience) { const s = ctx.createBufferSource(); s.buffer = this.buffers.ambience; s.loop = true; const g = ctx.createGain(); g.gain.value = 0.35; s.connect(g); g.connect(this.amb); s.start(); this.ambSample = g; }
    // traffic rumble: brown-ish noise
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; const g2 = ctx.createGain(); g2.gain.value = 0.22;
    src.connect(lp); lp.connect(g2); g2.connect(this.amb); src.start(); this.rumble = g2;
    // harbor waves
    const w = ctx.createBufferSource(); w.buffer = this.noiseBuf; w.loop = true; const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 600;
    const wg = ctx.createGain(); wg.gain.value = 0; const lfo = ctx.createOscillator(); lfo.frequency.value = 0.12; const lg = ctx.createGain(); lg.gain.value = 0.08; lfo.connect(lg); lg.connect(wg.gain); lfo.start();
    w.connect(wf); wf.connect(wg); wg.connect(this.amb); w.start(); this.waves = wg;
  }
  updateAmbience(night, nearWater, indoorMuffle = 0) {
    if (!this.ready) return; const t = this.ctx.currentTime;
    this.rumble.gain.setTargetAtTime(lerp(0.22, 0.1, night), t, 0.5);
    if (this.ambSample) this.ambSample.gain.setTargetAtTime(lerp(0.32, 0.12, night), t, 0.5);
    this.waves.gain.setTargetAtTime(nearWater * 0.12, t, 0.5);
  }
  engineVoice(key) {
    if (!this.ready || !this.buffers.engine) return null;
    let v = this.engineVoices.find((e) => e.key === key); if (v) return v;
    const ctx = this.ctx; const s = ctx.createBufferSource(); s.buffer = this.buffers.engine; s.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    const g = ctx.createGain(); g.gain.value = 0; const p = ctx.createStereoPanner();
    s.connect(lp); lp.connect(g); g.connect(p); p.connect(this.sfx); s.start(0, Math.random() * 4);
    v = { key, s, g, p, lp }; this.engineVoices.push(v); return v;
  }
  setEngine(key, pos, rpm, load, vol = 1) {
    const v = this.engineVoice(key); if (!v) return; const t = this.ctx.currentTime;
    const sp = pos ? this.spatial(pos, 6, 80) : { gain: 1, pan: 0 };
    v.s.playbackRate.setTargetAtTime(0.55 + rpm * 1.25, t, 0.05);
    v.g.gain.setTargetAtTime((0.12 + load * 0.25) * sp.gain * vol, t, 0.05);
    v.p.pan.setTargetAtTime(sp.pan, t, 0.05); v.lp.frequency.setTargetAtTime(800 + load * 3000, t, 0.1);
    v.used = true;
  }
  endEngines() { for (const v of this.engineVoices) { if (!v.used) v.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); v.used = false; } }
  setSkid(amount, pos) {
    if (!this.ready || !this.buffers.skid) return;
    if (!this.skidV) { const s = this.ctx.createBufferSource(); s.buffer = this.buffers.skid; s.loop = true; const g = this.ctx.createGain(); g.gain.value = 0; s.connect(g); g.connect(this.sfx); s.start(); this.skidV = g; }
    const sp = pos ? this.spatial(pos, 8, 60).gain : 1;
    this.skidV.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.5 * sp, this.ctx.currentTime, 0.05);
  }
  setSiren(key, pos, on) {
    if (!this.ready) return;
    let s = this.sirens.get(key);
    if (!on) { if (s) { s.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); s.o.stop(this.ctx.currentTime + 0.5); this.sirens.delete(key); } return; }
    if (!s) {
      const ctx = this.ctx; const o = ctx.createOscillator(); o.type = 'sawtooth'; const lfo = ctx.createOscillator(); lfo.frequency.value = 0.42 + Math.random() * 0.1; const lg = ctx.createGain(); lg.gain.value = 380;
      lfo.connect(lg); lg.connect(o.frequency); o.frequency.value = 1050;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.value = 0; const p = ctx.createStereoPanner();
      o.connect(bp); bp.connect(g); g.connect(p); p.connect(this.sfx); const rs = ctx.createGain(); rs.gain.value = 0.25; g.connect(rs); rs.connect(this.reverbSend);
      o.start(); lfo.start(); s = { o, g, p, lfo }; this.sirens.set(key, s);
    }
    const sp = this.spatial(pos, 12, 300);
    s.g.gain.setTargetAtTime(0.13 * sp.gain, this.ctx.currentTime, 0.1); s.p.pan.setTargetAtTime(sp.pan, this.ctx.currentTime, 0.1);
  }
}
