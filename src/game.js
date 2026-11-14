import * as THREE from 'three';
import { Graphics } from './core/graphics.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { Radio } from './core/radio.js';
import { CameraRig } from './core/cameraRig.js';
import { loadAssets, CHAR_MODELS } from './core/assets.js';
import { buildCity } from './world/city.js';
import { TimeOfDay } from './world/sky.js';
import { setMaxAnisotropy } from './world/textures.js';
import * as L from './world/layout.js';
import { CharacterFactory } from './actors/humanoid.js';
import { Actor } from './actors/actor.js';
import { Player } from './actors/player.js';
import { buildCarTemplates, Vehicle, collideVehicles } from './actors/vehicle.js';
import { Effects } from './combat/effects.js';
import { Combat } from './combat/combat.js';
import { Traffic } from './ai/traffic.js';
import { Pedestrians, PedAI } from './ai/pedestrians.js';
import { Police, Wanted } from './ai/police.js';
import { CombatAI } from './ai/combatant.js';
import { signalState } from './ai/roads.js';
import { Missions } from './systems/missions.js';
import { HUD } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { clamp, damp, lerp, pick, rng } from './core/utils.js';

const PED_MODELS = CHAR_MODELS.filter((m) => m !== 'Male_LongSleeve');

export class Game {
  constructor() {
    this.state = 'loading'; this.time = 0; this.difficulty = 1;
    this.vehicles = []; this.actors = []; this.pickups = [];
    this.settings = { quality: 'high', sens: 1, vol: 0.8, music: 0.55, peds: 30, traffic: 16, timeScale: 1 };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('pm_settings') || '{}')); } catch (e) { /* ignore */ }
    this.params = new URLSearchParams(location.search);
    this.frustum = new THREE.Frustum(); this.projScreen = new THREE.Matrix4();
  }
  async boot() {
    this.gfx = new Graphics(document.getElementById('app'));
    this.scene = this.gfx.scene; this.camera = this.gfx.camera; this.renderer = this.gfx.renderer;
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    this.menus = new Menus(this);
    await Promise.all([document.fonts.load('48px "Bebas Neue"'), document.fonts.load('600 20px Rajdhani'), document.fonts.load('700 16px "Noto Sans JP"')]).catch(() => {});
    this.assets = await loadAssets((p) => this.menus.loading(p * 0.7, 'モデルと音声を読み込み中…'));
    this.menus.loading(0.75, '街を組み立てています…'); await new Promise((r) => setTimeout(r, 30));
    const city = this.city = buildCity(this.assets);
    this.scene.add(city.root); this.statics = city.statics;
    this.menus.loading(0.88, '住人を呼んでいます…'); await new Promise((r) => setTimeout(r, 30));
    this.sky = new TimeOfDay(this.scene, this.renderer);
    this.sky.setHours(+(this.params.get('t') || 17.6));
    this.input = new Input(this.renderer.domElement);
    this.input.onLockChange = (locked) => { if (!locked && this.state === 'play' && !this.params.has('nolock')) this.pause(); };
    this.audio = new Audio(); this.radio = new Radio(this.audio); this.radio.onChange = (n) => this.hud.radio(n);
    this.rig = new CameraRig(this.camera, this.statics);
    this.chars = new CharacterFactory(this.assets);
    this.carTpl = buildCarTemplates(this.assets);
    this.effects = new Effects(this.scene);
    this.combat = new Combat(this);
    this.hud = new HUD(this);
    this.wanted = new Wanted(this); this.police = new Police(this);
    this.traffic = new Traffic(this); this.peds = new Pedestrians(this);
    this.missions = new Missions(this);
    // dynamic lights (fixed count to avoid shader recompiles)
    this.headLight = new THREE.SpotLight(0xfff0d0, 0, 45, 0.55, 0.5, 1.2); this.headLight.castShadow = false; this.scene.add(this.headLight, this.headLight.target);
    this.copLight = new THREE.PointLight(0xff2020, 0, 22, 2); this.scene.add(this.copLight);
    // player
    const hum = this.chars.create('Male_LongSleeve', { colors: { skin: '#c68d63', hair: '#1b1410', top: '#3d4f3a', bottom: '#23262b', shoes: '#5c3d2e' } });
    this.scene.add(hum.root);
    this.player = new Player(this, hum); this.actors.push(this.player);
    this.player.giveWeapon('pistol', 60);
    this.spawnPlayerAt(L.LANDMARKS.playerStart.x, L.LANDMARKS.playerStart.z, L.LANDMARKS.playerStart.heading);
    // world population
    this.spawnParked();
    for (let i = 0; i < 14; i++) this.traffic.spawnOne(true);
    for (let i = 0; i < 26; i++) this.peds.spawnOne(true);
    this.applySettings({}, true);
    this.menus.loading(1, '準備完了');
    // warm-up render (compiles shaders)
    this.gfx.render(0.016);
    this.state = 'title';
    this.menus.showScreen('loading', false); this.menus.showScreen('title', true);
    if (this.params.has('autostart')) this.startPlay();
    this.last = performance.now();
    this.loop = this.loop.bind(this); requestAnimationFrame(this.loop);
    window.__ready = true;
  }
  applySettings(o, init) {
    Object.assign(this.settings, o); const s = this.settings;
    if (init || o.quality) this.gfx.setQuality(s.quality);
    this.input.sensitivity = s.sens;
    this.audio.volumes.master = s.vol; this.audio.volumes.music = s.music; if (this.audio.ctx) { this.audio.setVolume('master', s.vol); this.audio.setVolume('music', s.music); }
    this.peds.target = s.peds; this.traffic.target = s.traffic;
    this.sky.speed = (24 / (24 * 60)) * s.timeScale;
    try { localStorage.setItem('pm_settings', JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  async startPlay() {
    if (!this.audio.ctx) await this.audio.init(this.assets.audio); this.audio.resume();
    this.menus.showScreen('title', false); this.menus.showScreen('sub-panel', false);
    this.state = 'play'; this.hud.show(true);
    if (!this.params.has('nolock')) this.input.lock();
    if (!this.introShown) {
      this.introShown = true;
      this.hud.toast('<b>PORT MERIDIAN</b> へようこそ。マップのアイコン（D / S / H）がミッション開始地点だ。', 'info', 7);
      setTimeout(() => this.hud.toast('近くの車に <kbd>F</kbd> で乗り込める。<kbd>Esc</kbd> でマップ。', 'info', 6), 2500);
    }
  }
  pause(silent) {
    if (this.state !== 'play') return; this.state = 'paused'; this.input.unlock();
    if (!silent) this.menus.openPause();
  }
  resume() {
    this.menus.showScreen('pause', false); this.menus.$('#lockhint').classList.remove('show');
    this.state = 'play'; this.audio.resume(); if (!this.params.has('nolock')) this.input.lock();
  }
  focusPos() { return this.player.inVehicle ? this.player.inVehicle.pos : this.player.pos; }
  isVisible(x, y, z, r = 1) { return this.frustum.intersectsSphere(new THREE.Sphere(new THREE.Vector3(x, y, z), r)); }

  // ---------- spawning ----------
  spawnVehicle(model, x, z, heading, opts = {}) {
    const v = new Vehicle(this.carTpl[model], opts); v.place(x, z, heading);
    this.scene.add(v.root); this.vehicles.push(v);
    v.onImpact = (veh, speed, tag, other) => this.onVehicleImpact(veh, speed, tag, other);
    v.onExplode = (veh) => this.onVehicleExplode(veh);
    return v;
  }
  removeVehicle(v) {
    if (v === this.player.inVehicle || v.missionCar) return;
    const i = this.vehicles.indexOf(v); if (i >= 0) this.vehicles.splice(i, 1);
    this.audio.setSiren(v.id, null, false);
    v.dispose();
  }
  spawnParked() {
    const spots = this.city.data.parkedSpots; const r = rng(99);
    const models = ['NormalCar1', 'NormalCar2', 'SUV', 'SportsCar', 'SportsCar2', 'Taxi', 'NormalCar1', 'SUV'];
    for (const s of spots) {
      if (r() > 0.45) continue;
      const v = this.spawnVehicle(models[Math.floor(r() * models.length)], s.x, s.z, s.heading); v.sleeping = true; v.parked = true;
    }
    // a guaranteed ride next to the player start
    const ps = L.LANDMARKS.playerStart; const v = this.spawnVehicle('SportsCar', L.roadX(2) + L.PARK_OFF, ps.z - 10, Math.PI, { paint: '#c0392b' }); v.sleeping = true; v.parked = true;
  }
  makeHuman(model, colors, opts = {}) { const h = this.chars.create(model, { colors, ...opts }); this.scene.add(h.root); return h; }
  spawnPed(x, z, model) {
    const h = this.makeHuman(model || pick(PED_MODELS));
    const a = new Actor(this, h, { team: 'civ', hp: 40 }); a.pos.set(x, L.groundHeight(x, z), z); a.heading = Math.random() * 6.28;
    this.actors.push(a); return a;
  }
  spawnGang(x, z, weapon = 'pistol') {
    const h = this.makeHuman(pick(['Male_Casual', 'Male_LongSleeve', 'Male_Shirt']), { top: pick(['#8b1e1e', '#a4161a', '#2b2b2b', '#5c1a1a']), bottom: '#1d1d1f', shoes: '#111', hair: '#111' });
    const a = new Actor(this, h, { team: 'gang', hp: 70, weapon, heading: Math.PI });
    a.pos.set(x, L.groundHeight(x, z), z); a.weapons[weapon].reserve = 999;
    a.ai = new CombatAI(this, a, { kind: 'gang', accuracy: 0.9, damageMul: weapon === 'smg' ? 0.38 : 0.3 });
    this.actors.push(a); return a;
  }
  spawnOfficer(x, z) {
    const h = this.makeHuman('Male_Shirt', { top: '#1f3a6b', bottom: '#14213d', shoes: '#0b0b0b', hair: pick(['#1b1410', '#4a2e1a', '#6b4423']) });
    // police cap
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0x0f1c33, roughness: 0.6 }));
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.1), cap.material); brim.position.set(0, -0.03, 0.1); cap.add(brim);
    const head = h.bones.Head; if (head) { head.add(cap); const s = 1 / head.getWorldScale(new THREE.Vector3()).x; cap.scale.setScalar(s); cap.position.set(0, 0.21 * s, 0.0); }
    const a = new Actor(this, h, { team: 'police', hp: 80, weapon: 'pistol' });
    a.pos.set(x, L.groundHeight(x, z), z);
    a.ai = new CombatAI(this, a, { kind: 'police', state: 'combat', accuracy: 0.8, damageMul: 0.27 });
    a.ai.lastSeen.copy(this.focusPos()); a.ai.lastSeenTime = this.time;
    this.actors.push(a); return a;
  }
  spawnDriverFor(v) { return { npc: true, model: pick(PED_MODELS) }; }
  removeActor(a) {
    if (a === this.player) return;
    const i = this.actors.indexOf(a); if (i >= 0) this.actors.splice(i, 1);
    if (a.ai && a.ai.bench) a.ai.bench.used = false;
    if (a.ai && a.ai.cover) a.ai.cover.taken = null;
    a.dispose();
  }
  spawnPickup(kind, pos) {
    const colors = { health: 0x4cd964, armor: 0x2ec4b6, ammo: 0xffd166, case: 0xc0c0c0 };
    const g = new THREE.Group(); g.position.copy(pos);
    let m;
    if (kind === 'case') { m = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.38, 0.14), new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.9, roughness: 0.25 })); }
    else { m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: colors[kind], emissive: colors[kind], emissiveIntensity: 0.5, roughness: 0.4 })); }
    m.position.y = 0.7; m.castShadow = true; g.add(m); this.scene.add(g);
    const p = { kind, g, m, pos: g.position, taken: false, remove: () => { g.removeFromParent(); this.pickups.splice(this.pickups.indexOf(p), 1); } };
    this.pickups.push(p); return p;
  }

  // ---------- events ----------
  noise(pos, radius, kind, source) {
    this.peds.alarm(pos, radius, kind, source);
    if (kind === 'gunshot' && source === this.player) {
      if (!this.wanted.suppressed) this.wanted.report('shots', pos);
      for (const a of this.actors) if (a.ai && a.ai.kind === 'gang' && a.alive && a.distTo(pos) < 50) a.ai.alert(pos);
      for (const a of this.actors) if (a.team === 'police' && a.alive && a.distTo(pos) < 40) { a.ai.provoked = true; }
    }
    if (kind === 'gunshot') for (const v of this.vehicles) if (v.ai && v.ai.kind === 'traffic' && v.pos.distanceTo(pos) < 40) v.ai.panic = 8;
  }
  onActorDeath(a, from, kind) {
    if (a === this.player) return this.onPlayerDeath();
    this.missions.event('death', a);
    if (from === this.player || (from && from.driver === this.player)) {
      if (a.team === 'civ') this.wanted.suppressed ? null : this.wanted.report('murder', a.pos);
      if (a.team === 'police') this.wanted.report('copKill', a.pos, { witnessed: true });
      if (a.team === 'gang') this.player.money += 25;
    }
    this.peds.alarm(a.pos, 25, 'death', from);
    // drop
    if (a.team !== 'civ' && Math.random() < 0.6) this.spawnPickup(Math.random() < 0.7 ? 'ammo' : 'health', a.pos.clone().setY(a.pos.y));
  }
  onVehicleHitActor(v, a, speed) {
    if (a === this.player && v.driver === this.player) return;
    const dmg = speed * speed * 0.9;
    const dx = a.pos.x - v.pos.x, dz = a.pos.z - v.pos.z, d = Math.hypot(dx, dz) || 1;
    a.vel.set(dx / d * speed * 0.6 + v.vx * 0.5, 0, dz / d * speed * 0.6 + v.vz * 0.5); a.vy = Math.min(6, speed * 0.25); a.grounded = false;
    if (a === this.player) { a.takeDamage(Math.min(dmg, 45), v.driver, dx / d, dz / d, 'vehicle'); this.rig.shake(0.4); return; }
    a.takeDamage(dmg, v.driver === this.player ? this.player : v, dx / d, dz / d, 'vehicle');
    this.audio.play('punch', a.pos);
    if (v.driver === this.player) {
      if (a.team === 'police') this.wanted.report('copAssault', a.pos);
      else if (a.team === 'civ' && !a.alive) this.wanted.report('vehicleHit', a.pos);
    }
  }
  onVehicleImpact(v, speed, tag, other) {
    this.audio.crash(v.pos, speed);
    if (v === this.player.inVehicle) { this.rig.shake(clamp(speed / 25, 0.1, 0.7)); }
    if (other && v.driver === this.player && other.police && other.driver) this.wanted.report('copAssault', other.pos);
    if (speed > 12 && v.driver && v.driver.npc && v.ai && v.ai.kind === 'traffic') v.ai.panic = 5;
  }
  onVehicleExplode(v) {
    this.effects.explosion(v.pos); this.audio.explosion(v.pos); this.rig.shake(clamp(1 - v.pos.distanceTo(this.focusPos()) / 40, 0, 1) * 0.9);
    for (const a of this.actors) { const d = a.distTo(v.pos); if (d < 7 && !a.inVehicle) a.takeDamage(clamp((7 - d) * 30, 0, 120), this.player.inVehicle === v ? null : (v.lastShooter || null), a.pos.x - v.pos.x, a.pos.z - v.pos.z, 'explosion'); }
    for (const o of this.vehicles) if (o !== v && o.pos.distanceTo(v.pos) < 6) o.damage(260);
    if (this.player.inVehicle === v) { this.player.exitVehicle(true); this.player.takeDamage(1000, null, 0, 0, 'explosion'); }
    if (v.ai) v.ai = null; if (v.driver && v.driver.npc) v.driver = null;
    this.noise(v.pos, 60, 'explosion', null);
    if (v.lastShooter === this.player) this.wanted.report('explosion', v.pos);
  }
  onVehicleShot(v, shooter) {
    v.lastShooter = shooter;
    if (v.ai && v.ai.kind === 'traffic') v.ai.panic = 10;
    if (v.police) this.wanted.report('copAssault', v.pos);
  }
  onCarjack(v, p) {
    const drv = v.driver;
    if (drv && drv.npc) {
      // eject driver as a fleeing pedestrian
      const door = v.driverDoor(); const a = drv.police ? this.spawnOfficer(door.x, door.z) : this.spawnPed(door.x, door.z, drv.model);
      if (!drv.police) { const nodes = this.peds.graph.nodes; let nb = 0, nd = 1e9; for (const n of nodes) { const dd = (n.x - a.pos.x) ** 2 + (n.z - a.pos.z) ** 2; if (dd < nd) { nd = dd; nb = n.id; } }
        const nn = this.peds.graph.edges.get(nb); a.ai = new PedAI(this.peds, a, nb, nn && nn.length ? nn[0].to : nb); a.ai.scare(p.pos, 'carjack', p, 1); }
      else this.police.officers.push(a);
      a.vel.set(-Math.cos(v.heading) * -3, 0, Math.sin(v.heading) * -3);
      this.wanted.report(v.police ? 'copCar' : 'carjack', v.pos);
    } else if (v.police) this.wanted.report('copCar', v.pos);
    v.ai = null; v.driver = null; v.sleeping = false; v.throttle = 0; v.brake = 1; v.handbrake = 1; v.steer = 0;
  }
  onPlayerEnteredVehicle(v) {
    v.ai = null; v.parked = false; v.sleeping = false; v.allowReverse = true;
    this.hud.toast(`${v.spec.label}`, 'info', 2.5);
    this.radio.setPlaying(true);
    if (!this.radioHintShown) { this.radioHintShown = true; this.hud.toast('<kbd>R</kbd> でカーラジオ「MERIDIAN FM」', 'info', 4); }
    if (v.police && !this.wanted.suppressed && this.wanted.level < 2) this.wanted.report('copCar', v.pos);
  }
  onPlayerExitedVehicle(v) { this.radio.setPlaying(false); v.sleeping = false; }
  onEnemySpotted(ai) { this.missions.event('spotted', ai); }
  onArrest() {
    if (this.state !== 'play' || !this.player.alive) return;
    this.endSequence('arrest');
  }
  onWantedCleared() { this.police.clear(); }
  onPlayerDeath() { this.endSequence('death'); }
  endSequence(kind) {
    if (this.seq) return;
    const p = this.player; this.seq = { kind, t: 0 };
    this.missions.active && this.missions.fail(kind === 'death' ? '倒れてしまった' : '逮捕された');
    if (kind === 'arrest') { p.hum.handsUp = 1; this.audio.play('arrest'); this.hud.bigMessage('ARRESTED', '逮捕 ― 罰金と所持品の一部を没収', 'fail', 5); }
    else { this.audio.play('death'); this.hud.bigMessage('KNOCKED OUT', '病院へ搬送 ― 治療費を請求', 'fail', 5); }
    this.slowmo = 0.3;
  }
  updateSequence(dt) {
    const s = this.seq; s.t += dt; const p = this.player;
    this.slowmo = s.t < 2.2 ? 0.35 : Math.min(1, (this.slowmo ?? 1) + dt);
    this.gfx.grade.uniforms.desat.value = clamp(s.t / 1.5, 0, 0.85);
    if (s.kind === 'arrest') p.hum.handsUp = 1;
    if (s.t > 4.2 && !s.done) {
      s.done = true;
      const fee = Math.min(p.money, s.kind === 'death' ? 100 + Math.round(p.money * 0.08) : 150 + Math.round(p.money * 0.1));
      p.money -= fee;
      if (p.inVehicle) p.exitVehicle(true);
      p.alive = true; p.hp = 100; p.armor = 0; p.hum.revive(); p.hum.handsUp = 0; p.hum.weaponVisible = true;
      if (s.kind === 'arrest') { for (const w of Object.values(p.weapons)) w.reserve = Math.floor(w.reserve / 2); }
      this.wanted.set(0); this.wanted.level = 0;
      for (const v of [...this.vehicles]) if (v.police) this.removeVehicle(v);
      for (const a of [...this.actors]) if (a.team === 'police' || (a.team === 'gang' && !a.alive)) this.removeActor(a);
      const d = this.city.data; const spot = s.kind === 'death' ? d.hospitalFront : d.policeFront;
      this.spawnPlayerAt(spot.x, spot.z, s.kind === 'death' ? -Math.PI / 2 : Math.PI / 2);
      this.hud.toast(`${s.kind === 'death' ? '治療費' : '罰金'} -$${fee}`, 'wanted');
      this.sky.setHours(this.sky.hours + 3);
    }
    if (s.t > 5.2) { this.seq = null; this.slowmo = 1; this.gfx.grade.uniforms.desat.value = 0; }
  }
  spawnPlayerAt(x, z, heading) {
    const p = this.player; p.pos.set(x, L.groundHeight(x, z), z); p.heading = heading; p.vel.set(0, 0, 0); p.hum.root.visible = true;
    this.rig.yaw = heading + Math.PI; this.rig.pitch = 0.15;
  }

  // ---------- main loop ----------
  loop(now) {
    requestAnimationFrame(this.loop);
    let dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    if (this.fixedStep) return; // driven externally (capture mode)
    this.frame(dt);
  }
  frame(dt, skipRender) {
    const real = dt;
    this.realDt = dt;
    if (this.state === 'play') this.update(dt * (this.slowmo ?? 1));
    else if (this.state === 'title') this.updateTitle(dt);
    else if (this.state === 'paused') { /* frozen */ }
    if (!skipRender) this.render(real);
    else { this.camera.updateMatrixWorld(); this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.projScreen); }
    this.input.endFrame();
  }
  updateTitle(dt) {
    this.time += dt; this.titleT = (this.titleT || 0) + dt;
    const t = this.titleT * 0.035; const c = this.city.data.parkCenter;
    const R = 120; this.camera.position.set(c.x + Math.sin(t) * R, 46 + Math.sin(t * 0.7) * 8, c.z + Math.cos(t) * R + 40);
    this.camera.lookAt(c.x, 8, c.z + 30);
    this.sky.update(dt * 0, this.camera.position);
    this.worldUpdate(dt, true);
  }
  update(dt) {
    this.time += dt;
    const inp = this.input, p = this.player;
    if (inp.hit('Escape') || inp.hit('KeyM') || inp.hit('KeyP')) { this.pause(); return; }
    if (inp.locked || this.params.has('nolock')) this.rig.look(inp.mouse.dx * inp.sensitivity, inp.mouse.dy * inp.sensitivity);
    const lx = inp.axis('lookX'), ly = inp.axis('lookY'); if (lx || ly) this.rig.look(lx * 18, ly * 14);
    // player
    p.update(dt); p.physics(dt);
    if (!p.inVehicle) { p.hum.update(dt); p.hum.setShadow(true); }
    p.hiddenInGarage = false;
    // pickups
    for (const k of [...this.pickups]) {
      k.m.rotation.y += dt * 2; k.m.position.y = 0.7 + Math.sin(this.time * 3) * 0.08;
      if (!p.inVehicle && p.distTo(k.pos) < 1.3) {
        if (k.kind === 'health') { if (p.hp >= 100) continue; p.hp = Math.min(100, p.hp + 40); this.hud.toast('体力回復 +40', 'good', 2); }
        else if (k.kind === 'armor') { p.armor = Math.min(100, p.armor + 50); this.hud.toast('防弾ベスト +50', 'good', 2); }
        else if (k.kind === 'ammo') { const w = p.weapon || p.weapons.pistol; if (w) w.reserve += w.def.mag * 2; this.hud.toast('弾薬を拾った', 'good', 2); }
        k.taken = true; this.audio.play('pickup'); if (k.kind !== 'case') k.remove(); else k.remove();
      }
    }
    // aiming at peds scares them
    if (p.aiming && p.aimHitActor && p.aimHitActor.ai && p.aimHitActor.ai.kind === 'ped') p.aimHitActor.ai.scare(p.pos, 'aim', p, 5);
    if (p.aiming && p.aimHitActor && p.aimHitActor.team === 'police' && this.wanted.level === 0 && !this.wanted.suppressed) { this.wanted.report('copAssault', p.pos, { witnessed: true }); p.aimHitActor.ai.provoked = true; }
    this.wanted.update(dt);
    this.police.update(dt);
    this.traffic.update(dt);
    this.peds.update(dt);
    this.missions.update(dt);
    // other combatants (gang)
    for (const a of this.actors) if (a.ai && a.ai.kind === 'gang') a.ai.update(dt, a.distTo(p.pos));
    // gang bodies cleanup
    for (const a of [...this.actors]) if (a.team === 'gang' && !a.alive && this.time - a.deadTime > 40 && !this.missions.active) this.removeActor(a);
    if (this.seq) this.updateSequence(this.realDt ?? dt);
    this.worldUpdate(dt, false);
    // camera
    this.rig.update(dt, { vehicle: p.inVehicle, position: p.pos, aiming: p.aiming && !p.inVehicle, sprinting: p.sprinting });
    // HUD
    if (p.inVehicle && !this.seq) this.hud.prompt('');
    else if (!p.inVehicle && !p.enterState && p.alive) { const v = p.nearestVehicle(); if (v && !this.missions.nearStart()) this.hud.prompt(v.driver && v.driver.npc ? 'F ： 車を奪う' : 'F ： 乗る'); }
    this.hud.update(dt);
    this.radio.update();
    this.gfx.grade.uniforms.hurt.value = damp(this.gfx.grade.uniforms.hurt.value, p.alive ? clamp((40 - p.hp) / 40, 0, 1) * 0.6 : 0.4, 3, dt);
  }
  worldUpdate(dt, title) {
    const p = this.player;
    this.sky.update(title ? 0 : dt, this.focusPos());
    const night = this.sky.night;
    // city night lighting
    const d = this.city.data;
    const lampOn = clamp((night - 0.25) * 3, 0, 1);
    for (const m of d.facadeMats) m.emissiveIntensity = lampOn * 1.25;
    d.materials.shop.emissiveIntensity = 0.12 + lampOn * 1.3;
    d.poolMat.opacity = lampOn * 0.9; d.lampMat.color.setScalar(0.35 + lampOn * 2.4);
    for (const s of d.signMeshes || []) s.material.emissiveIntensity = 0.15 + lampOn * 1.1;
    d.water.update(this.time);
    // traffic light bulbs
    this.bulbT = (this.bulbT || 0) - dt;
    if (this.bulbT <= 0) {
      this.bulbT = 0.2; const col = new THREE.Color();
      d.signalBulbs.forEach((b, i) => {
        const st = signalState(b.node, b.axis, this.time); const on = st === b.k;
        col.set(b.k === 'R' ? 0xff2a1a : b.k === 'Y' ? 0xffb300 : 0x20ff70); if (on) col.multiplyScalar(3); else col.multiplyScalar(0.06);
        d.bulbMesh.setColorAt(i, col);
      });
      d.bulbMesh.instanceColor.needsUpdate = true;
    }
    // vehicles
    const statics = this.statics; const V = this.vehicles;
    for (const v of V) {
      if (v.sleeping && !v.driver) { v.updateLights(night, this.time); continue; }
      const sub = v.speed > 25 ? 2 : 1;
      for (let s = 0; s < sub; s++) v.update(dt / sub, statics);
      if (!v.driver && v.speed < 0.05 && !v.dead && v.burnTimer <= 0) v.sleeping = true;
      v.updateLights(night, this.time);
      // effects
      if (v.burnTimer > 0 || v.dead) { if (Math.random() < 0.5) this.effects.smoke(v.pos.clone().add(new THREE.Vector3(0, 1.3, 0)).addScaledVector(v.forward(), v.hz * 0.6), v.dead ? 0.8 : 0.6, 1); if (!v.dead && Math.random() < 0.6) this.effects.fire(v.pos.clone().add(new THREE.Vector3(0, 1.1, 0)).addScaledVector(v.forward(), v.hz * 0.6)); }
      else if (v.health < 450 && Math.random() < 0.25) this.effects.smoke(v.pos.clone().add(new THREE.Vector3(0, 1.2, 0)).addScaledVector(v.forward(), v.hz * 0.7), 0.3, 0.6);
      if (v.slip > 4.5 && v.speed > 6) {
        const r = v.rightVec(), f = v.forward();
        for (const sx of [-1, 1]) { const wp = v.pos.clone().addScaledVector(r, sx * v.hx * 0.85).addScaledVector(f, -v.hz * 0.65); this.effects.skid(wp.x, wp.y, wp.z, v.heading); if (Math.random() < 0.35) this.effects.tireSmoke(wp); }
      }
    }
    for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
      const a = V[i], b = V[j]; if (a.sleeping && b.sleeping) continue;
      collideVehicles(a, b);
    }
    // engine / skid / siren audio
    if (this.audio.ready && !title) {
      const pv = p.inVehicle;
      if (pv) { const rpm = clamp(Math.abs(pv.forwardSpeed) / pv.spec.maxSpeed, 0, 1); const gearRpm = (rpm * 4) % 1 * 0.35 + rpm * 0.65; this.audio.setEngine('player', null, gearRpm, pv.throttle, 1.1); this.audio.setSkid(clamp((pv.slip - 4) / 6, 0, 1) * clamp(pv.speed / 10, 0, 1)); }
      else this.audio.setSkid(0);
      // nearest npc engines
      const near = V.filter((v) => v !== pv && v.driver && !v.dead).map((v) => [v, v.pos.distanceTo(this.camera.position)]).sort((a, b) => a[1] - b[1]).slice(0, 3);
      near.forEach(([v], i) => this.audio.setEngine('npc' + i, v.pos, clamp(v.speed / 30, 0, 1), v.throttle, 0.55));
      this.audio.endEngines();
      const sirens = V.filter((v) => v.police && v.sirenOn && !v.dead).sort((a, b) => a.pos.distanceTo(this.camera.position) - b.pos.distanceTo(this.camera.position));
      const active = new Set(sirens.slice(0, 3).map((v) => v.id));
      for (const v of V) if (v.police) this.audio.setSiren(v.id, v.pos, active.has(v.id));
      const nearWater = clamp(1 - (L.QUAY_Z - this.focusPos().z) / 60, 0, 1);
      this.audio.updateAmbience(night, nearWater);
      this.audio.setListener(this.camera);
    }
    // dynamic lights
    const pv = p.inVehicle;
    if (pv && night > 0.3) {
      const f = pv.forward(); this.headLight.intensity = 60 * night; this.headLight.position.copy(pv.pos).addScaledVector(f, pv.hz).add(new THREE.Vector3(0, 0.8, 0));
      this.headLight.target.position.copy(pv.pos).addScaledVector(f, pv.hz + 15);
    } else this.headLight.intensity = 0;
    const cop = V.filter((v) => v.police && v.sirenOn && !v.dead).sort((a, b) => a.pos.distanceTo(this.camera.position) - b.pos.distanceTo(this.camera.position))[0];
    if (cop && cop.pos.distanceTo(this.camera.position) < 80) { this.copLight.position.copy(cop.pos).add(new THREE.Vector3(0, 2.2, 0)); const ph = Math.floor(this.time * 6) % 2; this.copLight.color.set(ph ? 0xff2020 : 0x2040ff); this.copLight.intensity = 25 + night * 40; }
    else this.copLight.intensity = 0;
    this.effects.update(dt);
  }
  render(dt) {
    this.camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.projScreen);
    const t0 = performance.now();
    this.gfx.render(dt);
    this.lastRenderMs = performance.now() - t0;
  }
}
