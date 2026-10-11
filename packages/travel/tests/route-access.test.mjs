import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectRouteAccess,routeAccessReport} from '../scripts/lib/route-access.mjs';
import {routeUrl,routeHash} from '../scripts/lib/core.mjs';

const places=[{id:'terminal',name:'Airport Terminal',kind:'airport',address:'Arrival hall',accessGroup:'airport-a'},{id:'hotel',name:'Hotel',kind:'hotel',address:'Hotel door',accessGroup:'airport-a'}];
const leg=()=>({id:'transfer',date:'2027-01-01',mode:'official',stops:['terminal','hotel'],officialUrl:'https://example.org/airport-map',access:{kind:'indoor',steps:['Follow Hotel signs in the public concourse.'],constraints:'Concourse opening hours apply; level not yet verified.',checkedAt:'2027-01-01',sources:[{url:'https://example.org/hotel-arrival',claim:'Public concourse connection'}]}});

test('same complex cannot silently become ordinary walking; airport keyword alone only requests review',()=>{
 const r=leg();delete r.access;r.mode='walking';
 assert.match(inspectRouteAccess(r,places).errors.join(' '),/缺少access/);
 const independent=places.map(({accessGroup,...p})=>p);
 assert.equal(inspectRouteAccess(r,independent).status,'needs-review');
 assert.equal(inspectRouteAccess(r,independent).errors.length,0);
});
test('indoor and mixed legs never produce street directions or accept empty evidence',()=>{
 for(const kind of ['indoor','mixed']){
  const r=leg();r.access.kind=kind;r.mode='walking';
  assert.throws(()=>routeUrl({places},r),/室内\/混合/);
  r.mode='official';r.officialUrl='https://www.google.com/maps/dir/?api=1';
  assert.throws(()=>routeUrl({places},r),/街道导航/);
 }
 for(const key of ['steps','sources','constraints','checkedAt']){const r=leg();delete r.access[key];assert.ok(inspectRouteAccess(r,places).errors.length);}
 const r=leg();r.access.sources[0].url='https://example.org/?token=private';assert.ok(inspectRouteAccess(r,places).errors.length);
});
test('documented outdoor transfers remain navigable and guidance changes invalidate route review hash',()=>{
 const r=leg(),t={places};const initial=routeHash(t,r);
 assert.equal(routeUrl(t,r),'https://example.org/airport-map');
 r.access.steps.push('Use the lift.');assert.notEqual(routeHash(t,r),initial);
 r.access.kind='outdoor';r.mode='walking';assert.equal(new URL(routeUrl(t,r)).searchParams.get('travelmode'),'walking');
 const report=routeAccessReport([r],places);assert.equal(report.documented,1);assert.equal(report.errors.length,0);
 const revised=structuredClone(t);revised.places[0].accessGroup='another-building';assert.notEqual(routeHash(t,r),routeHash(revised,r));
});
