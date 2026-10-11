import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {blankTrip,init,write,inside} from '../scripts/lib/core.mjs';
import {scheduleReport,setChannel,assertResearchEnabled,changeReport,assistantCoverage} from '../scripts/lib/operations.mjs';
import {preservePastForecasts,forecastRequestKey} from '../scripts/lib/maps-weather.mjs';
import * as mcp from '../scripts/lib/mcp.mjs';
const make=()=>blankTrip('x','2026-10-04','2026-10-06');
test('protected shopping excludes transfer and overlapping minutes',()=>{
 const t=make(),d=t.days[2];d.timeline=[{id:'a',kind:'shopping',start:'10:00',end:'11:15'},{id:'transfer',kind:'transfer',start:'11:15',end:'11:25'},{id:'b',kind:'shopping',start:'11:25',end:'12:25'}];
 d.constraints=[{id:'shopping',kind:'shopping',minMinutes:120,maxMinutes:180,timelineIds:['a','transfer','b']}];
 assert.equal(scheduleReport(t).windows[0].minutes,135);assert.ok(scheduleReport(t).valid);
 d.constraints[0].minMinutes=140;assert.equal(scheduleReport(t).valid,false);
 d.timeline[2].start='10:30';assert.equal(scheduleReport(t).windows[0].minutes,145);
});
test('operating cutoff is not last admission or discount; observed ETA invalidates short allocation',()=>{
 const t=make(),d=t.days[0];d.timeline=[{title:'gallery',start:'15:15',end:'16:45',deadlines:[{kind:'closes',time:'17:00',source:'official',checkedAt:'2026-10-04'}]}];assert.ok(scheduleReport(t).valid);
 d.timeline[0].deadlines.push({kind:'discountStarts',time:'16:00',source:'official',checkedAt:'2026-10-04'});assert.equal(scheduleReport(t).valid,false);
 d.timeline=[{title:'walk',routeId:'r',start:'11:55',end:'12:10'}];t.routes=[{id:'r',observedDuration:{minutes:24,source:'map',checkedAt:'2026-10-04'}}];assert.equal(scheduleReport(t).valid,false);d.timeline[0].end='12:20';assert.ok(scheduleReport(t).valid);
});
test('in-trip changes preserve completed dates and enumerate adjacent consumers',()=>{
 const a=make(),b=structuredClone(a);b.days[1].timeline=[{start:'10:00',end:'11:00',title:'new'}];
 const o={date:'2026-10-05',actual:[{title:'Vasa visited',time:'10:30'}],by:'human report',at:'2026-10-05T09:00:00Z'};
 assert.deepEqual(changeReport(a,b,o).reviewDates,['2026-10-05','2026-10-06']);b.days[0].timeline=[{title:'overwritten'}];assert.equal(changeReport(a,b,o).valid,false);
});
test('history carries original timestamp only for matching past location; never current/future or moved coordinates',()=>{
 const t=make(),l={id:'city',name:'city',latitude:59,longitude:18,timezone:'Europe/Stockholm'};t.weatherLocations=[l];for(const d of t.days)d.weatherIds=['city'];
 const w={...l,requestKey:forecastRequestKey(l),coordinates:{latitude:59,longitude:18},fetchedAt:'2026-10-03T10:00:00Z',daily:t.days.map(d=>({date:d.date,min:5,max:10}))};
 const result=preservePastForecasts(t,[],[{file:'old.json',locations:[w]}],'2026-10-05T12:00:00Z');
 assert.deepEqual(result[0].daily.map(x=>x.date),['2026-10-04']);assert.equal(result[0].daily[0].originalFetchedAt,w.fetchedAt);
 assert.deepEqual(preservePastForecasts(t,[],[{locations:null},{locations:[{...w,daily:null}]},{locations:[{...w,fetchedAt:'2026-10-06T10:00:00Z'}]}],'2026-10-05T12:00:00Z'),[]);
 assert.deepEqual(preservePastForecasts(t,[],[{locations:[{...w,fetchedAt:'bad-time'}]}],'2026-10-05T12:00:00Z'),[]);
 t.weatherLocations[0].latitude=60;assert.deepEqual(preservePastForecasts(t,[],[{file:'old',locations:[w]}],'2026-10-05T12:00:00Z'),[]);
});
test('assistant reports full cross-day units, source hashes and truthful budget omissions',()=>{
 const e={units:[{id:'4',date:'2026-10-04',contentHash:'full4',sourceIds:['wiki4']},{id:'5',date:'2026-10-05',contentHash:'full5',sourceIds:['wiki5']}]};
 assert.ok(assistantCoverage(e,{units:e.units,complete:true}).valid);
 assert.equal(assistantCoverage(e,{units:[{...e.units[0],contentHash:'title-only'}],complete:true}).valid,false);
 assert.equal(assistantCoverage(e,{units:[{...e.units[0],date:'2026-10-05'},e.units[1]],complete:true}).valid,false);
 assert.ok(assistantCoverage(e,{units:[e.units[0]],omitted:[{id:'5',reason:'token budget'}],budgetLimited:true,complete:false}).valid);
});
test('paused project/runtime prevents real MCP side effects before networking and needs human resume',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'travel-channel-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const project=path.join(dir,'project'),runtime=path.join(dir,'runtime');init(project,'x','2026-10-04','2026-10-06');
 setChannel(project,{state:'paused',reason:'user',by:'user',runtime});
 assert.throws(()=>assertResearchEnabled(project,runtime),/paused/);
 for(const action of [()=>mcp.install(runtime),()=>mcp.start(runtime),()=>mcp.login(runtime),()=>mcp.status(runtime),()=>mcp.search(project,'coffee',{runtime}),()=>mcp.extract(project,'coffee',[],{runtime})])await assert.rejects(action,/paused/);
 assert.throws(()=>setChannel(project,{state:'enabled',reason:'retry',by:'agent',runtime}),/Explicit user/);
 setChannel(project,{state:'enabled',reason:'human resumed',by:'user',runtime,explicitUserResume:true});assert.doesNotThrow(()=>assertResearchEnabled(project,runtime));
});
