// Story missions + collectibles. Each mission is a small state machine with objectives.
import * as THREE from 'three';
import * as L from '../world/layout.js';
import { radialGlowTexture } from '../world/textures.js';
import { clamp, fmtMoney } from '../core/utils.js';

function beaconTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.6, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0.9)');
  x.fillStyle = g; x.fillRect(0, 0, 4, 128); const t = new THREE.CanvasTexture(c); return t;
}
function iconTexture(letter, color) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = color; x.beginPath(); x.arc(64, 64, 56, 0, Math.PI * 2); x.fill();
  x.lineWidth = 8; x.strokeStyle = '#fff'; x.stroke();
  x.fillStyle = '#fff'; x.font = 'bold 76px "Bebas Neue", Impact'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(letter, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const BEACON_TEX = beaconTexture();

export class Marker {
  constructor(scene, pos, color, { radius = 1.6, height = 5, icon = null } = {}) {
    this.group = new THREE.Group(); this.group.position.copy(pos); this.radius = radius;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 32, 1, true), new THREE.MeshBasicMaterial({ color, map: BEACON_TEX, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
    cyl.position.y = height / 2; this.group.add(cyl); this.cyl = cyl;
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.85, radius, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.2; this.group.add(ring); this.ring = ring;
    if (icon) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: icon, depthTest: false, transparent: true })); s.scale.setScalar(1.6); s.position.y = height + 1.2; s.renderOrder = 10; this.group.add(s); this.icon = s; }
    scene.add(this.group); this.t = Math.random() * 6;
  }
  update(dt) { this.t += dt; this.cyl.material.opacity = 0.65 + Math.sin(this.t * 3) * 0.15; this.ring.scale.setScalar(1 + Math.sin(this.t * 2) * 0.05); if (this.icon) this.icon.position.y = 6.2 + Math.sin(this.t * 2) * 0.25; }
  dispose() { this.group.removeFromParent(); }
  get position() { return this.group.position; }
}

const MISSION_DEFS = [
  { id: 'delivery', letter: 'D', color: '#2ec4b6', title: 'ラスト・デリバリー', en: 'LAST DELIVERY', type: '運転', desc: 'カフェ・ソレイユの店主ノラから急ぎの依頼。閉店前のハーバー・マーケットへ荷物を届けろ。', reward: 600 },
  { id: 'dock', letter: 'S', color: '#ff6b4a', title: 'ドック・セブン', en: 'DOCK SEVEN', type: '銃撃戦', desc: '第7コンテナヤードに居座るソルトライン・クルーを排除し、奪われたケースを取り戻せ。', reward: 1200 },
  { id: 'heist', letter: 'H', color: '#ffd166', title: 'ヒート・ラン', en: 'HEAT RUN', type: '逃走', desc: 'ベイライン自動車の展示車「ストラーダRS ゴールド」を盗み出し、警察を撒いてセーフハウスへ運べ。', reward: 2500 },
];

