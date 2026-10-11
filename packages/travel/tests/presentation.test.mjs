import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {makeDemo} from '../scripts/make-demo.mjs';
import {build} from '../scripts/lib/generate.mjs';
import {loadTrip,write,inside} from '../scripts/lib/core.mjs';

test('portable compact interface embeds shared route helpers without imports or changing facts',t=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'travel-layout-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const project=path.join(parent,'trip');makeDemo(project);
 const before=fs.readFileSync(inside(project,'trip.json')),result=build(project),html=fs.readFileSync(result.file,'utf8');
 assert.deepEqual(fs.readFileSync(inside(project,'trip.json')),before);
 assert.match(html,/function splitDirections/);assert.match(html,/function restoreDraft/);
 assert.doesNotMatch(html,/TEMPORARY_ROUTE_HELPERS|from ['"][^'"]*temporary-route/);
 assert.match(html,/当天工具/);assert.match(html,/地图路线/);assert.match(html,/data-draft-reset/);
 assert.doesNotMatch(html,/maps\.googleapis\.com|googletagmanager/);
});

test('transfer-only day builds without inventing projects or ground routes',t=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'travel-transfer-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const project=path.join(parent,'trip');makeDemo(project);const trip=loadTrip(project);
 trip.journal=[];trip.routes=[];trip.days.forEach(d=>d.routeIds=[]);write(inside(project,'trip.json'),trip);
 assert.ok(build(project).bytes>0);
 const data=JSON.parse(fs.readFileSync(inside(project,'generated/data.json'),'utf8'));assert.equal(data.journal.length,0);assert.equal(data.routes.length,0);
});

test('official indoor route keeps operator instructions instead of a Google ground route',t=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'travel-indoor-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const project=path.join(parent,'trip');makeDemo(project);const trip=loadTrip(project),route=trip.routes[0];
 route.mode='official';route.officialUrl='https://example.com/operator-arrival';
 route.access={kind:'indoor',steps:['Follow the signed public indoor concourse.'],constraints:'Use operator opening hours.',checkedAt:'2027-04-01',sources:[{url:route.officialUrl,claim:'Synthetic indoor transfer'}]};
 // This changes the reviewed route input; do not reuse its old review claim.
 delete route.review;write(inside(project,'trip.json'),trip);build(project);
 const data=JSON.parse(fs.readFileSync(inside(project,'generated/data.json'),'utf8')),actual=data.routes.find(r=>r.id===route.id);
 assert.equal(actual.mode,'official');assert.equal(actual.url,route.officialUrl);
 assert.deepEqual(actual.access.steps,route.access.steps);assert.doesNotMatch(actual.url,/google/);
});
