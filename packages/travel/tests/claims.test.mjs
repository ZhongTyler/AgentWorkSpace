import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {inspectClaims,renderNarrative,compileWiki} from '../scripts/lib/claims.mjs';
import {makeDemo} from '../scripts/make-demo.mjs';import {ROOT,read,write,inside,loadTrip} from '../scripts/lib/core.mjs';
import {build} from '../scripts/lib/generate.mjs';
const claim=()=>read(path.join(ROOT,'examples/claims.json'))[0];
const base=()=>({knowledge:[{id:'demo-guide'}],claims:[claim()],journal:[{id:'j',date:'2027-05-01',text:'{{claim:synthetic-arrival}}'}]});
test('registered claims link exact source support and compile before the raw-reading footer',()=>{
  const trip=base(),r=inspectClaims(trip,[],[],'2026-10-20');assert.equal(r.valid,true);assert.equal(r.warnings.length,0);assert.equal(r.used.length,1);
  assert.match(renderNarrative(trip,trip.journal[0].text),/处理行李/);
  const wiki=compileWiki(trip,{id:'demo-guide'},'# Guide\n{{claim:synthetic-arrival}}\n## 原始笔记与阅读指引\nRaw footer');
  assert.ok(wiki.indexOf('## 结论与依据')<wiki.indexOf('## 原始笔记'));assert.match(wiki,/https:\/\/example.com\/travel-note/);assert.match(wiki,/Synthetic fixture paragraph/);
});
test('broken references, unsafe links, false supported state and unresolved counterevidence fail',()=>{
  for(const mutate of [t=>t.claims[0].evidence=[],t=>t.claims[0].evidence[0].url='https://example.com/?token=private',t=>t.claims[0].evidence[0].locator='',t=>t.claims[0].wikiIds=['unknown'],t=>t.claims[0].evidence.push({...t.claims[0].evidence[0],relation:'contradicts'}),t=>t.claims[0].text='{{claim:synthetic-arrival}}']){
    const trip=base();mutate(trip);assert.equal(inspectClaims(trip,[],[],'2026-10-20').valid,false);
  }
  assert.equal(inspectClaims(base(),[{id:'w',text:'{{claim:unknown}}'}],[],'2026-10-20').valid,false);
});
test('scope, staleness and raw revision are not promoted into current verification',()=>{
  const trip=base();trip.claims[0].reviewAfter='2026-01-02';trip.claims[0].validUntil='2026-12-31';
  const r=inspectClaims(trip,[],[],'2026-10-20');assert.equal(r.valid,true);assert.equal(r.warnings.length,2);
  const e=trip.claims[0].evidence[0];Object.assign(e,{rawId:'note',rawHash:'old'});
  assert.equal(inspectClaims(trip,[],[{id:'note',url:e.url,rawHash:'new',review:'review.json'}],'2026-10-20').valid,false);
  e.rawHash='new';assert.equal(inspectClaims(trip,[],[{id:'note',url:e.url,rawHash:'new',review:'review.json'}],'2026-10-20').valid,true);
  assert.throws(()=>inspectClaims(trip,[],[],'2026-02-31'),/asOf/);
});
test('build projects the same traceable Wiki to Markdown and browser without rewriting sources',t=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'travel-claims-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
  const project=path.join(parent,'trip');makeDemo(project);const trip=loadTrip(project);trip.claims=[claim()];trip.journal[1].text='{{claim:synthetic-arrival}}';write(inside(project,'trip.json'),trip);
  const before=fs.readFileSync(inside(project,'trip.json'));build(project);const data=read(inside(project,'generated/data.json'));
  assert.equal(fs.readFileSync(inside(project,'generated/wiki/demo-guide.md'),'utf8'),data.knowledge[0].text);
  assert.match(data.knowledge[0].text,/结论与依据/);assert.deepEqual(fs.readFileSync(inside(project,'trip.json')),before);
});
test('social-note links remain at the end, with a reading guide instead of duplicated inline links',()=>{
  const trip=base();trip.claims[0].evidence[0].url='https://www.xiaohongshu.com/explore/699df838000000002801d2de';
  const rendered=compileWiki(trip,{id:'demo-guide'},'# Guide\n{{claim:synthetic-arrival}}');
  assert.ok(rendered.indexOf('https://www.xiaohongshu')>rendered.indexOf('## 原始笔记与阅读指引'));
  assert.equal(rendered.split(trip.claims[0].evidence[0].url).length-1,1);
});