export class Missions {
  constructor(game) {
    this.game = game; this.defs = MISSION_DEFS; this.active = null; this.markers = []; this.completed = new Set();
    try { const s = JSON.parse(localStorage.getItem('pm_completed') || '[]'); s.forEach((x) => this.completed.add(x)); } catch (e) { /* storage unavailable */ }
    const d = game.city.data;
    this.starts = {
      delivery: new THREE.Vector3(L.roadX(2) + L.ROAD_HALF + 3.2, L.CURB_H, L.roadZ(3) + 22),
      dock: new THREE.Vector3(d.yard.cx - 9, L.CURB_H, d.yard.rect.z0 - 3.5),
      heist: new THREE.Vector3(d.showroomLot.x - 18, L.CURB_H, L.roadZ(1) - L.ROAD_HALF - 2.5),
    };
    this.startMarkers = {};
    for (const def of this.defs) this.startMarkers[def.id] = new Marker(game.scene, this.starts[def.id], def.color, { radius: 1.3, height: 4, icon: iconTexture(def.letter, def.color) });
    this.timer = null; this.objective = ''; this.step = 0; this.ents = []; this.target = null; this.gps = null; this.gpsT = 0;
    this.tokens = []; this.setupTokens();
  }
  saveProgress() { try { localStorage.setItem('pm_completed', JSON.stringify([...this.completed])); } catch (e) { /* ignore */ } }
  get blips() {
    const out = [];
    if (!this.active) for (const def of this.defs) out.push({ x: this.starts[def.id].x, z: this.starts[def.id].z, color: def.color, letter: def.letter, done: this.completed.has(def.id) });
    if (this.target) out.push({ x: this.target.x, z: this.target.z, color: '#ffd166', kind: 'target' });
    return out;
  }
  nearStart() {
    if (this.active || this.game.player.inVehicle) return null;
    for (const def of this.defs) { const p = this.starts[def.id]; if (this.game.player.distTo(p) < 1.9) return def; }
    return null;
  }
  update(dt) {
    const g = this.game, p = g.player;
    for (const m of Object.values(this.startMarkers)) { m.update(dt); m.group.visible = !this.active; }
    for (const m of this.markers) m.update(dt);
    this.updateTokens(dt);
    if (!this.active) {
      const def = this.nearStart();
      if (def && g.state === 'play') { g.hud.prompt(`E ： ミッション開始「${def.title}」`); if (g.input.hit('KeyE')) g.menus.missionIntro(def, () => this.start(def.id)); }
      return;
    }
    if (this.timer !== null) {
      this.timer -= dt;
      if (this.timer <= 0) { this.timer = 0; this.fail('時間切れ'); return; }
    }
    // GPS
    this.gpsT -= dt;
    if (this.target && this.gpsT <= 0) {
      this.gpsT = 0.8; const fp = g.focusPos();
      const path = L.findPath(L.nearestNode(fp.x, fp.z), L.nearestNode(this.target.x, this.target.z));
      this.gps = [{ x: fp.x, z: fp.z }, ...path.map((id) => L.nodePos(id)), { x: this.target.x, z: this.target.z }];
    }
    this.active.update(dt);
  }
  start(id) {
    const g = this.game; if (this.active) return;
    const def = this.defs.find((d) => d.id === id);
    this.def = def; this.step = 0; this.timer = null; this.target = null; this.gps = null; this.ents = [];
    const M = { delivery: DeliveryMission, dock: DockMission, heist: HeistMission }[id];
    this.active = new M(this, g, def);
    g.hud.missionBanner(def.en, def.title);
    g.audio.play('select');
    this.active.begin();
  }
  setObjective(text) { this.objective = text; this.game.hud.objective(text); }
  setTarget(pos, radius = 3, color = '#ffd166', height = 5) {
    this.clearMarkers();
    if (!pos) { this.target = null; this.gps = null; return; }
    this.target = pos.clone(); this.gpsT = 0;
    this.markers.push(new Marker(this.game.scene, pos, color, { radius, height }));
  }
  clearMarkers() { for (const m of this.markers) m.dispose(); this.markers = []; }
  cleanup() {
    this.clearMarkers(); this.target = null; this.gps = null; this.timer = null;
    for (const e of this.ents) { if (e.isVehicleRef) { if (e.v.driver !== this.game.player) { e.v.missionCar = false; } } else if (e.actor) { /* leave bodies */ } }
    this.ents = []; this.active = null; this.game.hud.objective('');
  }
  pass(extra = '') {
    const g = this.game, def = this.def; const a = this.active; if (!a) return;
    const reward = def.reward + (a.bonus || 0);
    g.player.money += reward; this.completed.add(def.id); this.saveProgress();
    g.audio.play('success');
    g.hud.bigMessage('MISSION PASSED', `${def.title}　${fmtMoney(reward)}${extra ? '　' + extra : ''}`, 'pass');
    a.end && a.end(true); this.cleanup();
    if (this.completed.size === this.defs.length && !this.allDoneShown) { this.allDoneShown = true; setTimeout(() => g.hud.toast('全ミッション達成！ 港町の噂はあなたで持ちきりだ。トークン集めや自由探索を楽しもう。', 'good', 8), 4500); }
  }
  fail(reason) {
    const g = this.game; const a = this.active; if (!a) return;
    g.audio.play('fail'); g.hud.bigMessage('MISSION FAILED', reason, 'fail');
    a.end && a.end(false); this.cleanup();
  }
  event(type, data) { if (this.active && this.active.event) this.active.event(type, data); }
  // ---- collectibles ----
  setupTokens() {
    const d = this.game.city.data;
    const spots = [
      [d.parkCenter.x + 24, d.parkCenter.z + 24], [d.fountain.x, d.fountain.z + 9], [L.roadX(1) + 20, L.QUAY_Z + 24], [d.yard.cx + 20, d.yard.rect.z1 - 4],
      [d.marketCenter.x - 16, d.marketCenter.z], [L.roadX(4) + 50, L.QUAY_Z + 26], [d.showroomInside[0].x, d.showroomInside[0].z], [L.CITY_MIN_X - 12, L.roadZ(2) + 40],
      [L.CITY_MAX_X + 12, L.roadZ(1) + 30], [L.roadX(2) + 42, L.CITY_MIN_Z - 11],
    ];
    const geo = new THREE.TorusGeometry(0.32, 0.09, 10, 24); const mat = new THREE.MeshStandardMaterial({ color: 0xffc94a, emissive: 0xff9a1a, emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.25 });
    let got = new Set(); try { got = new Set(JSON.parse(localStorage.getItem('pm_tokens') || '[]')); } catch (e) { /* ignore */ }
    spots.forEach(([x, z], i) => {
      const y = L.groundHeight(x, z) < 0 ? -0.3 + 0.0 : L.groundHeight(x, z);
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y + 1.1, z); m.castShadow = true;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialGlowTexture('rgba(255,210,90,0.8)', 'rgba(255,160,40,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(1.8); m.add(glow);
      if (!got.has(i)) this.game.scene.add(m);
      this.tokens.push({ i, mesh: m, got: got.has(i) });
    });
  }
  get tokenCount() { return this.tokens.filter((t) => t.got).length; }
  updateTokens(dt) {
    const p = this.game.player;
    for (const t of this.tokens) {
      if (t.got) continue; t.mesh.rotation.y += dt * 2; t.mesh.position.y += Math.sin(this.game.time * 2 + t.i) * 0.003;
      if (p.distTo(t.mesh.position) < 1.5 && Math.abs(p.pos.y + 1 - t.mesh.position.y) < 2.5) {
        t.got = true; t.mesh.removeFromParent(); p.money += 150; this.game.audio.play('pickup');
        const n = this.tokenCount; this.game.hud.toast(`メリディアン・トークン ${n}/${this.tokens.length}　+$150`, 'good');
        if (n === this.tokens.length) { p.money += 2000; p.giveWeapon('smg', 120); this.game.hud.bigMessage('ALL TOKENS', '全トークン収集　$2,000 ＋ SMG', 'pass'); }
        try { localStorage.setItem('pm_tokens', JSON.stringify(this.tokens.filter((x) => x.got).map((x) => x.i))); } catch (e) { /* ignore */ }
      }
    }
  }
}

