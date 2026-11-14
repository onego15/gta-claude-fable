// Keyboard + mouse (pointer lock) + gamepad input with a small action map.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set(); this.pressed = new Set(); this.released = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false, wheel: 0 };
    this.locked = false; this.enabled = true; this.sensitivity = 1; this.invertY = false;
    this.virtual = new Map(); // scripted input for tests/demo capture
    addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); this.released.add(e.code); });
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => { if (this.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (this.onLockChange) this.onLockChange(this.locked); });
  }
  lock() { if (!this.locked && this.canvas.requestPointerLock) { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  down(code) { return this.keys.has(code) || !!this.virtual.get(code); }
  hit(code) { return this.pressed.has(code) || this.virtual.get(code) === 'tap'; }
  // gamepad
  pad() { const p = navigator.getGamepads ? navigator.getGamepads()[0] : null; return p && p.connected ? p : null; }
  axis(name) {
    let v = 0; const p = this.pad();
    if (name === 'moveX') { v = (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0); if (p && Math.abs(p.axes[0]) > 0.15) v = p.axes[0]; }
    if (name === 'moveY') { v = (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0) - (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0); if (p && Math.abs(p.axes[1]) > 0.15) v = -p.axes[1]; }
    if (name === 'lookX' && p && Math.abs(p.axes[2]) > 0.12) v = p.axes[2];
    if (name === 'lookY' && p && Math.abs(p.axes[3]) > 0.12) v = p.axes[3];
    return v;
  }
  btn(i) { const p = this.pad(); return p ? p.buttons[i] && p.buttons[i].pressed : false; }
  get aim() { return this.mouse.right || this.btn(6) || !!this.virtual.get('aim'); }
  get fire() { return this.mouse.left || this.btn(7) || !!this.virtual.get('fire'); }
  endFrame() {
    this.pressed.clear(); this.released.clear(); this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    this.mouse.leftPressed = false; this.mouse.rightPressed = false;
    for (const [k, v] of this.virtual) if (v === 'tap') this.virtual.delete(k);
  }
}
