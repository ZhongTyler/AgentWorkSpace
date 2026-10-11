import test from 'node:test';
import assert from 'node:assert/strict';
import {splitDirections,restoreDraft} from '../scripts/lib/temporary-route.mjs';
const places=Array.from({length:12},(_,i)=>({id:String(i),address:'Door '+i,mapUrl:'https://www.google.com/maps/search/?api=1&query_place_id=ChIJ'+i}));
test('mobile directions split with connecting endpoints, precise place IDs and no dropped stops',()=>{
 const stops=places.map(p=>p.id),snapshot=JSON.stringify(places),links=splitDirections(stops,'walking',places);
 assert.deepEqual(links.flatMap((s,i)=>i?s.stops.slice(1):s.stops),stops);
 assert.ok(links.every(s=>s.stops.length<=5&&s.href.length<=2048));
 assert.equal(new URL(links[0].href).searchParams.get('origin_place_id'),'ChIJ0');
 assert.equal(new URL(links[0].href).searchParams.get('waypoint_place_ids'),'ChIJ1|ChIJ2|ChIJ3');
 assert.equal(JSON.stringify(places),snapshot);
 assert.ok(splitDirections(stops,'transit',places).every(s=>s.stops.length===2));
});
test('missing points, unknown modes and overly long individual addresses fail without guessing',()=>{
 assert.throws(()=>splitDirections(['0','missing'],'walking',places));
 assert.throws(()=>splitDirections(['0','1'],'indoor',places));
 assert.throws(()=>splitDirections(['0','1'],'walking',places.map(p=>({...p,address:'x'.repeat(2100)}))));
 assert.deepEqual(splitDirections(['0'],'walking',places),[]);
});
test('draft cannot survive a changed source or unknown place, corrupt data and empty drafts are explicit',()=>{
 const raw=JSON.stringify({fingerprint:'v1',stops:['0','1']});
 assert.deepEqual(restoreDraft(raw,'v1',['0','1']),['0','1']);
 assert.equal(restoreDraft(raw,'v2',['0','1']),null);
 assert.equal(restoreDraft(raw,'v1',['0']),null);
 assert.equal(restoreDraft('{','v1',['0']),null);
 assert.deepEqual(restoreDraft('{"fingerprint":"v1","stops":[]}','v1',['0']),[]);
});