// ------------------------------------------------------------------
class DeliveryMission {
  constructor(mgr, game, def) { this.m = mgr; this.g = game; this.def = def; this.bonus = 0; }
  begin() {
    const g = this.g; const s = this.m.starts.delivery;
    // mission car parked at the curb next to the start
    const v = g.spawnVehicle('SportsCar', s.x + 4.2 - 0.9, s.z + 8, Math.PI, { paint: '#2ec4b6' });
    v.place(L.roadX(2) + L.PARK_OFF, s.z + 8, Math.PI); v.missionCar = true; this.car = v;
    this.m.ents.push({ isVehicleRef: true, v });
    this.m.setObjective('配達用の<b class="c-teal">ボルト GT</b> に乗れ');
    this.m.setTarget(v.pos.clone().setY(0), 2.6, '#2ec4b6', 3);
    this.stage = 0;
  }
  update(dt) {
    const g = this.g, p = g.player, v = this.car;
    if (v.dead) return this.m.fail('配達車が大破した');
    if (this.stage === 0) {
      this.m.markers[0] && this.m.markers[0].group.position.copy(v.pos);
      this.m.target.copy(v.pos);
      if (p.inVehicle === v) {
        this.stage = 1; const drop = g.city.data.marketDrop;
        this.m.setTarget(new THREE.Vector3(drop.x, 0, drop.z), 3.4, '#ffd166', 5);
        this.m.timer = 80; this.m.setObjective('<b class="c-gold">ハーバー・マーケット</b> へ荷物を届けろ（制限時間内）');
        g.hud.toast('GPS ルートをミニマップに表示中', 'info');
      }
    } else if (this.stage === 1) {
      if (p.inVehicle !== v) { this.m.setObjective('<b class="c-teal">ボルト GT</b> に戻れ'); this.away = (this.away || 0) + dt; if (this.away > 30) return this.m.fail('配達車を放置した'); return; }
      this.away = 0; this.m.setObjective('<b class="c-gold">ハーバー・マーケット</b> へ荷物を届けろ（制限時間内）');
      const d = Math.hypot(v.pos.x - this.m.target.x, v.pos.z - this.m.target.z);
      if (d < 4.2) {
        g.hud.prompt('停車して荷物を降ろせ');
        if (v.speed < 2.5) { this.bonus = Math.round(this.m.timer * 8) + Math.round((v.health / 1000) * 200); this.m.timer = null; this.m.pass(`残り時間ボーナス込み`); }
      }
    }
  }
  end() { if (this.car) this.car.missionCar = false; }
}

