import { chromium } from 'playwright';
import fs from 'fs';
const jobs = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader']});
const p = await b.newPage();
await p.goto('http://localhost:5173/tools/convert.html');
await p.waitForFunction(()=>window.convert);
for (const j of jobs) {
  const r = await p.evaluate(([u,o])=>convert(u,o), [j.src, j.opts]);
  fs.writeFileSync(j.out, Buffer.from(r.glb,'base64'));
  console.log(j.out, fs.statSync(j.out).size, JSON.stringify(r.box.map(v=>v.map(x=>+x.toFixed(2)))));
}
await b.close();
