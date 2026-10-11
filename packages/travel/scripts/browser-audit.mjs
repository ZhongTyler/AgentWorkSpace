// Optional offline visual inventory. Screenshots require editor review; this script cannot approve design.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {inside,read,write,hash,inputHash,now} from './lib/core.mjs';
const args=process.argv.slice(2),value=k=>{const i=args.indexOf('--'+k);return i<0?undefined:args[i+1];};
if(!value('project'))throw Error('Specify --project');
const project=path.resolve(value('project')),file=inside(project,value('file')||'build/index.html');
const receipt=read(inside(project,'build/receipt.json'));
assert.equal(receipt.sourceHash,inputHash(project),'Build is stale');assert.equal(receipt.artifactHash,hash(fs.readFileSync(file)),'Artifact differs from build');
const D=read(inside(project,'generated/data.json')),require=createRequire(import.meta.url);
const modulePath=process.env.TRAVEL_PLAYWRIGHT_MODULE||require.resolve('playwright');
const {chromium}=await import(pathToFileURL(path.resolve(modulePath)).href);
const browser=await chromium.launch({headless:true,...((value('browser')||process.env.TRAVEL_BROWSER)?{executablePath:value('browser')||process.env.TRAVEL_BROWSER}:{})});
const checks=[],shots=[],errors=[],network=[],out=inside(project,'.runtime/visual-audit');fs.mkdirSync(out,{recursive:true});
try{
 const context=await browser.newContext({offline:true,viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await page.goto(pathToFileURL(file).href);assert.equal(await page.title(),D.title);
 async function capture(id,kind,width,focus){
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,id+' overflow '+width);
  assert.equal(await page.locator('img').evaluateAll(es=>es.filter(e=>!e.complete||!e.naturalWidth).length),0,id+' broken image');
  checks.push({id,kind,width,noOverflow:true});
  if(width===320)return;
  const name=id+'-'+width+'.png',full=id+'-'+width+'-full.png';
  await page.screenshot({path:path.join(out,full),fullPage:true});
  const locator=focus?page.locator(focus).first():null;
  if(locator&&await locator.count())await locator.evaluate(e=>{const y=e.getBoundingClientRect().top+scrollY-150;scrollTo(0,Math.max(0,y));});
  else await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:path.join(out,name)});shots.push({id,kind,width,file:name,full});
 }
 async function go(hash){await page.evaluate(h=>{location.hash=h;scrollTo(0,0);},hash);await page.waitForTimeout(40);}
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});
  for(const view of ['overview','weather','maps','orders','dining','shopping','guides','wiki','journal']){
   await go(view+'/'+D.days[0].date);
   assert.ok((await page.locator('#main').innerText()).length>0);
   if(view==='orders')await page.locator('.todo-day>summary').evaluateAll(es=>es.forEach(e=>e.parentElement.open=true));
   await capture(view,'module',width);
  }
  // Date-dependent global views must not be checked only on the first day.
  for(const d of D.days.slice(1))for(const view of ['weather','maps']){
   await go(view+'/'+d.date);await capture(view+'-'+d.date,'dated-module',width);
  }
  for(const d of D.days){
   for(const section of ['projects','routes','timeline','meals','stay','check']){
    await go('day/'+d.date+'/'+section);
    assert.equal(await page.locator('[data-section="'+section+'"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.daily-masthead').count(),1);
    if(section==='projects')await page.locator('.experience').evaluateAll(es=>es.forEach(e=>e.open=true));
    if(section==='meals')await page.locator('.meal-section details').evaluateAll(es=>es.forEach(e=>e.open=true));
    if(section==='routes')await page.locator('.formal-routes').evaluateAll(es=>es.forEach(e=>e.open=true));
    await capture(d.date+'-'+section,'day',width,section==='projects'?'.experience-index, .transfer-day':section==='routes'?'.map-panel':'.tool-content');
   }
  }
  // Every card and Wiki, not only the representative ones. Keep rendering sourced facts intact.
  await go('dining');
  for(const p of D.places){
   await page.evaluate(id=>{const b=document.createElement('button');b.dataset.place=id;document.body.append(b);b.click();b.remove();},p.id);
   assert.equal(await page.locator('#detail').evaluate(d=>d.open),true);
   assert.equal(await page.locator('.place-detail h1').innerText(),p.name);
   assert.equal(await page.locator('#detail').evaluate(e=>e.scrollWidth<=e.clientWidth+2),true,p.id+' modal overflow');
   if(width!==320)await page.locator('#detail').screenshot({path:path.join(out,'place-'+p.id+'-'+width+'.png')});
   checks.push({id:p.id,kind:'place',width});await page.keyboard.press('Escape');
  }
  for(const k of D.knowledge){
   await page.evaluate(id=>{const b=document.createElement('button');b.dataset.wiki=id;document.body.append(b);b.click();b.remove();},k.id);
   assert.equal(await page.locator('.wiki-detail').count(),1);
   assert.equal(await page.locator('#detail').evaluate(e=>e.scrollWidth<=e.clientWidth+2),true,k.id+' modal overflow');
   if(width!==320)await page.locator('#detail').screenshot({path:path.join(out,'wiki-'+k.id+'-'+width+'.png')});
   checks.push({id:k.id,kind:'wiki',width});await page.keyboard.press('Escape');
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 // Contact sheets are a review aid, not automatic evidence of a human/editor review.
 const atlas=await context.newPage();await atlas.setViewportSize({width:1600,height:1000});
 const lists=[];
 for(const width of [1440,390]){
  const selected=shots.filter(s=>s.width===width);
  for(let i=0;i<selected.length;i+=12)lists.push({name:'atlas-'+width+'-'+String(i/12+1).padStart(2,'0'),items:selected.slice(i,i+12)});
 }
 // Modal atlases cover every place and topic at both widths.
 for(const width of [1440,390])for(const [kind,items] of [['place',D.places],['wiki',D.knowledge]]){
  for(let i=0;i<items.length;i+=12)lists.push({name:'atlas-'+kind+'-'+width+'-'+String(i/12+1).padStart(2,'0'),items:items.slice(i,i+12).map(x=>({id:x.id,file:kind+'-'+x.id+'-'+width+'.png'}))});
 }
 for(const sheet of lists){
  await atlas.setContent('<style>*{box-sizing:border-box}body{margin:0;padding:12px;background:#d8e4e7;font:16px sans-serif}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}article{background:white;padding:8px;min-width:0}h3{font-size:14px;margin:0 0 8px;height:20px;overflow:hidden}img{width:100%;height:430px;object-fit:contain;object-position:top;background:#f4f8f8}</style><div class="grid">'+sheet.items.map(s=>'<article><h3>'+s.id+'</h3><img src="data:image/png;base64,'+fs.readFileSync(path.join(out,s.file)).toString('base64')+'"></article>').join('')+'</div>');
  await atlas.screenshot({path:path.join(out,sheet.name+'.png'),fullPage:true});
 }
 const report={passed:true,at:now(),sourceHash:D.sourceHash,artifactHash:receipt.artifactHash,counts:{modules:9,days:D.days.length,daySections:6,places:D.places.length,wiki:D.knowledge.length,widths:[1440,390,320],states:checks.length,atlases:lists.length},checks,screenshots:shots,atlases:lists.map(s=>s.name+'.png'),networkRequests:network.length,pageErrors:errors,editorReview:'pending; inspect screenshots and record separately',humanAcceptance:'not-inferred-from-script'};
 write(inside(project,'reports/visual-audit.json'),report);console.log(JSON.stringify({...report,checks:checks.length,screenshots:shots.length,atlases:lists.length},null,2));
}finally{await browser.close();}