class DockMission {
  constructor(mgr, game, def) { this.m = mgr; this.g = game; this.def = def; this.bonus = 0; this.enemies = []; }
  begin() {
    const g = this.g, d = g.city.data;
    g.player.armor = Math.max(g.player.armor, 50);
    if (!g.player.weapons.pistol) g.player.giveWeapon('pistol', 48); else g.player.weapons.pistol.reserve += 48;
    g.player.equip('pistol');
    g.hud.toast('防弾ベスト＋弾薬を受け取った', 'good');
    g.wanted.suppressed = true;
    // first wave guards inside the yard
    const spots = [[-14, 14], [10, 12], [-4, 26], [18, 28], [-20, 36], [4, 40]];
    for (const [ox, oz] of spots) this.spawnGang(d.yard.cx + ox, d.yard.rect.z0 + oz, 'guard');
    this.total = spots.length + 3; this.killed = 0; this.wave = 1;
    this.m.setObjective(`ソルトライン・クルーを倒せ　<b class="c-coral">0 / ${this.total}</b>`);
    this.m.target = new THREE.Vector3(d.yard.cx, 0, d.yard.cz);
  }
  spawnGang(x, z, state) {
    const e = this.g.spawnGang(x, z, Math.random() < 0.5 ? 'smg' : 'pistol');
    e.ai.state = state; e.ai.guardYaw = Math.PI + (Math.random() - 0.5);
    e.missionEnemy = true; this.enemies.push(e); return e;
  }
  event(type, data) {
    if (type === 'death' && data.missionEnemy && this.enemies.includes(data)) {
      this.killed++;
      this.m.setObjective(`ソルトライン・クルーを倒せ　<b class="c-coral">${this.killed} / ${this.total}</b>`);
      if (this.killed === 4 && this.wave === 1) {
        this.wave = 2; const d = this.g.city.data;
        for (const [ox, oz] of [[22, 52], [-22, 52], [0, 54]]) { const e = this.spawnGang(d.yard.cx + ox, d.yard.rect.z0 + oz, 'combat'); e.ai.alert(this.g.player.pos); }
        this.g.hud.toast('増援が来た！ 南側に注意', 'wanted');
      }
      if (this.killed >= this.total) {
        const d = this.g.city.data; const pos = new THREE.Vector3(d.yard.cx + 2, L.CURB_H, d.yard.cz + 4);
        this.case = this.g.spawnPickup('case', pos);
        this.m.setTarget(pos, 1.2, '#ffd166', 3);
        this.m.setObjective('奪われた<b class="c-gold">ケース</b>を回収しろ');
      }
    }
  }
  update(dt) {
    const g = this.g;
    // alert others once fighting starts
    if (this.enemies.some((e) => e.alive && e.ai.state === 'combat')) for (const e of this.enemies) if (e.alive && e.ai.state === 'guard' && e.distTo(g.player.pos) < 45) e.ai.alert(g.player.pos);
    if (this.case && this.case.taken) {
      g.player.giveWeapon('smg', 90); g.hud.toast('VX-30 SMG を入手（2キーで切替）', 'good');
      this.m.pass();
    }
  }
  end() { this.g.wanted.suppressed = false; if (this.case && !this.case.taken) this.case.remove(); }
}

