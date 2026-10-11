import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {blankTrip,write} from '../scripts/lib/core.mjs';
import {validate} from '../scripts/lib/validate.mjs';
import {quality} from '../scripts/lib/quality.mjs';

test('quality observes detail coverage, never declares semantic acceptance',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'travel-quality-'));
  try{
    const t=blankTrip('Quality fixture','2026-08-01','2026-08-01');
    t.journal=[{id:'a',date:t.start,kind:'experience',text:'Example',visit:{steps:['Look at the exhibit']},wikiIds:['topic']}];
    t.knowledge=[{id:'topic',path:'knowledge/topic.md'}];
    write(path.join(dir,'knowledge/topic.md'),'# Example\n\nContext.');write(path.join(dir,'trip.json'),t);
    const first=quality(dir);assert.equal(first.counts.experiencesWithSteps,1);assert.equal(first.counts.experiencesWithWiki,1);
    assert.equal(first.semanticAcceptance,'not-evaluated-by-script');
    delete t.journal[0].visit;delete t.journal[0].wikiIds;write(path.join(dir,'trip.json'),t);
    const second=quality(dir);assert.notEqual(first.inputHash,second.inputHash);assert.ok(second.hints.some(h=>h.kind==='depth-review'));
    t.catalog=[{id:'cafe',description:'以下为旧规划的预算参考，不是本轮核价。'}];write(path.join(dir,'trip.json'),t);
    assert.ok(quality(dir).hints.some(h=>h.kind==='catalog-process-prose'));
    t.catalog=[];
    t.presentation={headline:'A readable title'};t.journal[0].wikiIds=['missing-topic'];
    assert.ok(validate(t,dir).errors.some(e=>e.includes('missing-topic')));
    t.journal[0].wikiIds=['topic'];t.journal[0].visit={steps:[123]};
    assert.ok(validate(t,dir).errors.some(e=>e.includes('visit steps')));
    t.journal[0].visit={steps:['A real action']};t.presentation.headline=123;
    assert.ok(validate(t,dir).errors.some(e=>e.includes('headline must be text')));
  }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});
