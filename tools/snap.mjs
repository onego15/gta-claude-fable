// usage: node tools/snap.mjs "<query>" out.png [w h]
import { chromium } from 'playwright';
const [q, out, w = 1280, h = 720] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
p.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
p.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
await p.goto('http://localhost:5173/?' + q);
try { await p.waitForFunction(() => window.__ready, null, { timeout: 120000 }); } catch (e) { logs.push('TIMEOUT'); }
await p.waitForTimeout(+(process.env.WAIT || 500));
await p.evaluate(() => { window.__stop = true; }); await p.waitForTimeout(300);
console.log('frameMs', await p.evaluate(() => window.__frameMs));
await p.screenshot({ path: out, timeout: 120000 });
console.log(logs.filter(l => !l.includes('[vite]')).slice(0, 30).join('\n'));
await b.close();
