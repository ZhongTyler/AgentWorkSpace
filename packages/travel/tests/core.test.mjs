import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT,init,inside,uid,read,write,loadTrip,hash,now,routeHash,dayHash,routeUrl,budget,publicUrl} from '../scripts/lib/core.mjs';
import {validate} from '../scripts/lib/validate.mjs';
import {importSource,digest,researchStatus,rawGallery} from '../scripts/lib/research.mjs';
import {build,freshness} from '../scripts/lib/generate.mjs';
import {normalizeForecast,refreshWeather,scaffoldRoutes,routeReview,drivingOverviews} from '../scripts/lib/maps-weather.mjs';
import {makeDemo} from '../scripts/make-demo.mjs';
import {parse} from '../scripts/travel.mjs';
import {importAsset} from '../scripts/lib/assets.mjs';

function fixture(t,demo=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'travel-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const project=path.join(root,'new trip');
 if(demo)makeDemo(project);else init(project,'测试','2027-01-01','2027-01-02');
 return {root,project};
}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a94UAAAAASUVORK5CYII=','base64');
test('explicit experiences share journal data and reject invented kinds',t=>{
 const {project}=fixture(t,true),trip=loadTrip(project);
 assert.equal(trip.journal.filter(j=>j.kind==='experience').length,4);
 assert.equal(validate(trip,project).valid,true);
 trip.journal[0].kind='made-up';assert.ok(validate(trip,project).errors.some(e=>e.includes('journal kind')));
});
test('init is portable, has chronological dates, never overwrites',t=>{
 const {project}=fixture(t);assert.equal(loadTrip(project).days.length,2);assert.throws(()=>init(project,'x','2027-01-01','2027-01-02'),/exists/);
 const intro=fs.readFileSync(inside(project,'README.md'),'utf8');const link=intro.match(/\]\(<([^>]+)>\)/)[1];assert.ok(fs.existsSync(path.resolve(project,link)));assert.ok(!intro.includes('已复制'));
});
test('paths reject traversal, absolute paths and backslashes',t=>{
 const {project}=fixture(t);for(const p of ['../escape','/tmp/x','C:/secret','..\\escape'])assert.throws(()=>inside(project,p));
 assert.equal(inside(project,'assets/a.png'),path.join(project,'assets/a.png'));
});
test('IDs reject reserved device and path names',()=>{
 for(const id of ['con','../a','A B','a/b'])assert.throws(()=>uid(id));assert.equal(uid('note-1'),'note-1');
});
test('URL canonicalization removes access tokens, not exact note ID',()=>{
 assert.equal(publicUrl('https://www.xiaohongshu.com/explore/0123456789abcdef01234567?xsec_token=SECRET'),'https://www.xiaohongshu.com/explore/0123456789abcdef01234567');
 assert.throws(()=>publicUrl('javascript:alert(1)'));
});
test('CLI rejects duplicate options',()=>assert.throws(()=>parse(['init','--project','a','--project','b']),/Duplicate/));
test('validation accepts initialized scaffold but warns missing timelines',t=>{
 const {project}=fixture(t),r=validate(loadTrip(project),project);assert.equal(r.valid,true);assert.equal(r.warnings.length,2);
});
test('validation rejects missing dates and wrong time zone',t=>{
 const {project}=fixture(t),x=loadTrip(project);x.days.pop();x.days[0].timezone='Never/Land';const r=validate(x,project);assert.equal(r.valid,false);assert.ok(r.errors.some(e=>e.includes('missing date')));
});
test('validation rejects overlapping default time windows',t=>{
 const {project}=fixture(t),x=loadTrip(project);x.days[0].timeline=[{start:'10:00',end:'11:00',title:'a'},{start:'10:30',end:'11:30',title:'b'}];assert.ok(validate(x,project).errors.some(e=>e.includes('overlaps')));
});
test('exact references and unique aliases enforced',t=>{
 const {project}=fixture(t,true),x=loadTrip(project);x.places[1].aliases=['演示住宿'];x.days[0].stayId='missing';const r=validate(x,project);assert.ok(r.errors.some(e=>e.includes('ambiguous')));assert.ok(r.errors.some(e=>e.includes('unknown reference')));
});
test('active booking date must match meal date',t=>{
 const {project}=fixture(t,true),x=loadTrip(project);x.orders[0].date=x.end;assert.ok(validate(x,project).errors.some(e=>e.includes('wrong-date')));
});
test('secret-bearing shared facts are rejected',t=>{
 const {project}=fixture(t,true),x=loadTrip(project);x.places[0].accessToken='SHOULD_NOT_SHIP';assert.equal(validate(x,project).valid,false);
});
test('source revisions are immutable; refresh invalidates digest',t=>{
 const {project,root}=fixture(t);fs.writeFileSync(path.join(root,'one.png'),png);
 const source={id:'a',title:'a',url:'https://example.com/a',text:'source',images:[{file:'one.png'}]};
 importSource(project,source,root);const row=read(inside(project,'research/registry.json'))[0],before=fs.readFileSync(inside(project,row.raw));
 assert.throws(()=>importSource(project,source,root),/exists/);
 importSource(project,{...source,text:'new'},root,{refresh:true});const next=read(inside(project,'research/registry.json'))[0];
 assert.notEqual(next.raw,row.raw);assert.deepEqual(fs.readFileSync(inside(project,row.raw)),before);assert.equal(next.review,null);
});
test('missing/duplicate source image prevents registry partial success',t=>{
 const {project,root}=fixture(t);const source={id:'a',title:'a',url:'https://example.com/a',text:'a',images:[{file:'missing.png'}]};
 assert.throws(()=>importSource(project,source,root));assert.equal(read(inside(project,'research/registry.json')).length,0);
 fs.writeFileSync(path.join(root,'x.png'),png);source.images=[{file:'x.png'},{file:'x.png'}];assert.throws(()=>importSource(project,source,root),/Duplicate/);
});
test('complete digestion requires every image and traceable Wiki URL',t=>{
 const {project,root}=fixture(t);fs.writeFileSync(path.join(root,'x.png'),png);
 importSource(project,{id:'a',title:'a',url:'https://example.com/a',text:'a',images:[{file:'x.png'}]},root);
 const row=read(inside(project,'research/registry.json'))[0],raw=read(inside(project,row.raw));
 write(inside(project,'knowledge/a.md'),'No source');
 const review={id:'a',rawHash:row.rawHash,reviewer:'test',reviewedAt:now(),status:'complete',bodyRead:true,images:[],outcomes:[{topic:'a',reason:'a',file:'knowledge/a.md'}]};
 assert.throws(()=>digest(project,review),/every image/);
 review.images=raw.images.map(i=>({hash:i.hash,read:true}));assert.throws(()=>digest(project,review),/retain public source/);
 write(inside(project,'knowledge/a.md'),'https://example.com/a');digest(project,review);
 assert.equal(researchStatus(project).counts.complete,1);
 assert.ok(fs.readFileSync(rawGallery(project,'a').file,'utf8').includes('data:image/png;base64'));
});
test('partial review and reviewed non-adoption have distinct counts',t=>{
 const {project}=fixture(t);importSource(project,{id:'a',title:'a',url:'https://example.com/a',text:'a',images:[]},project);
 const row=read(inside(project,'research/registry.json'))[0],r={id:'a',rawHash:row.rawHash,reviewer:'test',reviewedAt:now(),status:'partial',bodyRead:false,images:[],outcomes:[]};
 digest(project,r);assert.equal(researchStatus(project).counts.partial,1);
 digest(project,{...r,status:'not-used',bodyRead:true,outcomes:[{topic:'x',reason:'duplicate',decision:'not-used'}]});assert.equal(researchStatus(project).counts.notUsed,1);
});
test('tampered raw image is detected',t=>{
 const {project,root}=fixture(t);fs.writeFileSync(path.join(root,'x.png'),png);importSource(project,{id:'a',title:'a',url:'https://example.com/a',text:'a',images:[{file:'x.png'}]},root);
 const row=read(inside(project,'research/registry.json'))[0],raw=read(inside(project,row.raw));fs.writeFileSync(inside(project,raw.images[0].file),'tampered');assert.equal(validate(loadTrip(project),project).valid,false);
});
test('budget uses each day party, one linked total order and no alternatives',t=>{
 const {project}=fixture(t,true),x=loadTrip(project),b=budget(x);assert.deepEqual(b.totals.DEM,{min:380,max:490});assert.equal(b.reference[0].min,760);assert.equal(b.unknown,0);
 assert.equal(b.completeTripBudget,false);assert.match(b.scope,/omitted categories/);
});
test('route URL binds IDs and directions; transit restrictions validated',t=>{
 const {project}=fixture(t,true),x=loadTrip(project),r=x.routes[0];x.places[0].googlePlaceId='exact';const u=new URL(routeUrl(x,r));assert.equal(u.searchParams.get('origin_place_id'),'exact');assert.equal(u.searchParams.get('travelmode'),'walking');
 r.mode='transit';r.stops.push('demo-table');assert.ok(validate(x,project).errors.some(e=>e.includes('two endpoints')));
});
test('route scaffolding is idempotent and overviews split at non-driving legs',t=>{
 const {project}=fixture(t,true);assert.equal(scaffoldRoutes(project,'walking').added.length,0);const x=loadTrip(project);
 x.routes.forEach(r=>r.mode='driving');x.routes[1].mode='walking';const ovs=drivingOverviews(x);assert.ok(ovs.length>=3);assert.ok(ovs.every(r=>r.stops.length<=5));
});
test('day change invalidates route and journal review',t=>{
 const {project}=fixture(t,true),x=loadTrip(project);x.days[0].meals[0].note='changed';const r=validate(x,project);assert.ok(r.errors.some(e=>e.includes('day changed')));assert.ok(r.errors.some(e=>e.includes('journal stale')));
});
test('capture cannot be reviewed with wrong content hash',t=>{
 const {project}=fixture(t,true),x=loadTrip(project),r=x.routes[0];r.capture={file:'assets/r.png',hash:hash(png),routeHash:routeHash(x,r),reviewed:false};write(inside(project,'assets/r.png'),png);write(inside(project,'trip.json'),x);
 assert.throws(()=>routeReview(project,r.id,{routeHash:routeHash(x,r),dayHash:dayHash(x.days[0]),by:'test',at:now(),evidence:'mock',endpointsAndModeChecked:true,screenshotChecked:true,captureHash:'wrong'}),/bind current/);
});
test('weather preserves nulls and refuses timezone/unit mismatch',()=>{
 const l={id:'x',name:'x',timezone:'Europe/Oslo'},j={timezone:'Europe/Oslo',daily_units:{temperature_2m_max:'°C',temperature_2m_min:'°C'},daily:{time:['2027-01-01'],temperature_2m_max:[4],temperature_2m_min:[null]}};
 const out=normalizeForecast(l,j,now());assert.equal(out.daily[0].min,null);assert.equal(out.daily[0].sunset,null);assert.equal(out.daily.length,1);
 assert.throws(()=>normalizeForecast(l,{...j,timezone:'UTC'},now()),/timezone/);
});
test('weather partial failure is explicit; all-failure does not replace pointer',async t=>{
 const {project}=fixture(t,true);let n=0;
 const fetcher=async()=>{n++;if(n===2)throw Error('offline');return {ok:true,json:async()=>({timezone:'Europe/Oslo',daily_units:{temperature_2m_max:'°C',temperature_2m_min:'°C'},daily:{time:['2027-05-01'],temperature_2m_max:[9],temperature_2m_min:[2]}})};};
 const r=await refreshWeather(project,{fetcher});assert.equal(r.locations,1);assert.equal(r.failures.length,1);const before=fs.readFileSync(inside(project,'weather/latest.json'));
 await assert.rejects(refreshWeather(project,{fetcher:async()=>{throw Error('offline');}}));assert.deepEqual(fs.readFileSync(inside(project,'weather/latest.json')),before);
});
test('build embeds everything, excludes evidence paths, escapes script closing input',t=>{
 const {project}=fixture(t,true),x=loadTrip(project);x.title='</script><script>alert(1)</script>';write(inside(project,'trip.json'),x);const out=build(project),html=fs.readFileSync(out.file,'utf8');
 assert.ok(html.includes('\\u003c/script>'));assert.ok(!html.includes('private/demo-order.txt'));assert.ok(!/<script[^>]+src=/.test(html));assert.ok(html.includes("connect-src 'none'"));assert.equal(freshness(project).build,true);
 fs.appendFileSync(inside(project,'knowledge/demo.md'),'\nChanged');assert.equal(freshness(project).build,false);
});
test('CLI works from unrelated current directory and reports failure exit codes',t=>{
 const {project,root}=fixture(t);const command=path.join(ROOT,'scripts/travel.mjs');
 let r=spawnSync(process.execPath,[command,'build','--project',project],{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 r=spawnSync(process.execPath,[command,'validate','--project',project,'--strict'],{cwd:root,encoding:'utf8'});assert.equal(r.status,1);
 assert.equal(JSON.parse(r.stdout).passed,false);assert.equal(JSON.parse(r.stdout).valid,true);
});
test('booked order arrival reminders stay distinct from booking actions',t=>{
 const {project}=fixture(t,true),x=loadTrip(project);x.todos=[{id:'arrive',dates:[x.start],kind:'reminder',when:'当天',action:'到店',status:'open',orderId:x.orders[0].id}];
 assert.ok(!validate(x,project).warnings.some(e=>e.includes('booking exists')));
 x.todos[0].kind='booking';assert.ok(validate(x,project).warnings.some(e=>e.includes('booking exists')));
});
test('address mutation invalidates reviewed routes even without screenshots',t=>{
 const {project}=fixture(t,true),x=loadTrip(project);x.places[0].address='Changed entrance';
 assert.ok(validate(x,project).errors.some(e=>e.includes('place/mode changed')));
});
test('weather coordinate mutation cannot reuse an old same-ID forecast',t=>{
 const {project}=fixture(t,true),x=loadTrip(project);x.weatherLocations[0].latitude+=1;write(inside(project,'trip.json'),x);
 assert.throws(()=>build(project),/Weather location changed/);
});
test('every copied skill link remains within the bundle',t=>{
 const {project}=fixture(t);assert.ok(fs.existsSync(project));
 for(const rel of ['SKILL.md','skills/travel-day-planner/SKILL.md','skills/xiaohongshu-capture/SKILL.md','skills/xiaohongshu-evidence-digest/SKILL.md']){
   const file=path.join(ROOT,rel),body=fs.readFileSync(file,'utf8');
   for(const m of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){if(m[1].startsWith('http'))continue;const target=path.resolve(path.dirname(file),m[1]);assert.ok(target.startsWith(ROOT+path.sep));assert.ok(fs.existsSync(target));}
 }
});
test('photo import versions assets and requires attribution/license',t=>{
 const {project,root}=fixture(t,true),file=path.join(root,'pixel.png');fs.writeFileSync(file,png);
 assert.throws(()=>importAsset(project,file,{},'place:demo-museum'),/license/);
 const r=importAsset(project,file,{caption:'Synthetic pixel, not destination photo',source:'https://example.com/pixel',license:'Synthetic test fixture'},'place:demo-museum');
 assert.equal(hash(fs.readFileSync(inside(project,r.file))),hash(png));assert.equal(loadTrip(project).places[1].photo.file,r.file);
 assert.equal(validate(loadTrip(project),project).valid,true,'adding a photo does not invalidate route geometry review');
});
