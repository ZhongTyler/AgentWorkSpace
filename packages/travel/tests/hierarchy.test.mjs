import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ROOT, inputHash, inside} from '../scripts/lib/core.mjs';
import {makeDemo} from '../scripts/make-demo.mjs';
import {build} from '../scripts/lib/generate.mjs';

test('shared visual roles ship in the offline build and source fingerprint',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'travel-hierarchy-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const project=path.join(root,'trip');makeDemo(project);build(project);
 const html=fs.readFileSync(inside(project,'build/index.html'),'utf8');
 for(const role of ['daily-masthead','experience-aside','duration-card','route-card','booking-card','stay-card','meal-role','wiki-detail','weather-temp'])assert.ok(html.includes(role),role);
 assert.ok(html.includes('表格可左右滑动'));
 assert.ok(html.includes('相关时段'));
 assert.ok(!html.includes('applyPresentation'),'no project override required');
 assert.equal(inputHash(project).length,64);
 const core=fs.readFileSync(path.join(ROOT,'scripts/lib/core.mjs'),'utf8');
 assert.ok(core.includes('web/hierarchy.css'),'style changes must invalidate build receipts');
 const audit=fs.readFileSync(path.join(ROOT,'scripts/browser-audit.mjs'),'utf8');
 assert.ok(audit.includes('D.days.slice(1)'),'global date-specific views covered');
 assert.ok(audit.includes("editorReview:'pending"),'script never claims visual approval');
});
