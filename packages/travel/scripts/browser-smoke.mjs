// Optional real-browser acceptance; core CLI does not require Playwright.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {inside,loadTrip,write,now,hash,inputHash} from './lib/core.mjs';

const args=process.argv.slice(2),value=k=>{const i=args.indexOf('--'+k);return i<0?undefined:args[i+1];};
const require=createRequire(import.meta.url);
const {chromium}=await import(pathToFileURL(path.resolve(process.env.TRAVEL_PLAYWRIGHT_MODULE||require.resolve('playwright'))).href);
const project=path.resolve(value('project')||'.'),file=inside(project,'build/index.html');
if(!fs.existsSync(file))throw Error('Build the project first');
const trip=loadTrip(project),browser=await chromium.launch({headless:true,...(value('browser')?{executablePath:value('browser')}:{})});
const projection=JSON.parse(fs.readFileSync(inside(project,'generated/data.json'),'utf8'));
fs.mkdirSync(inside(project,'.runtime'),{recursive:true});
const checks=[],errors=[],network=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},offline:true});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await page.goto(pathToFileURL(file).href);
 assert.equal(await page.title(),trip.title);checks.push('page identity on file://');
 for(const view of ['overview','weather','day','maps','orders','dining','shopping','guides','wiki','journal']){
   await page.evaluate(view=>{location.hash=view;},view);await page.waitForTimeout(60);
   assert.ok((await page.locator('#main').innerText()).length>0,view);checks.push(view);
 }
 await page.evaluate(()=>{location.hash='day';});await page.waitForTimeout(60);
 const selectSection=async section=>{
   if(['timeline','meals','stay','check'].includes(section)&&await page.locator('.day-tools').getAttribute('open')===null)await page.locator('.day-tools>summary').click();
   await page.locator('[data-section="'+section+'"]').click();
   assert.equal(await page.locator('[data-section="'+section+'"]').getAttribute('aria-pressed'),'true');
 };
 assert.equal(await page.locator('#nav>a').count(),10);assert.equal(await page.locator('#nav details').count(),0);
 for(const day of trip.days){
   await page.locator('[data-date="'+day.date+'"]').click();
   await page.locator('#nav').getByRole('link',{name:'地图路线',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('#main>h1')?.textContent==='地图路线');
   assert.ok((await page.evaluate(()=>location.hash)).startsWith('#maps/'+day.date));
   assert.equal(await page.locator('#main article.panel').count(),day.routeIds.length+projection.overviews.filter(r=>r.date===day.date).length);
   await page.locator('#nav').getByRole('link',{name:'每日执行',exact:true}).click();
   await page.locator('.primary-tabs').waitFor();
   for(const section of ['projects','timeline','routes','meals','stay','check'])await selectSection(section);
   await page.reload();assert.equal(await page.locator('[data-section="check"]').getAttribute('aria-pressed'),'true');
 }
 checks.push('every day, two primary views, four folded tools, shared facts and reload persistence');
 for(const day of trip.days){
   await page.locator('[data-date="'+day.date+'"]').click();await selectSection('projects');
   const ids=trip.journal.filter(j=>j.date===day.date&&j.kind==='experience').map(j=>j.id);
   assert.deepEqual(await page.locator('[data-experience]').evaluateAll(es=>es.map(e=>e.dataset.experience)),ids);
   assert.equal(await page.locator('.experience[open]').count(),ids.length?1:0);
   const detailed=trip.journal.filter(j=>j.date===day.date&&j.kind==='experience'&&j.visit?.steps?.length);
   for(const j of detailed)assert.equal(await page.locator('[data-experience="'+j.id+'"] .visit-detail ol>li').count(),j.visit.steps.length);
   if(!ids.length&&trip.journal.some(j=>j.date===day.date))assert.equal(await page.locator('.transfer-day').count(),1);
   if(ids.length>1){await page.locator('[data-experience-jump="'+ids[1]+'"]').click();assert.equal(await page.locator('[data-experience="'+ids[1]+'"]').getAttribute('open'),'');}
   await selectSection('routes');
   const route=trip.routes.find(r=>r.id===day.routeIds[0]);
   if(route&&route.mode!=='official'){
     const original=await page.locator('.draft-stops li>.place').allTextContents();
     if(original.length>1){await page.locator('[data-draft-move="0"][data-delta="1"]').click();assert.equal((await page.locator('.draft-stops li>.place').allTextContents())[1],original[0]);await page.reload();assert.equal((await page.locator('.draft-stops li>.place').allTextContents())[1],original[0]);await page.locator('[data-draft-reset]').click();assert.deepEqual(await page.locator('.draft-stops li>.place').allTextContents(),original);}
     const allExact=route.stops.every(id=>{try{return /(^|\.)google\.(com|no|se)$/.test(new URL(trip.places.find(p=>p.id===id).mapUrl).hostname);}catch{return false;}});
     assert.equal(await page.locator('.draft-links a').count()>0,allExact);
     await page.locator('[data-draft-add]').click();assert.equal(await page.locator('.draft-stops li').count(),original.length+1);await page.locator('[data-draft-remove]').last().click();assert.equal(await page.locator('.draft-stops li').count(),original.length);
   }
   for(const official of trip.routes.filter(r=>day.routeIds.includes(r.id)&&r.mode==='official')){
     await page.locator('#draft-route').selectOption(official.id);assert.equal(await page.locator('[data-draft-add]').count(),0);
     assert.equal(await page.getByRole('link',{name:'打开正式指引',exact:true}).getAttribute('href'),official.officialUrl);
   }
   if(route){
     await page.locator('.formal-routes>summary').click();
     const expected=[...projection.overviews.filter(r=>r.date===day.date),...day.routeIds.map(id=>projection.routes.find(r=>r.id===id))].map(r=>r.stops.map(id=>trip.places.find(p=>p.id===id).name));
     assert.equal(await page.locator('.formal-routes article.panel').count(),expected.length);
     for(let i=0;i<expected.length;i++)assert.deepEqual(await page.locator('.formal-routes article.panel').nth(i).locator('h3 [data-place]').allTextContents(),expected[i],'route labels must be place names, not map callback indexes');
   }
   await page.evaluate(()=>{location.hash='journal';});await page.waitForTimeout(60);
   for(const id of ids)assert.equal(await page.locator('[data-experience="'+id+'"]').count(),1);
   await page.evaluate(()=>{location.hash='day';});await page.waitForTimeout(60);
 }
 checks.push('project IDs match journal experiences; intro excluded');
 checks.push('structured experience steps and real transfer-day reading');
 if(trip.places.length){
   await selectSection('timeline');
   await page.locator('#main [data-place]').first().click();assert.equal(await page.locator('#detail').evaluate(d=>d.open),true);
   assert.ok(await page.locator('#detail-content a[href^="http"]').count());await page.keyboard.press('Escape');assert.equal(await page.locator('#detail').evaluate(d=>d.open),false);checks.push('place card, map link and Escape');
 }
 if(trip.knowledge.length){
   await page.evaluate(()=>{location.hash='wiki';});await page.waitForTimeout(60);
   await page.locator('#search').fill('unlikely-no-result-12345');assert.equal(await page.locator('[data-wiki]').count(),0);
   await page.locator('#search').fill('');await page.locator('[data-wiki]').first().click();assert.equal(await page.locator('#detail').evaluate(d=>d.open),true);
   await page.locator('#close').click();checks.push('Wiki search, no results and detail modal');
 }
 await page.evaluate(()=>{location.hash='weather';});await page.waitForTimeout(60);
 if(trip.weatherLocations.length&&await page.locator('.weather').count())assert.equal(await page.locator('.weather').first().getAttribute('open'),'');
 await page.evaluate(()=>{location.hash='day';});await page.waitForTimeout(60);
 if(await page.locator('.weather').count())assert.equal(await page.locator('.weather').first().getAttribute('open'),null);
 checks.push('weather default expanded / daily default collapsed');
 for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   for(const view of ['overview','day','weather','dining','orders']){
     await page.evaluate(view=>{location.hash=view;},view);await page.waitForTimeout(60);
     const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);assert.equal(overflow,false,'horizontal overflow '+view+' '+width);
   }
   await page.evaluate(()=>{location.hash='day';scrollTo(0,0);});await page.waitForTimeout(60);await page.screenshot({path:inside(project,'.runtime/projects-'+width+'.png'),fullPage:true});
   await selectSection('routes');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:inside(project,'.runtime/map-'+width+'.png'),fullPage:true});
   await page.evaluate(()=>{location.hash='overview';});await page.waitForTimeout(60);
   await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:inside(project,'.runtime/preview-'+width+'.png'),fullPage:true});
 }
 assert.equal(await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>!i.complete||i.naturalWidth===0).length),0);
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 const result={passed:true,at:now(),sourceHash:inputHash(project),artifactHash:hash(fs.readFileSync(file)),browser:'Chromium',checks,networkRequests:network.length,pageErrors:errors,scope:'Real offline browser interaction, not live maps/login or tourism validation'};
 write(inside(project,'.runtime/browser-acceptance.json'),result);console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
