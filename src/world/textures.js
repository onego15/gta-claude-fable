// Procedurally painted textures (canvas). Everything is generated at load time, so the city
// needs no texture downloads and every surface shares one consistent, slightly painterly look.
import * as THREE from 'three';
import { rng } from '../core/utils.js';

let maxAniso = 8;
export function setMaxAnisotropy(a) { maxAniso = a; }

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, { repeat = true, srgb = true, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  return t;
}
function noise(ctx, w, h, amount, r, alpha = 1) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n; d[i + 3] = d[i + 3] * alpha;
  }
  ctx.putImageData(img, 0, 0);
}
function blotches(ctx, w, h, r, count, color, rmin, rmax, a0, a1) {
  for (let i = 0; i < count; i++) {
    const x = r() * w, y = r() * h, rad = rmin + r() * (rmax - rmin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, color.replace('A', (a0 + r() * (a1 - a0)).toFixed(3))); g.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = g;
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { ctx.save(); ctx.translate(ox, oy); ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); ctx.restore(); }
  }
}

export function asphaltTexture() {
  const r = rng(11); const S = 512; const [c, x] = canvas(S, S);
  x.fillStyle = '#4a4b4f'; x.fillRect(0, 0, S, S);
  blotches(x, S, S, r, 40, 'rgba(30,30,34,A)', 20, 90, 0.05, 0.18);
  blotches(x, S, S, r, 25, 'rgba(110,108,104,A)', 15, 60, 0.04, 0.1);
  // aggregate speckles
  for (let i = 0; i < 9000; i++) { const v = 60 + r() * 90; x.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + r() * 0.4})`; x.fillRect(r() * S, r() * S, 1 + r() * 1.5, 1 + r() * 1.5); }
  // cracks
  x.strokeStyle = 'rgba(20,20,22,0.35)'; x.lineWidth = 1;
  for (let i = 0; i < 7; i++) { let px = r() * S, py = r() * S; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 8; k++) { px += (r() - 0.5) * 40; py += (r() - 0.5) * 40; x.lineTo(px, py); } x.stroke(); }
  noise(x, S, S, 14, r);
  return tex(c);
}

export function pavementTexture() {
  const r = rng(12); const S = 512; const [c, x] = canvas(S, S);
  x.fillStyle = '#a9a39a'; x.fillRect(0, 0, S, S);
  const n = 8, s = S / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = 160 + r() * 22; x.fillStyle = `rgb(${v},${v - 4},${v - 10})`; x.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
  }
  blotches(x, S, S, r, 30, 'rgba(70,64,58,A)', 8, 40, 0.05, 0.14);
  x.strokeStyle = 'rgba(80,76,70,0.8)'; x.lineWidth = 3;
  for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s, S); x.stroke(); x.beginPath(); x.moveTo(0, i * s); x.lineTo(S, i * s); x.stroke(); }
  noise(x, S, S, 16, r);
  return tex(c);
}

export function concreteTexture(base = '#9c9890', seed = 13) {
  const r = rng(seed); const S = 256; const [c, x] = canvas(S, S);
  x.fillStyle = base; x.fillRect(0, 0, S, S);
  blotches(x, S, S, r, 30, 'rgba(60,58,54,A)', 10, 50, 0.04, 0.12);
  noise(x, S, S, 18, r);
  return tex(c);
}

export function grassTexture() {
  const r = rng(14); const S = 512; const [c, x] = canvas(S, S);
  x.fillStyle = '#4f7a35'; x.fillRect(0, 0, S, S);
  blotches(x, S, S, r, 50, 'rgba(110,150,60,A)', 20, 80, 0.1, 0.3);
  blotches(x, S, S, r, 40, 'rgba(40,70,25,A)', 20, 70, 0.1, 0.3);
  for (let i = 0; i < 14000; i++) {
    const g = 90 + r() * 90; x.strokeStyle = `rgba(${g * 0.55},${g},${g * 0.35},0.5)`; x.lineWidth = 1;
    const px = r() * S, py = r() * S; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 3, py - 2 - r() * 4); x.stroke();
  }
  return tex(c);
}

// --- Building facades --------------------------------------------------------
// Each facade texture covers 8 bays x 8 floors. Bay = 3.2m, floor = 3.4m.
export const BAY_W = 3.2, FLOOR_H = 3.4, FACADE_BAYS = 8, FACADE_FLOORS = 8;

export function facadeTextures(style, seed) {
  const r = rng(seed); const W = 1024, H = 1024; const bw = W / FACADE_BAYS, fh = H / FACADE_FLOORS;
  const [c, x] = canvas(W, H); const [ce, xe] = canvas(W, H);
  xe.fillStyle = '#000'; xe.fillRect(0, 0, W, H);
  const litColors = ['#ffd9a0', '#ffe7c2', '#fff1d8', '#cfe6ff', '#ffc98a'];
  const lit = () => r() < 0.34;

  if (style === 'glass') {
    x.fillStyle = '#c8ccd0'; x.fillRect(0, 0, W, H);
    for (let f = 0; f < FACADE_FLOORS; f++) {
      // spandrel
      x.fillStyle = '#3c4650'; x.fillRect(0, f * fh + fh * 0.84, W, fh * 0.16);
      for (let b = 0; b < FACADE_BAYS; b++) {
        const gx = b * bw + 3, gy = f * fh + 3, gw = bw - 6, gh = fh * 0.84 - 4;
        const g = x.createLinearGradient(gx, gy, gx + gw * 0.6, gy + gh);
        const tone = r() * 20;
        g.addColorStop(0, `rgb(${120 + tone},${160 + tone},${185 + tone})`); g.addColorStop(0.5, `rgb(${40 + tone},${66 + tone},${88 + tone})`); g.addColorStop(1, `rgb(${70 + tone},${100 + tone},${125 + tone})`);
        x.fillStyle = g; x.fillRect(gx, gy, gw, gh);
        // blinds
        if (r() < 0.3) { x.fillStyle = 'rgba(220,220,210,0.35)'; x.fillRect(gx, gy, gw, gh * (0.2 + r() * 0.5)); }
        if (lit()) { xe.fillStyle = litColors[Math.floor(r() * litColors.length)]; xe.globalAlpha = 0.5 + r() * 0.5; xe.fillRect(gx, gy, gw, gh); xe.globalAlpha = 1; }
      }
      // mullions
      x.fillStyle = '#9aa3aa'; for (let b = 0; b <= FACADE_BAYS; b++) x.fillRect(b * bw - 3, f * fh, 6, fh);
    }
  } else if (style === 'brick') {
    x.fillStyle = '#9a5b45'; x.fillRect(0, 0, W, H);
    const bh = 9, bwk = 26;
    for (let y = 0; y < H; y += bh) for (let xx = ((y / bh) % 2) * (bwk / 2) - bwk; xx < W; xx += bwk) {
      const v = r() * 30 - 15; x.fillStyle = `rgb(${150 + v},${82 + v * 0.6},${62 + v * 0.5})`; x.fillRect(xx + 1, y + 1, bwk - 2, bh - 2);
    }
    for (let f = 0; f < FACADE_FLOORS; f++) for (let b = 0; b < FACADE_BAYS; b++) {
      const gx = b * bw + bw * 0.22, gy = f * fh + fh * 0.18, gw = bw * 0.56, gh = fh * 0.6;
      x.fillStyle = '#e9e1d2'; x.fillRect(gx - 6, gy - 6, gw + 12, gh + 12);  // frame
      x.fillStyle = '#d8cfbf'; x.fillRect(gx - 10, gy + gh + 4, gw + 20, 10);   // sill
      x.fillStyle = '#c9b9a0'; x.fillRect(gx - 8, gy - 16, gw + 16, 10);        // lintel
      const g = x.createLinearGradient(gx, gy, gx, gy + gh); g.addColorStop(0, '#3d4a55'); g.addColorStop(1, '#1d242b');
      x.fillStyle = g; x.fillRect(gx, gy, gw, gh);
      const curtain = r();
      if (curtain < 0.5) { x.fillStyle = ['#d9c7a8', '#b9c9c0', '#e0d6c8', '#c98f7a'][Math.floor(r() * 4)]; x.fillRect(gx, gy, gw * 0.3, gh); x.fillRect(gx + gw * 0.7, gy, gw * 0.3, gh); }
      x.fillStyle = '#e9e1d2'; x.fillRect(gx + gw / 2 - 3, gy, 6, gh); x.fillRect(gx, gy + gh * 0.45, gw, 5);
      if (lit()) { xe.fillStyle = litColors[Math.floor(r() * litColors.length)]; xe.globalAlpha = 0.6 + r() * 0.4; xe.fillRect(gx, gy, gw, gh); xe.globalAlpha = 1; }
    }
    // belt courses
    x.fillStyle = 'rgba(220,205,185,0.9)'; for (let f = 0; f < FACADE_FLOORS; f++) x.fillRect(0, f * fh, W, 5);
  } else if (style === 'stucco') {
    x.fillStyle = '#f2ece2'; x.fillRect(0, 0, W, H);
    blotches(x, W, H, r, 60, 'rgba(150,140,125,A)', 20, 90, 0.04, 0.12);
    for (let f = 0; f < FACADE_FLOORS; f++) for (let b = 0; b < FACADE_BAYS; b++) {
      const gx = b * bw + bw * 0.25, gy = f * fh + fh * 0.16, gw = bw * 0.5, gh = fh * 0.64;
      // shutters
      x.fillStyle = 'rgba(40,110,120,0.85)'; if ((b + f) % 3 !== 0) { x.fillRect(gx - gw * 0.32, gy, gw * 0.3, gh); x.fillRect(gx + gw + 2, gy, gw * 0.3, gh); }
      x.fillStyle = '#fbf8f2'; x.fillRect(gx - 5, gy - 5, gw + 10, gh + 10);
      const g = x.createLinearGradient(gx, gy, gx + gw, gy + gh); g.addColorStop(0, '#52677a'); g.addColorStop(1, '#202a33');
      x.fillStyle = g; x.fillRect(gx, gy, gw, gh);
      if (r() < 0.4) { x.fillStyle = '#efe4cf'; x.fillRect(gx, gy, gw, gh * 0.35); }
      x.fillStyle = '#fbf8f2'; x.fillRect(gx + gw / 2 - 2, gy, 4, gh);
      // balcony rail on some
      if (f % 2 === 1 && b % 2 === 0) { x.fillStyle = 'rgba(40,40,40,0.9)'; x.fillRect(gx - 14, gy + gh - 20, gw + 28, 4); for (let k = 0; k < 9; k++) x.fillRect(gx - 14 + k * (gw + 28) / 8, gy + gh - 20, 3, 26); }
      if (lit()) { xe.fillStyle = litColors[Math.floor(r() * litColors.length)]; xe.globalAlpha = 0.6 + r() * 0.4; xe.fillRect(gx, gy, gw, gh); xe.globalAlpha = 1; }
    }
    x.fillStyle = 'rgba(200,190,175,0.7)'; for (let f = 0; f < FACADE_FLOORS; f++) x.fillRect(0, f * fh, W, 4);
  } else if (style === 'office') {
    x.fillStyle = '#d6d0c4'; x.fillRect(0, 0, W, H);
    blotches(x, W, H, r, 40, 'rgba(120,115,105,A)', 20, 80, 0.04, 0.1);
    for (let f = 0; f < FACADE_FLOORS; f++) {
      const gy = f * fh + fh * 0.3, gh = fh * 0.5;
      const g = x.createLinearGradient(0, gy, 0, gy + gh); g.addColorStop(0, '#6d8798'); g.addColorStop(1, '#27343e');
      x.fillStyle = g; x.fillRect(0, gy, W, gh);
      x.fillStyle = '#b8b2a6'; for (let b = 0; b <= FACADE_BAYS * 2; b++) x.fillRect(b * bw / 2 - 2, gy, 4, gh);
      x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(0, gy + gh - 3, W, 3);
      for (let b = 0; b < FACADE_BAYS; b++) if (lit()) { xe.fillStyle = litColors[Math.floor(r() * litColors.length)]; xe.globalAlpha = 0.5 + r() * 0.5; xe.fillRect(b * bw + 2, gy, bw - 4, gh); xe.globalAlpha = 1; }
    }
  } else if (style === 'warehouse') {
    x.fillStyle = '#7d8a8c'; x.fillRect(0, 0, W, H);
    for (let xx = 0; xx < W; xx += 16) { const g = x.createLinearGradient(xx, 0, xx + 16, 0); g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(0.5, 'rgba(0,0,0,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0.12)'); x.fillStyle = g; x.fillRect(xx, 0, 16, H); }
    blotches(x, W, H, r, 40, 'rgba(120,70,40,A)', 10, 60, 0.05, 0.2);
    for (let f = 0; f < FACADE_FLOORS; f += 2) for (let b = 0; b < FACADE_BAYS; b += 2) {
      const gx = b * bw + bw * 0.3, gy = f * fh + fh * 0.25, gw = bw * 1.4, gh = fh * 0.4;
      x.fillStyle = '#2f3a3f'; x.fillRect(gx, gy, gw, gh); x.fillStyle = '#9fb0b3'; for (let k = 1; k < 4; k++) x.fillRect(gx + k * gw / 4, gy, 3, gh);
      if (r() < 0.25) { xe.fillStyle = '#ffd59a'; xe.globalAlpha = 0.6; xe.fillRect(gx, gy, gw, gh); xe.globalAlpha = 1; }
    }
  }
  noise(x, W, H, 10, r);
  return { map: tex(c), emissive: tex(ce) };
}

// --- Storefronts -------------------------------------------------------------
export const SHOPS = [
  { name: 'KOBO RAMEN', sub: '麺処 工房', bg: '#b3261e', fg: '#fff4e0', glow: '#ffb070', interior: '#f5c27a' },
  { name: 'CAFE SOLEIL', sub: 'coffee & bakery', bg: '#2a5d4f', fg: '#f7ecd2', glow: '#ffd58a', interior: '#f0d29a' },
  { name: '24/7 MART', sub: 'always open', bg: '#f2f2f2', fg: '#1d6fb8', glow: '#bfe4ff', interior: '#e8f4ff', stripe: '#e8432f' },
  { name: 'BLUE FIN', sub: 'sushi bar', bg: '#173f6b', fg: '#ffffff', glow: '#7fd0ff', interior: '#ffe2b8' },
  { name: 'HARBOR BOOKS', sub: 'used & rare', bg: '#5a3d2b', fg: '#f3dfb5', glow: '#ffcf86', interior: '#e7c18a' },
  { name: 'LUCKY WASH', sub: 'coin laundry', bg: '#ffd23f', fg: '#242424', glow: '#fff3a6', interior: '#ffffff' },
  { name: 'PAWN & GOLD', sub: 'buy · sell · loan', bg: '#111111', fg: '#e8c25a', glow: '#ffd76a', interior: '#d9b36b' },
  { name: 'IRON GYM', sub: 'open 6am', bg: '#2b2b2f', fg: '#ff5a3c', glow: '#ff7a50', interior: '#cfd8e0' },
  { name: 'NOVA PHARMACY', sub: 'drugstore', bg: '#e9f5ee', fg: '#119a4a', glow: '#9dffbf', interior: '#ffffff', stripe: '#119a4a' },
  { name: 'ROXY', sub: 'cinema · since 1958', bg: '#7a1230', fg: '#ffd9e6', glow: '#ff6fa0', interior: '#ffcf8a' },
  { name: 'TACO LOCO', sub: 'tacos · burritos', bg: '#ff8c1a', fg: '#2a1400', glow: '#ffbe6a', interior: '#ffd7a0' },
  { name: 'MERIDIAN DELI', sub: 'sandwiches', bg: '#1f3b2c', fg: '#e9d9a6', glow: '#ffe2a0', interior: '#f1d6a8' },
  { name: 'NEON NOODLE', sub: 'late night', bg: '#151030', fg: '#ff4fd8', glow: '#ff4fd8', interior: '#ffb7f0' },
  { name: 'FLORA', sub: 'flowers & plants', bg: '#f4e6e8', fg: '#b2405a', glow: '#ffc0cf', interior: '#ffe6ea' },
  { name: 'VINYL VAULT', sub: 'records', bg: '#202020', fg: '#3cd6c8', glow: '#3cd6c8', interior: '#ffd08a' },
  { name: 'APTS 221', sub: 'residents only', bg: '#3b3f46', fg: '#d8dbe0', glow: '#ffe0b0', interior: '#d8b98e', lobby: true },
];
export const SHOP_COLS = 4, SHOP_ROWS = 4;

export function storefrontAtlas() {
  const r = rng(77); const CW = 512, CH = 256; const W = CW * SHOP_COLS, H = CH * SHOP_ROWS;
  const [c, x] = canvas(W, H); const [ce, xe] = canvas(W, H);
  xe.fillStyle = '#000'; xe.fillRect(0, 0, W, H);
  SHOPS.forEach((s, i) => {
    const ox = (i % SHOP_COLS) * CW, oy = Math.floor(i / SHOP_COLS) * CH;
    // wall
    x.fillStyle = '#3a3634'; x.fillRect(ox, oy, CW, CH);
    // sign band
    const signH = CH * 0.26;
    x.fillStyle = s.bg; x.fillRect(ox, oy, CW, signH);
    if (s.stripe) { x.fillStyle = s.stripe; x.fillRect(ox, oy + signH - 10, CW, 10); }
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(ox, oy + signH, CW, 4);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `bold ${s.name.length > 11 ? 38 : 46}px "Bebas Neue", Impact, sans-serif`;
    x.fillStyle = s.fg; x.fillText(s.name, ox + CW / 2, oy + signH * 0.42);
    x.font = '600 17px "Rajdhani", sans-serif'; x.globalAlpha = 0.85; x.fillText(s.sub, ox + CW / 2, oy + signH * 0.82); x.globalAlpha = 1;
    // emissive sign
    xe.fillStyle = s.glow; xe.textAlign = 'center'; xe.textBaseline = 'middle';
    xe.font = x.font = `bold ${s.name.length > 11 ? 38 : 46}px "Bebas Neue", Impact, sans-serif`;
    xe.globalAlpha = 1; xe.fillText(s.name, ox + CW / 2, oy + signH * 0.42);
    xe.globalAlpha = 0.25; xe.fillStyle = s.bg; xe.fillRect(ox, oy, CW, signH); xe.globalAlpha = 1;
    // windows + door
    const wy = oy + signH + 14, wh = CH - signH - 18;
    const doorW = 70, doorX = ox + (s.lobby ? CW / 2 - doorW / 2 : CW * 0.72);
    const panes = s.lobby ? [[ox + 20, CW / 2 - doorW / 2 - 30], [doorX + doorW + 10, ox + CW - 20 - (doorX + doorW + 10)]] : [[ox + 16, doorX - ox - 28], [doorX + doorW + 12, ox + CW - 16 - (doorX + doorW + 12)]];
    for (const [px, pw] of panes) {
      if (pw <= 4) continue;
      const g = x.createLinearGradient(px, wy, px, wy + wh);
      g.addColorStop(0, '#40525e'); g.addColorStop(1, '#1b2228'); x.fillStyle = g; x.fillRect(px, wy, pw, wh);
      // interior hints: shelves / people silhouettes / lights
      x.fillStyle = s.interior; x.globalAlpha = 0.35;
      for (let k = 0; k < 3; k++) x.fillRect(px + 6, wy + 20 + k * (wh / 3.3), pw - 12, 5);
      x.globalAlpha = 1;
      for (let k = 0; k < 5; k++) { x.fillStyle = `hsla(${r() * 360},50%,60%,0.55)`; x.fillRect(px + 10 + r() * (pw - 30), wy + 26 + Math.floor(r() * 3) * (wh / 3.3) - 12, 8 + r() * 12, 12); }
      // reflection streak
      const rg = x.createLinearGradient(px, wy, px + pw, wy + wh); rg.addColorStop(0, 'rgba(255,255,255,0.0)'); rg.addColorStop(0.45, 'rgba(255,255,255,0.16)'); rg.addColorStop(0.55, 'rgba(255,255,255,0.0)');
      x.fillStyle = rg; x.fillRect(px, wy, pw, wh);
      x.strokeStyle = '#1a1a1a'; x.lineWidth = 5; x.strokeRect(px, wy, pw, wh);
      xe.fillStyle = s.interior; xe.globalAlpha = 0.75; xe.fillRect(px, wy, pw, wh); xe.globalAlpha = 1;
    }
    // door
    x.fillStyle = '#20262b'; x.fillRect(doorX, wy, doorW, wh);
    x.fillStyle = 'rgba(160,190,210,0.35)'; x.fillRect(doorX + 8, wy + 8, doorW - 16, wh * 0.6);
    x.fillStyle = '#c0c0c0'; x.fillRect(doorX + doorW - 16, wy + wh * 0.5, 5, 22);
    xe.fillStyle = s.interior; xe.globalAlpha = 0.5; xe.fillRect(doorX + 8, wy + 8, doorW - 16, wh * 0.6); xe.globalAlpha = 1;
  });
  noise(x, W, H, 8, r);
  const m = tex(c, { repeat: false }), e = tex(ce, { repeat: false });
  return { map: m, emissive: e };
}

export function billboardTexture(i) {
  const W = 1024, H = 512; const [c, x] = canvas(W, H);
  const ads = [
    () => { const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#ff6b4a'); g.addColorStop(1, '#ffb347'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.fillStyle = '#fff'; x.font = 'bold 150px "Bebas Neue", Impact'; x.textAlign = 'left'; x.fillText('SUNFIZZ', 60, 230); x.font = '600 48px Rajdhani, sans-serif'; x.fillText('taste the golden hour.', 66, 300);
      x.beginPath(); x.fillStyle = '#ffe9b0'; x.arc(800, 250, 150, 0, 7); x.fill(); x.fillStyle = '#e04b2a'; x.fillRect(740, 120, 120, 280); x.fillStyle = '#fff'; x.font = 'bold 40px "Bebas Neue"'; x.textAlign = 'center'; x.fillText('SUNFIZZ', 800, 270); },
    () => { x.fillStyle = '#10243a'; x.fillRect(0, 0, W, H); x.fillStyle = '#2ec4b6'; x.font = 'bold 140px "Bebas Neue", Impact'; x.textAlign = 'center'; x.fillText('MERIDIAN FM', W / 2, 230);
      x.fillStyle = '#fff'; x.font = '600 50px Rajdhani, sans-serif'; x.fillText('98.7 · NIGHT DRIVE RADIO', W / 2, 310); for (let k = 0; k < 40; k++) { x.fillStyle = `rgba(46,196,182,${0.2 + k / 60})`; const h = 20 + Math.abs(Math.sin(k * 0.7)) * 80; x.fillRect(110 + k * 20, 460 - h, 12, h); } },
    () => { x.fillStyle = '#f4efe6'; x.fillRect(0, 0, W, H); x.fillStyle = '#1b1b1b'; x.font = 'bold 120px "Bebas Neue", Impact'; x.textAlign = 'left'; x.fillText('VOLTA EV', 60, 200); x.font = '600 44px Rajdhani'; x.fillText('silent. fast. yours.', 66, 260);
      x.fillStyle = '#2b6cff'; x.beginPath(); x.moveTo(560, 380); x.quadraticCurveTo(700, 240, 960, 330); x.lineTo(960, 400); x.lineTo(560, 400); x.fill(); x.fillStyle = '#111'; x.beginPath(); x.arc(640, 400, 34, 0, 7); x.arc(880, 400, 34, 0, 7); x.fill(); },
    () => { const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#5b2a86'); g.addColorStop(1, '#ff4fd8'); x.fillStyle = g; x.fillRect(0, 0, W, H); x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = 'bold 130px "Bebas Neue"'; x.fillText('PALMS CASINO', W / 2, 220); x.font = '600 48px Rajdhani'; x.fillText('luck lives by the water', W / 2, 300); },
  ];
  ads[i % ads.length]();
  return tex(c, { repeat: false });
}

export function waterNormalTexture() {
  const S = 256; const r = rng(99); const [c, x] = canvas(S, S);
  // height field from summed sines -> normals
  const h = new Float32Array(S * S);
  const waves = Array.from({ length: 14 }, () => ({ kx: Math.round((r() - 0.5) * 12), ky: Math.round((r() - 0.5) * 12), p: r() * 6.28, a: 0.3 + r() }));
  for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) {
    let v = 0; for (const w of waves) v += w.a * Math.sin(2 * Math.PI * (w.kx * xx + w.ky * y) / S + w.p); h[y * S + xx] = v;
  }
  const img = x.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) {
    const l = h[y * S + (xx - 1 + S) % S], rr = h[y * S + (xx + 1) % S], u = h[((y - 1 + S) % S) * S + xx], d = h[((y + 1) % S) * S + xx];
    let nx = (l - rr) * 0.35, ny = (u - d) * 0.35, nz = 1; const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * S + xx) * 4; img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
}

export function leafTexture() {
  const W = 256, H = 64; const [c, x] = canvas(W, H); const r = rng(5);
  x.clearRect(0, 0, W, H);
  // palm frond: central rib with leaflets
  x.strokeStyle = '#3d5a22'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, H / 2); x.lineTo(W, H / 2); x.stroke();
  for (let i = 4; i < W - 6; i += 5) {
    const len = (H / 2 - 2) * Math.sin(Math.PI * (i / W)) * (0.85 + r() * 0.15);
    const g = 90 + r() * 50;
    x.strokeStyle = `rgb(${g * 0.45},${g},${g * 0.3})`; x.lineWidth = 3;
    x.beginPath(); x.moveTo(i, H / 2); x.lineTo(i + 10, H / 2 - len); x.stroke();
    x.beginPath(); x.moveTo(i, H / 2); x.lineTo(i + 10, H / 2 + len); x.stroke();
  }
  const t = tex(c, { repeat: false }); return t;
}

export function radialGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const S = 128; const [c, x] = canvas(S, S);
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); g.addColorStop(0, inner); g.addColorStop(1, outer);
  x.fillStyle = g; x.fillRect(0, 0, S, S); return tex(c, { repeat: false });
}

export function smokeTexture() {
  const S = 128; const [c, x] = canvas(S, S); const r = rng(3);
  for (let i = 0; i < 18; i++) {
    const px = S / 2 + (r() - 0.5) * S * 0.4, py = S / 2 + (r() - 0.5) * S * 0.4, rad = S * (0.15 + r() * 0.2);
    const g = x.createRadialGradient(px, py, 0, px, py, rad); g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
  }
  return tex(c, { repeat: false });
}
