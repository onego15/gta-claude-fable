// Title screen, pause menu (map / controls / settings), mission intro cards, loading screen.
const CONTROLS = [
  ['移動', 'W A S D'], ['ダッシュ', 'Shift'], ['ジャンプ', 'Space'], ['視点', 'マウス'], ['エイム / 射撃', '右クリック / 左クリック'], ['リロード', 'R'], ['武器切替', '1 / 2 / 3・ホイール'],
  ['車に乗る・降りる', 'F'], ['アクセル / ブレーキ・バック', 'W / S'], ['ハンドブレーキ', 'Space'], ['クラクション', 'H'], ['ラジオ切替（車内）', 'R'], ['ミッション開始', 'E'], ['マップ・ポーズ', 'Esc / M'],
];

export class Menus {
  constructor(game) {
    this.game = game;
    const el = this.el = document.createElement('div'); el.id = 'menus';
    el.innerHTML = `
      <div id="loading" class="screen show">
        <div class="logo"><span class="logo-port">PORT</span><span class="logo-mer">MERIDIAN</span></div>
        <div class="load-bar"><i id="load-fill"></i></div>
        <div class="load-text" id="load-text">街を準備しています…</div>
      </div>
      <div id="title" class="screen">
        <div class="title-inner">
          <div class="logo big"><span class="logo-port">PORT</span><span class="logo-mer">MERIDIAN</span></div>
          <div class="tagline">陽が沈む港町で、のし上がれ。</div>
          <button class="btn primary" id="btn-play">プレイ開始</button>
          <div class="title-row">
            <button class="btn" id="btn-controls">操作方法</button>
            <button class="btn" id="btn-settings">設定</button>
          </div>
          <div class="hint">クリックするとマウスがロックされます　・　Esc でポーズ</div>
        </div>
        <div class="credits">3D models: Quaternius (CC0) ・ Sounds: Kenney (CC0) ・ Engine: three.js</div>
      </div>
      <div id="pause" class="screen">
        <div class="pause-wrap">
          <div class="pause-side">
            <div class="logo small"><span class="logo-port">PORT</span><span class="logo-mer">MERIDIAN</span></div>
            <button class="btn primary" id="btn-resume">ゲームに戻る</button>
            <button class="btn tab" data-tab="map">マップ</button>
            <button class="btn tab" data-tab="missions">ミッション</button>
            <button class="btn tab" data-tab="controls">操作方法</button>
            <button class="btn tab" data-tab="settings">設定</button>
            <div class="stats" id="pause-stats"></div>
          </div>
          <div class="pause-main">
            <div class="tabpane" data-pane="map"><canvas id="fullmap" width="900" height="760"></canvas></div>
            <div class="tabpane" data-pane="missions" id="pane-missions"></div>
            <div class="tabpane" data-pane="controls"><div class="controls">${CONTROLS.map(([a, b]) => `<div class="ctl"><span>${a}</span><kbd>${b}</kbd></div>`).join('')}</div></div>
            <div class="tabpane" data-pane="settings">
              <div class="settings">
                <label>画質 <select id="set-quality"><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
                <label>マウス感度 <input type="range" id="set-sens" min="0.3" max="2.5" step="0.05" value="1"></label>
                <label>マスター音量 <input type="range" id="set-vol" min="0" max="1" step="0.05" value="0.8"></label>
                <label>音楽（ラジオ）音量 <input type="range" id="set-music" min="0" max="1" step="0.05" value="0.55"></label>
                <label>歩行者の数 <input type="range" id="set-peds" min="10" max="45" step="1" value="30"></label>
                <label>交通量 <input type="range" id="set-traffic" min="6" max="26" step="1" value="16"></label>
                <label>時間の流れ <select id="set-time"><option value="1">標準（1分＝1時間）</option><option value="0">止める</option><option value="4">速い</option></select></label>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="intro" class="screen">
        <div class="intro-card">
          <div class="intro-type" id="intro-type"></div>
          <div class="intro-en" id="intro-en"></div>
          <div class="intro-title" id="intro-title"></div>
          <div class="intro-desc" id="intro-desc"></div>
          <div class="intro-reward" id="intro-reward"></div>
          <div class="title-row"><button class="btn primary" id="btn-intro-go">開始</button><button class="btn" id="btn-intro-cancel">やめる</button></div>
        </div>
      </div>
      <div id="sub-panel" class="screen"><div class="panel"><div class="panel-body" id="sub-body"></div><button class="btn" id="btn-sub-close">閉じる</button></div></div>
      <div id="lockhint" class="lockhint">クリックして再開</div>
    `;
    document.body.appendChild(el);
    const $ = (s) => el.querySelector(s); this.$ = $;
    $('#btn-play').onclick = () => game.startPlay();
    $('#btn-resume').onclick = () => game.resume();
    $('#btn-controls').onclick = () => this.sub(`<h3>操作方法</h3><div class="controls">${CONTROLS.map(([a, b]) => `<div class="ctl"><span>${a}</span><kbd>${b}</kbd></div>`).join('')}</div>`);
    $('#btn-settings').onclick = () => { this.sub(''); $('#sub-body').appendChild($('[data-pane="settings"] .settings').cloneNode(true)); this.bindSettings($('#sub-body')); };
    $('#btn-sub-close').onclick = () => $('#sub-panel').classList.remove('show');
    el.querySelectorAll('.tab').forEach((b) => b.onclick = () => this.tab(b.dataset.tab));
    this.bindSettings(el.querySelector('[data-pane="settings"]'));
    $('#lockhint').onclick = () => game.resume();
  }
  bindSettings(root) {
    const g = this.game; const q = (s) => root.querySelector(s);
    const s = g.settings;
    q('#set-quality').value = s.quality; q('#set-sens').value = s.sens; q('#set-vol').value = s.vol; q('#set-music').value = s.music; q('#set-peds').value = s.peds; q('#set-traffic').value = s.traffic; q('#set-time').value = String(s.timeScale);
    q('#set-quality').onchange = (e) => g.applySettings({ quality: e.target.value });
    q('#set-sens').oninput = (e) => g.applySettings({ sens: +e.target.value });
    q('#set-vol').oninput = (e) => g.applySettings({ vol: +e.target.value });
    q('#set-music').oninput = (e) => g.applySettings({ music: +e.target.value });
    q('#set-peds').oninput = (e) => g.applySettings({ peds: +e.target.value });
    q('#set-traffic').oninput = (e) => g.applySettings({ traffic: +e.target.value });
    q('#set-time').onchange = (e) => g.applySettings({ timeScale: +e.target.value });
  }
  sub(html) { this.$('#sub-body').innerHTML = html; this.$('#sub-panel').classList.add('show'); }
  loading(p, text) { this.$('#load-fill').style.width = Math.round(p * 100) + '%'; if (text) this.$('#load-text').textContent = text; }
  showScreen(id, on = true) { this.$('#' + id).classList.toggle('show', on); }
  tab(name) {
    this.el.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    this.el.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('show', p.dataset.pane === name));
    if (name === 'map') this.game.hud.drawFullMap(this.$('#fullmap'));
    if (name === 'missions') {
      const m = this.game.missions;
      this.$('#pane-missions').innerHTML = `<div class="mlist">${m.defs.map((d) => `<div class="mitem ${m.completed.has(d.id) ? 'done' : ''}" style="--c:${d.color}"><div class="mletter">${d.letter}</div><div><div class="mt">${d.title} <small>${d.en}</small></div><div class="md">${d.desc}</div><div class="mr">種別：${d.type}　報酬：$${d.reward.toLocaleString()}　${m.completed.has(d.id) ? '<b>クリア済み</b>' : 'マップのアイコン地点で E キー'}</div></div></div>`).join('')}
        <div class="mitem token" style="--c:#ffb347"><div class="mletter">◎</div><div><div class="mt">メリディアン・トークン <small>COLLECTIBLES</small></div><div class="md">街のどこかに金色のトークンが隠されている。公園、桟橋、市場、展示場…。全部集めると特別報酬。</div><div class="mr">${m.tokenCount} / ${m.tokens.length} 収集済み</div></div></div></div>`;
    }
  }
  openPause() {
    const g = this.game; this.showScreen('pause', true); this.tab('map');
    const p = g.player; this.$('#pause-stats').innerHTML = `所持金 <b>$${Math.round(p.money).toLocaleString()}</b><br>ミッション <b>${g.missions.completed.size}/${g.missions.defs.length}</b><br>トークン <b>${g.missions.tokenCount}/${g.missions.tokens.length}</b><br>時刻 <b>${g.sky.timeString}</b>`;
  }
  missionIntro(def, onGo) {
    const g = this.game; g.pause(true);
    this.$('#intro-type').textContent = `MISSION ・ ${def.type}`; this.$('#intro-en').textContent = def.en; this.$('#intro-title').textContent = def.title;
    this.$('#intro-desc').textContent = def.desc; this.$('#intro-reward').textContent = `報酬 $${def.reward.toLocaleString()}`;
    this.el.querySelector('.intro-card').style.setProperty('--c', def.color);
    this.showScreen('intro', true);
    this.$('#btn-intro-go').onclick = () => { this.showScreen('intro', false); g.resume(); onGo(); };
    this.$('#btn-intro-cancel').onclick = () => { this.showScreen('intro', false); g.resume(); };
  }
}