class HeistMission {
  constructor(mgr, game, def) { this.m = mgr; this.g = game; this.def = def; this.bonus = 0; }
  begin() {
    const g = this.g, d = g.city.data;
    const v = g.spawnVehicle('SportsCar2', 0, 0, 0, { paint: '#d4a017' });
    v.place(d.showroomLot.x, d.showroomLot.z - 4, Math.PI / 2); v.missionCar = true; this.car = v; v.paintMat.metalness = 0.9; v.paintMat.roughness = 0.2;
    this.m.ents.push({ isVehicleRef: true, v });
    this.stage = 0;
    this.m.setObjective('展示車 <b class="c-gold">ストラーダRS ゴールド</b> を盗め');
    this.m.setTarget(v.pos.clone().setY(0), 2.6, '#ffd166', 3);
  }
  update(dt) {
    const g = this.g, p = g.player, v = this.car;
    if (v.dead) return this.m.fail('ゴールドが大破した');
    if (this.stage === 0) {
      this.m.markers[0] && this.m.markers[0].group.position.copy(v.pos); this.m.target.copy(v.pos);
      if (p.inVehicle === v) { this.stage = 1; g.wanted.report('heist', v.pos, { witnessed: true }); this.m.setTarget(null); this.m.setObjective('<b class="c-coral">警察を振り切れ</b>（手配度をゼロにする）'); g.hud.toast('盗難警報が鳴った！', 'wanted'); }
      return;
    }
    if (p.inVehicle !== v) { this.away = (this.away || 0) + dt; this.m.setObjective(`<b class="c-gold">ゴールド</b> に戻れ　${Math.ceil(40 - this.away)}`); if (this.away > 40) return this.m.fail('ゴールドを放棄した'); return; }
    this.away = 0;
    if (this.stage === 1) {
      this.m.setObjective(`<b class="c-coral">警察を振り切れ</b>（手配度をゼロにする）`);
      if (g.wanted.level === 0) {
        this.stage = 2; const gd = g.city.data.garageDoor;
        this.m.setTarget(new THREE.Vector3(gd.x, L.CURB_H, gd.z), 3.2, '#ffd166', 5);
        this.m.setObjective('<b class="c-gold">ウェストサイドのセーフハウス</b> へ車を運べ');
      }
    } else if (this.stage === 2) {
      if (g.wanted.level > 0) { this.stage = 1; this.m.setTarget(null); return; }
      const d = Math.hypot(v.pos.x - this.m.target.x, v.pos.z - this.m.target.z);
      if (d < 4) { g.hud.prompt('停車しろ'); if (v.speed < 2) { this.bonus = Math.round((v.health / 1000) * 800); this.m.pass('車両状態ボーナス込み'); } }
    }
  }
  end() { if (this.car) this.car.missionCar = false; }
}
