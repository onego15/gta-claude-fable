import { chromium } from 'playwright';
const [urls, cam, tgt, out, clip, t] = process.argv.slice(2);
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader']});
const p = await b.newPage({viewport:{width:900,height:500}});
p.on('console', m=>{ if(m.type()==='error') console.log(m.text()) });
await p.goto('http://localhost:5173/tools/view.html'); await p.waitForFunction(()=>window.show);
if(process.env.ANIM) await p.evaluate(u=>window.animUrl=u, process.env.ANIM);
await p.evaluate(a=>show(...a), [urls.split(','), JSON.parse(cam), JSON.parse(tgt), clip, +t]);
await p.screenshot({path: out}); await b.close();
