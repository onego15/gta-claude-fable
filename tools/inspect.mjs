import { chromium } from 'playwright';
const files = process.argv.slice(2);
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader']});
const p = await b.newPage();
p.on('console', m=>console.log('console:', m.text()));
await p.goto('http://localhost:5173/tools/inspect.html');
await p.waitForFunction(()=>window.inspect);
for (const f of files) { try { console.log(f, JSON.stringify(await p.evaluate(u=>inspect(u), f))); } catch(e){ console.log(f,'ERR',e.message.slice(0,300)); } }
await b.close();
