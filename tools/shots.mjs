// usage: node tools/shots.mjs shots.json   ; shots: {query, shots:[{name, eval, wait}]}
import { chromium } from 'playwright';
import fs from 'fs';
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: cfg.w || 1280, height: cfg.h || 720 } });
const logs = [];
p.on('console', (m) => { if (!m.text().includes('[vite]')) logs.push(m.type() + ': ' + m.text()); });
p.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message + '\n' + e.stack));
await p.goto('http://localhost:5173/?' + (cfg.query || ''));
try { await p.waitForFunction(() => window.__ready, null, { timeout: 180000 }); } catch (e) { logs.push('TIMEOUT'); }
for (const s of cfg.shots) {
  if (s.eval) { try { const r = await p.evaluate(s.eval); if (r !== undefined) logs.push(s.name + ' => ' + JSON.stringify(r)); } catch (e) { logs.push('EVALERR ' + s.name + ' ' + e.message); } }
  await p.waitForTimeout(s.wait ?? 400);
  if (s.name) { await p.evaluate(() => window.__renderOnce && window.__renderOnce()); await p.screenshot({ path: '/tmp/claude-0/' + s.name + '.png', timeout: 120000 }); }
}
console.log(logs.slice(0, 60).join('\n'));
await b.close();
