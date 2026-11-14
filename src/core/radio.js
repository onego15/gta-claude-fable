// "MERIDIAN FM" — a small generative synthwave station (all synthesized, no samples).
export class Radio {
  constructor(audio) { this.audio = audio; this.on = false; this.enabled = true; this.step = 0; this.nextTime = 0; this.bpm = 96; this.station = 0; this.out = null; }
  get name() { return ['MERIDIAN FM 98.7', 'HARBOR LO-FI 101.3'][this.station]; }
  toggle() {
    if (!this.on) { this.on = true; this.station = 0; }
    else if (this.station === 0) this.station = 1;
    else this.on = false;
    this.bpm = this.station === 0 ? 96 : 78;
    if (this.onChange) this.onChange(this.on ? this.name : 'ラジオ OFF');
  }
  setPlaying(inVehicle) { this.playing = inVehicle && this.on; }
  update() {
    const A = this.audio; if (!A.ready) return; const ctx = A.ctx;
    if (!this.out) { this.out = ctx.createGain(); this.out.gain.value = 0; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000; this.out.connect(lp); lp.connect(A.music); this.lp = lp; }
    this.out.gain.setTargetAtTime(this.playing ? 0.55 : 0, ctx.currentTime, 0.3);
    if (!this.playing) { this.nextTime = ctx.currentTime + 0.1; return; }
    const spb = 60 / this.bpm / 4; // 16th notes
    while (this.nextTime < ctx.currentTime + 0.25) { this.schedule(this.step, this.nextTime, spb); this.nextTime += spb; this.step++; }
  }
  schedule(step, t, spb) {
    const A = this.audio, d = this.out; const s16 = step % 16, bar = Math.floor(step / 16);
    const lofi = this.station === 1;
    const prog = lofi ? [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]] : [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    const chord = prog[bar % 4];
    const f = (n) => 440 * Math.pow(2, (n - 69) / 12);
    // drums
    if (s16 % 4 === 0 && !(lofi && s16 === 4)) A.tone(d, t, 0.25, 150, 40, 'sine', 0.9);
    if (s16 === 4 || s16 === 12) A.noise(d, t, lofi ? 0.12 : 0.2, 3000, 1200, 0.8, 'bandpass', lofi ? 0.25 : 0.45);
    if (s16 % 2 === 0) A.noise(d, t, 0.03, 9000, 7000, 1, 'highpass', lofi ? 0.06 : 0.1);
    // bass
    if (s16 % (lofi ? 8 : 2) === 0) { const n = chord[0] - 24 + (s16 === 14 && !lofi ? 7 : 0); this.voice(d, t, spb * (lofi ? 6 : 1.6), f(n), 'sawtooth', 0.16, 500); }
    // pad
    if (s16 === 0) for (const n of chord) { this.voice(d, t, spb * 15, f(n), lofi ? 'triangle' : 'sawtooth', lofi ? 0.07 : 0.035, lofi ? 1400 : 1800, 0.25); this.voice(d, t, spb * 15, f(n) * 1.004, 'sawtooth', 0.02, 1500, 0.25); }
    // arp / melody
    if (!lofi && s16 % 2 === 1) { const n = chord[(Math.floor(step / 2)) % chord.length] + 12; this.voice(d, t, spb * 1.2, f(n), 'square', 0.04, 3000); }
    if (lofi && (s16 === 2 || s16 === 7 || s16 === 10) && (bar % 2 === 0)) { const n = chord[(s16 + bar) % chord.length] + 12; this.voice(d, t, spb * 3, f(n), 'sine', 0.08, 2500); }
  }
  voice(dest, t, dur, freq, type, vol, cutoff, attack = 0.01) {
    const ctx = this.audio.ctx; const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.setValueAtTime(vol, t + Math.max(attack, dur * 0.7)); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp); lp.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
}
