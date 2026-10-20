import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {renderFacts,factValue,inspectNarratives,expandNarratives} from '../scripts/lib/narrative.mjs';
import {makeDemo} from '../scripts/make-demo.mjs';
import {loadTrip,inside,write,read} from '../scripts/lib/core.mjs';
import {build} from '../scripts/lib/generate.mjs';
import {semanticAudit} from '../scripts/lib/semantic.mjs';
const sample=()=>({title:'示例',orders:[{id:'lunch',date:'2027-05-01',status:'booked',placeId:'cafe',start:'12:00',end:'13:00'}],catalog:[{id:'c',placeId:'cafe',price:{min:20,max:30,currency:'GBP',basis:'person'}}],journal:[{id:'j',date:'2027-05-01',placeIds:['cafe'],text:'预约在 {{fact:orders/lunch/start}}，预算 {{fact:catalog/c/price}}。'}]});
test('current anchors flow into prose without copying or editing original text',()=>{
  const trip=sample(),before=structuredClone(trip),out=expandNarratives(trip,structuredClone(trip));
  assert.match(out.journal[0].text,/12:00/);assert.match(out.journal[0].text,/20–30 GBP \/ 人/);assert.deepEqual(trip,before);
  trip.orders[0].start='13:00';assert.match(renderFacts(trip,trip.journal[0].text),/13:00/);
  assert.equal(renderFacts(trip,renderFacts(trip,trip.journal[0].text)),renderFacts(trip,trip.journal[0].text));
});
test('bad IDs, private fields, recursive values, objects and malformed refs fail closed',()=>{
  const trip=sample();
  for(const ref of ['orders/missing/start','orders/lunch/evidence','trip/preferences','catalog/c/constructor','orders/lunch/amount','trip/start'])assert.throws(()=>factValue(trip,ref));
  assert.throws(()=>renderFacts(trip,'{{fact:orders/lunch/start'),/Malformed/);
  trip.orders[0].start='{{fact:orders/lunch/start}}';assert.throws(()=>factValue(trip,'orders/lunch/start'),/another reference/);
});
test('copied booking times and prices become scoped review leads, not fabricated hard errors',()=>{
  const trip=sample();trip.journal[0].text='预约12:30，午餐60 GBP。';
  const report=inspectNarratives(trip);assert.equal(report.valid,true);assert.equal(report.warnings.length,2);
  trip.journal[0].text='预约 {{fact:orders/lunch/start}}，预算 {{fact:catalog/c/price}}';assert.equal(inspectNarratives(trip).warnings.length,0);
  trip.journal[0].text='晚上另去20:30的音乐会';assert.equal(inspectNarratives(trip).warnings.length,0);
});
test('generated site and Wiki consume live bindings, unknown refs block build, old projects stay compatible',t=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'travel-narrative-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
  const project=path.join(parent,'trip');makeDemo(project);const trip=loadTrip(project);
  trip.journal[1].text='午餐预约 {{fact:orders/order-one/start}}。';write(inside(project,'trip.json'),trip);
  fs.appendFileSync(inside(project,'knowledge/demo.md'),'\n集合：{{fact:orders/order-one/start}}\n');
  const original=fs.readFileSync(inside(project,'trip.json'));build(project);
  const data=read(inside(project,'generated/data.json'));assert.match(data.journal[1].text,/12:00/);assert.match(data.knowledge[0].text,/集合：12:00/);
  assert.deepEqual(fs.readFileSync(inside(project,'trip.json')),original);assert.equal(semanticAudit(project).references.length,2);
  fs.appendFileSync(inside(project,'knowledge/demo.md'),'{{fact:orders/none/start}}');assert.throws(()=>build(project),/Unknown fact entity/);
});
test('fixed booking and itinerary windows cannot silently disagree',()=>{
  const trip=sample();trip.days=[{date:'2027-05-01',timeline:[{start:'11:00',end:'11:30',placeId:'cafe'}]}];
  assert.ok(inspectNarratives(trip).warnings.some(w=>w.kind==='booking-window'));
  trip.days[0].timeline[0].end='13:30';assert.equal(inspectNarratives(trip).warnings.length,0);
});
