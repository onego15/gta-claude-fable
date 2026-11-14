// DOM heads-up display: minimap, health, wanted stars, weapon, objectives, notifications.
import * as L from '../world/layout.js';
import { fmtMoney, clamp } from '../core/utils.js';

const MAP_SCALE = 2; // px per meter in the static map
const MAP_X0 = L.CITY_MIN_X - 60, MAP_Z0 = L.CITY_MIN_Z - 60, MAP_W = (L.CITY_MAX_X - L.CITY_MIN_X) + 120, MAP_H = (L.QUAY_Z - L.CITY_MIN_Z) + 120;

export class HUD {
  constructor(game) {
    this.game = game;
    const root = this.root = document.createElement('div'); root.id = 'hud'; root.className = 'hidden';
    root.innerHTML = `
      <div class="hud-tr">
        <div class="clock" id="h-clock">18:00</div>
        <div class="money" id="h-money">$0</div>
        <div class="stars" id="h-stars">${'<span class="star">★</span>'.repeat(5)}</div>
        <div class="weapon" id="h-weapon"><div class="wname" id="h-wname">素手</div><div class="ammo" id="h-ammo"></div><div class="reload" id="h-reload"></div></div>
      </div>
      <div class="hud-bl">
        <div class="minimap"><canvas id="h-map" width="440" height="440"></canvas><div class="north">N</div></div>
        <div class="bars"><div class="bar hp"><i id="h-hp"></i></div><div class="bar ar"><i id="h-ar"></i></div></div>
        <div class="district" id="h-district"></div>
      </div>
      <div class="hud-tl"><div id="h-toasts"></div></div>
      <div class="objective" id="h-obj"></div>
      <div class="timer" id="h-timer"></div>
      <div class="prompt" id="h-prompt"></div>
      <div class="crosshair" id="h-cross"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="hitmarker" id="h-hit"></div>
      <div class="dmg" id="h-dmg"></div>
      <div class="hud-br">
        <div class="vehicle" id="h-veh"><div class="vname" id="h-vname"></div><div class="speed"><span id="h-speed">0</span><small>km/h</small></div><div class="vhp"><i id="h-vhp"></i></div></div>
        <div class="radio" id="h-radio"></div>
      </div>
      <div class="banner" id="h-banner"><small id="h-banner-sub"></small><div id="h-banner-title"></div></div>
      <div class="big" id="h-big"><div class="big-title" id="h-big-title"></div><div class="big-sub" id="h-big-sub"></div></div>
      <div class="heat" id="h-heat"><div class="heat-label">HEAT COOLING</div><div class="heat-bar"><i id="h-heat-bar"></i></div></div>
      <div class="arrest" id="h-arrest"><div>確保されそうだ！ 動け！</div><div class="heat-bar"><i id="h-arrest-bar"></i></div></div>
    `;
    document.body.appendChild(root);
    this.$ = (id) => root.querySelector('#' + id);
    this.map = this.$('h-map'); this.mctx = this.map.getContext('2d');
    this.staticMap = this.buildStaticMap();
    this.toasts = []; this.promptText = ''; this.promptT = 0; this.bigT = 0; this.bannerT = 0; this.hitT = 0; this.dmgDirs = [];
    this.lastDistrict = ''; this.districtT = 0; this.arrestMeter = 0;
  }
  show(v) { this.root.classList.toggle('hidden', !v); }
  buildStaticMap() {
    const c = document.createElement('canvas'); c.width = MAP_W * MAP_SCALE; c.height = MAP_H * MAP_SCALE; const x = c.getContext('2d');
    const P = (wx, wz) => [(wx - MAP_X0) * MAP_SCALE, (wz - MAP_Z0) * MAP_SCALE];
    x.fillStyle = '#20303b'; x.fillRect(0, 0, c.width, c.height);
    // water
    const [, qz] = P(0, L.QUAY_Z); x.fillStyle = '#163f57'; x.fillRect(0, qz, c.width, c.height - qz);
    // land
    x.fillStyle = '#3a4650'; x.fillRect(0, 0, c.width, qz);
    // blocks
    for (let bx = 0; bx < L.BLOCKS_X; bx++) for (let bz = 0; bz < L.BLOCKS_Z; bz++) {
      const t = L.blockType(bx, bz); const [x0, z0] = P(L.roadX(bx) + L.ROAD_HALF, L.roadZ(bz) + L.ROAD_HALF); const [x1, z1] = P(L.roadX(bx + 1) - L.ROAD_HALF, L.roadZ(bz + 1) - L.ROAD_HALF);
      x.fillStyle = t === 'park' ? '#3f6b3a' : t === 'containers' ? '#5b5246' : t === 'harbor' || t === 'market' ? '#55524c' : '#4d5a64'; x.fillRect(x0, z0, x1 - x0, z1 - z0);
    }
    for (const b of this.game.city.data.buildings) { const [x0, z0] = P(b.x0, b.z0); const [x1, z1] = P(b.x1, b.z1); x.fillStyle = b.h > 30 ? '#65737e' : '#5b6873'; x.fillRect(x0, z0, x1 - x0, z1 - z0); }
    // roads
    x.fillStyle = '#c9ced3';
    for (let i = 0; i < L.ROADS_X; i++) { const [a, b] = P(L.roadX(i) - L.ROAD_HALF, L.CITY_MIN_Z - L.ROAD_HALF); const [, d] = P(0, L.CITY_MAX_Z + L.ROAD_HALF); x.fillRect(a, b, L.ROAD_HALF * 2 * MAP_SCALE, d - b); }
    for (let j = 0; j < L.ROADS_Z; j++) { const [a, b] = P(L.CITY_MIN_X - L.ROAD_HALF, L.roadZ(j) - L.ROAD_HALF); const [cc] = P(L.CITY_MAX_X + L.ROAD_HALF, 0); x.fillRect(a, b, cc - a, L.ROAD_HALF * 2 * MAP_SCALE); }
    // promenade
    const [p0x, p0z] = P(L.CITY_MIN_X - 40, L.CITY_MAX_Z + L.ROAD_HALF); x.fillStyle = '#6d6a62'; x.fillRect(p0x, p0z, (MAP_W) * MAP_SCALE, (L.QUAY_Z - L.CITY_MAX_Z - L.ROAD_HALF) * MAP_SCALE);
    return c;
  }
  worldToMap(wx, wz) { return [(wx - MAP_X0) * MAP_SCALE, (wz - MAP_Z0) * MAP_SCALE]; }

  update(dt) {
    const g = this.game, p = g.player;
    this.$('h-clock').textContent = g.sky.timeString;
    const m = this.$('h-money'); const shown = this.moneyShown ?? p.money; this.moneyShown = shown + (p.money - shown) * Math.min(1, dt * 6);
    m.textContent = fmtMoney(Math.abs(p.money - this.moneyShown) < 1 ? p.money : this.moneyShown);
    // stars
    const W = g.wanted; const stars = this.$('h-stars').children;
    const blink = !W.seen && W.level > 0 ? (Math.floor(g.time * 3) % 2 === 0) : true;
    for (let i = 0; i < 5; i++) { stars[i].classList.toggle('on', i < W.level && (blink || W.seen)); stars[i].classList.toggle('dim', i < W.level && !blink); stars[i].classList.toggle('flash', W.flash > 0 && i < W.level); }
    this.$('h-stars').classList.toggle('active', W.level > 0);
    // heat cooling
    const heat = this.$('h-heat'); heat.classList.toggle('show', W.level > 0 && !W.seen);
    this.$('h-heat-bar').style.width = (W.cooldownProgress * 100) + '%';
    // arrest meter
    this.$('h-arrest').classList.toggle('show', this.arrestMeter > 0.05); this.$('h-arrest-bar').style.width = (this.arrestMeter * 100) + '%'; this.arrestMeter = Math.max(0, this.arrestMeter - dt * 2);
    // weapon
    const w = p.weapon;
    this.$('h-wname').textContent = w ? w.def.label : 'UNARMED';
    this.$('h-ammo').innerHTML = w ? `<b>${w.mag}</b><span>/ ${w.reserve}</span>` : '';
    this.$('h-reload').style.width = p.reloadT > 0 && w ? ((1 - p.reloadT / w.def.reload) * 100) + '%' : '0%';
    // bars
    this.$('h-hp').style.width = clamp(p.hp, 0, 100) + '%'; this.$('h-ar').style.width = clamp(p.armor, 0, 100) + '%';
    this.$('h-hp').parentElement.classList.toggle('low', p.hp < 30);
    // crosshair
    const cross = this.$('h-cross'); const showCross = !p.inVehicle && p.alive && (p.aiming || (p.weapon && g.input.fire));
    cross.classList.toggle('show', showCross && g.state === 'play');
    cross.classList.toggle('enemy', !!p.aimHitActor && p.aimHitActor.team !== 'civ');
    const spread = 6 + (p.spreadBloom * 300) + p.moveSpeed * 1.5;
    cross.style.setProperty('--s', spread + 'px');
    // vehicle
    const v = p.inVehicle; const vb = this.$('h-veh'); vb.classList.toggle('show', !!v);
    if (v) { this.$('h-vname').textContent = v.spec.label; this.$('h-speed').textContent = Math.round(Math.abs(v.forwardSpeed) * 3.6); this.$('h-vhp').style.width = (v.health / 10) + '%'; }
    // district
    const dname = L.districtAt(p.pos.x, p.pos.z);
    if (dname !== this.lastDistrict) { this.lastDistrict = dname; this.districtT = 4; this.$('h-district').textContent = dname; }
    this.districtT -= dt; this.$('h-district').classList.toggle('show', this.districtT > 0);
    // prompt
    this.promptT -= dt; this.$('h-prompt').classList.toggle('show', this.promptT > 0); if (this.promptT > 0) this.$('h-prompt').innerHTML = this.promptText;
    // mission timer
    const mt = g.missions.timer; const te = this.$('h-timer'); te.classList.toggle('show', mt !== null && !!g.missions.active);
    if (mt !== null) { te.textContent = `${Math.floor(mt / 60)}:${String(Math.floor(mt % 60)).padStart(2, '0')}`; te.classList.toggle('urgent', mt < 15); }
    // toasts
    for (const t of this.toasts) { t.t -= dt; if (t.t <= 0 && !t.gone) { t.gone = true; t.el.classList.add('out'); setTimeout(() => t.el.remove(), 400); } }
    this.toasts = this.toasts.filter((t) => !t.gone || t.el.isConnected);
    // big message
    if (this.bigT > 0) { this.bigT -= dt; if (this.bigT <= 0) this.$('h-big').classList.remove('show'); }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.$('h-banner').classList.remove('show'); }
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.$('h-hit').className = 'hitmarker'; }
    // damage direction
    const dmg = this.$('h-dmg'); this.dmgDirs = this.dmgDirs.filter((d) => (d.t -= dt) > 0);
    dmg.innerHTML = this.dmgDirs.map((d) => { const ang = this.relAngle(d.pos); return `<i style="transform:rotate(${ang}rad);opacity:${Math.min(1, d.t)}"></i>`; }).join('');
    this.drawMinimap();
  }
  relAngle(pos) {
    const g = this.game; const cam = g.camera; const p = g.player.pos;
    const yaw = Math.atan2(pos.x - p.x, pos.z - p.z); const cyaw = g.rig.yaw + Math.PI; return -(yaw - cyaw);
  }
  drawMinimap() {
    const g = this.game, x = this.mctx, c = this.map; const S = c.width; const p = g.player;
    const fp = g.focusPos();
    const range = p.inVehicle ? 120 : 75; // meters radius
    const k = (S / 2) / range; // px per meter on minimap
    x.save(); x.clearRect(0, 0, S, S);
    x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); x.clip();
    x.translate(S / 2, S / 2);
    const rot = g.rig.yaw; // rotate so camera forward is up
    x.rotate(rot);
    const [mx, mz] = this.worldToMap(fp.x, fp.z);
    x.scale(k / MAP_SCALE, k / MAP_SCALE);
    x.drawImage(this.staticMap, -mx, -mz);
    x.setTransform(1, 0, 0, 1, 0, 0); x.translate(S / 2, S / 2); x.rotate(rot);
    const W2M = (wx, wz) => [(wx - fp.x) * k, (wz - fp.z) * k];
    // GPS route
    const gps = g.missions.gps;
    if (gps && gps.length > 1) {
      x.strokeStyle = '#ffd166'; x.lineWidth = 7; x.lineJoin = 'round'; x.globalAlpha = 0.9; x.beginPath();
      gps.forEach((q, i) => { const [a, b] = W2M(q.x, q.z); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.stroke(); x.globalAlpha = 1;
    }
    // blips (kept upright by counter-rotating)
    const blip = (wx, wz, draw, clampEdge = false) => {
      let [a, b] = W2M(wx, wz); const r = Math.hypot(a, b); const maxR = S / 2 - 16;
      if (r > maxR) { if (!clampEdge) return; a *= maxR / r; b *= maxR / r; }
      x.save(); x.translate(a, b); x.rotate(-rot); draw(); x.restore();
    };
    const dot = (col, r = 7, ring = '#fff') => () => { x.fillStyle = col; x.beginPath(); x.arc(0, 0, r, 0, 7); x.fill(); x.lineWidth = 2.5; x.strokeStyle = ring; x.stroke(); };
    const letter = (col, l, dim) => () => { x.globalAlpha = dim ? 0.55 : 1; x.fillStyle = col; x.beginPath(); x.arc(0, 0, 15, 0, 7); x.fill(); x.lineWidth = 3; x.strokeStyle = '#fff'; x.stroke(); x.fillStyle = '#fff'; x.font = 'bold 21px "Bebas Neue", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(l, 0, 1); x.globalAlpha = 1; };
    const d = g.city.data;
    if (d.hospitalFront) blip(d.hospitalFront.x, d.hospitalFront.z, letter('#d64541', '+'));
    if (d.policeFront) blip(d.policeFront.x, d.policeFront.z, letter('#1f4e8c', 'P'));
    if (d.garageDoor) blip(d.garageDoor.x, d.garageDoor.z, letter('#e0812d', 'G'));
    for (const b of g.missions.blips) {
      if (b.kind === 'target') blip(b.x, b.z, () => { x.fillStyle = '#ffd166'; x.beginPath(); x.arc(0, 0, 11, 0, 7); x.fill(); x.strokeStyle = '#1b1b1b'; x.lineWidth = 3; x.stroke(); }, true);
      else blip(b.x, b.z, letter(b.color, b.letter, b.done), true);
    }
    const blinkOn = Math.floor(g.time * 4) % 2 === 0;
    for (const v of g.vehicles) if (v.police && v.sirenOn) blip(v.pos.x, v.pos.z, dot(blinkOn ? '#ff3b3b' : '#3b6bff', 8));
    for (const a of g.actors) {
      if (!a.alive || a === p) continue;
      if (a.team === 'police' && g.wanted.level > 0) blip(a.pos.x, a.pos.z, dot(blinkOn ? '#ff3b3b' : '#3b6bff', 5));
      else if (a.team === 'gang' && a.ai && a.ai.state !== 'guard' || a.missionEnemy) blip(a.pos.x, a.pos.z, dot('#ff4d4d', 6, '#300'));
    }
    if (g.missions.target && !g.missions.active?.case && g.missions.def?.id === 'dock') { /* yard blip already via target */ }
    // player arrow
    x.rotate(-rot);
    const heading = p.inVehicle ? p.inVehicle.heading : p.heading;
    x.rotate(rot - heading + Math.PI);
    x.fillStyle = '#ffffff'; x.strokeStyle = '#0d1b2a'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(0, -15); x.lineTo(11, 12); x.lineTo(0, 6); x.lineTo(-11, 12); x.closePath(); x.fill(); x.stroke();
    x.restore();
    // wanted ring tint
    c.parentElement.classList.toggle('wanted', g.wanted.level > 0);
    c.parentElement.style.setProperty('--wanted-color', blinkOn ? 'rgba(255,59,59,0.85)' : 'rgba(59,107,255,0.85)');
    this.root.querySelector('.north').style.transform = `rotate(${rot}rad) translateY(-118px) rotate(${-rot}rad)`;
  }
  // ---- api ----
  toast(text, kind = 'info', dur = 4) {
    const el = document.createElement('div'); el.className = 'toast ' + kind; el.innerHTML = text; this.$('h-toasts').appendChild(el);
    this.toasts.push({ el, t: dur });
    while (this.toasts.length > 4) { const t = this.toasts.shift(); t.el.remove(); }
  }
  prompt(text) { this.promptText = text; this.promptT = 0.15; }
  objective(html) { const o = this.$('h-obj'); o.innerHTML = html; o.classList.toggle('show', !!html); }
  bigMessage(title, sub, kind = 'pass', dur = 4.5) {
    const b = this.$('h-big'); b.className = 'big show ' + kind; this.$('h-big-title').textContent = title; this.$('h-big-sub').textContent = sub || ''; this.bigT = dur;
  }
  missionBanner(en, ja) { this.$('h-banner-title').textContent = en; this.$('h-banner-sub').textContent = ja; this.$('h-banner').classList.add('show'); this.bannerT = 3.5; }
  hitMarker(kill, head, metal) { const h = this.$('h-hit'); h.className = 'hitmarker show' + (kill ? ' kill' : '') + (head ? ' head' : '') + (metal ? ' metal' : ''); this.hitT = kill ? 0.35 : 0.15; this.game.audio.play(kill ? 'kill' : 'hit'); }
  damageFrom(pos) { this.dmgDirs.push({ pos: pos.clone(), t: 1.2 }); if (this.dmgDirs.length > 4) this.dmgDirs.shift(); }
  radio(name) { const r = this.$('h-radio'); r.textContent = '♪ ' + name; r.classList.add('show'); clearTimeout(this._rt); this._rt = setTimeout(() => r.classList.remove('show'), 2500); }
  // full map for pause menu
  drawFullMap(canvas) {
    const x = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
    const s = Math.min(W / this.staticMap.width, H / this.staticMap.height);
    x.fillStyle = '#163f57'; x.fillRect(0, 0, W, H);
    const ox = (W - this.staticMap.width * s) / 2, oy = (H - this.staticMap.height * s) / 2;
    x.drawImage(this.staticMap, ox, oy, this.staticMap.width * s, this.staticMap.height * s);
    const P = (wx, wz) => { const [a, b] = this.worldToMap(wx, wz); return [ox + a * s, oy + b * s]; };
    const g = this.game; const d = g.city.data;
    const icon = (wx, wz, col, l, label) => { const [a, b] = P(wx, wz); x.fillStyle = col; x.beginPath(); x.arc(a, b, 13, 0, 7); x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 2.5; x.stroke(); x.fillStyle = '#fff'; x.font = 'bold 18px "Bebas Neue"'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(l, a, b + 1); if (label) { x.font = '600 13px "Noto Sans JP", sans-serif'; x.fillStyle = '#fff'; x.strokeStyle = 'rgba(0,0,0,0.7)'; x.lineWidth = 4; x.strokeText(label, a, b + 24); x.fillText(label, a, b + 24); } };
    for (const def of g.missions.defs) { const st = g.missions.starts[def.id]; icon(st.x, st.z, def.color, def.letter, def.title + (g.missions.completed.has(def.id) ? ' ✓' : '')); }
    if (d.hospitalFront) icon(d.hospitalFront.x, d.hospitalFront.z, '#d64541', '+', '病院');
    if (d.policeFront) icon(d.policeFront.x, d.policeFront.z, '#1f4e8c', 'P', '警察署');
    if (d.garageDoor) icon(d.garageDoor.x, d.garageDoor.z, '#e0812d', 'G', 'セーフハウス');
    const p = g.focusPos(); const [a, b] = P(p.x, p.z); x.fillStyle = '#fff'; x.beginPath(); x.arc(a, b, 8, 0, 7); x.fill(); x.strokeStyle = '#0d1b2a'; x.lineWidth = 3; x.stroke();
    // district labels
    x.font = '700 15px "Noto Sans JP", sans-serif'; x.textAlign = 'center'; x.fillStyle = 'rgba(255,255,255,0.75)';
    const lab = (bx, bz, t) => { const [la, lb] = P(L.roadX(bx) + L.PITCH / 2, L.roadZ(bz) + L.PITCH / 2); x.fillText(t, la, lb); };
    lab(3, 0, 'ダウンタウン'); lab(0, 1, 'オールド・ヒル'); lab(3, 2, 'ミッドタウン'); lab(2, 2, 'メリディアン公園'); lab(2, 4, 'ハーバー地区');
    const [qa, qb] = P(0, L.QUAY_Z + 40); x.fillStyle = 'rgba(180,220,255,0.6)'; x.fillText('メリディアン湾', qa, qb);
  }
}
