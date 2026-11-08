import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {auditAtlas} from './audit-asset-atlas.mjs';
import {hash,changeAtlas,readAtlas} from './asset-atlas-store.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-registration-'));
const asset = {
  id:'test.icon',object_id:'test',purpose:'action-icon',owner:'fixture',priority:'P1',stage:'acquired',spec:'assets/spec.md',
  source:{kind:'generated',version:'v1',files:[]},consumers:[],references:[],desired_release:null,
  gates:Object.fromEntries(['concept','purpose','technical','rights'].map(k=>[k,{status:'pending',evidence:[]}])),
  atlas:{name:'行动图标',category:'图标',registration_role:'deliverable',requirement:'用于测试操作按钮的行动图标，核对完整轮廓与实际使用尺寸。',usage_key:'primary',current_version:'v1',versions:[]}
};
let checks = 0;
function write(assets, extra = {}) {
  fs.writeFileSync(path.join(root,'assets/catalog.json'), JSON.stringify({schema_version:1,assets,atlas:{schema_version:1,reviews:[],events:[],scenes:[],...extra}}));
}
function expect(code) {
  assert(auditAtlas(root).errors.some(e=>e.code===code), code);
  checks++;
}
try {
  for (const dir of ['assets','Game/assets','maintenance']) fs.mkdirSync(path.join(root,dir),{recursive:true});
  fs.writeFileSync(path.join(root,'maintenance/project-config.json'),JSON.stringify({project:{id:'fixture',name:'测试'},assets:{directory:'assets'},engine:{directory:'Game'}}));
  fs.writeFileSync(path.join(root,'assets/atlas-pages.json'),JSON.stringify({schema_version:1,pages:[]}));
  fs.writeFileSync(path.join(root,'assets/atlas-media-archive.json'),JSON.stringify({schema_version:1,files:[]}));
  fs.writeFileSync(path.join(root,'assets/spec.md'),'# 测试用途');
  fs.writeFileSync(path.join(root,'assets/icon.png'),'fixture image bytes');
  const media={path:'assets/icon.png',sha256:hash(Buffer.from('fixture image bytes'))};
  asset.source.files=[media];asset.atlas.versions=[{id:'v1',kind:'candidate',label:'候选',files:[media]}];
  write([asset]);assert.equal(auditAtlas(root).result,'pass');checks++;
  const missingName=structuredClone(asset);missingName.atlas.name=missingName.id;write([missingName]);expect('unclear-name');
  const duplicate=structuredClone(asset);duplicate.id='test.second';duplicate.atlas.usage_key='secondary';
  write([asset,duplicate]);expect('unexplained-duplicate');
  const original=structuredClone(asset);original.atlas.reuse_with=[duplicate.id];original.atlas.reuse_note='两个明确不同的按钮用途复用相同图片';duplicate.atlas.reuse_with=[original.id];duplicate.atlas.reuse_note=original.atlas.reuse_note;
  write([original,duplicate]);assert.equal(auditAtlas(root).result,'pass');checks++;
  duplicate.atlas.usage_key='primary';write([original,duplicate]);expect('duplicate-purpose');
  const source=structuredClone(asset);source.atlas.registration_role='source';write([source]);expect('orphan-source');
  const child=structuredClone(asset);child.atlas.parent_ids=['missing'];write([child]);expect('parent-reference');
  child.atlas.parent_ids=[child.id];write([child]);expect('source-cycle');
  child.atlas.parent_ids=[];child.atlas.versions[0].binding={source:'sheet'};write([child]);expect('missing-source-relation');
  const procedural=structuredClone(asset);procedural.source={kind:'procedural',version:'working-tree',files:[]};procedural.atlas.versions=[];procedural.atlas.registration_role='procedural';write([procedural]);expect('unclear-procedural');
  const accepted=structuredClone(asset);accepted.stage='ready';write([accepted]);expect('unsupported-acceptance');
  write([asset],{audit_targets:[{path:'Game/feedback.gd'}]});expect('missing-registration');
  fs.writeFileSync(path.join(root,'Game/content.json'),JSON.stringify({skills:[{id:'new'}]}));
  write([asset],{coverage_rules:[{path:'Game/content.json',collection:'skills',prefix:'fx.skill.'}]});expect('missing-registration');
  write([asset]);fs.writeFileSync(path.join(root,'Game/assets/orphan.png'),'unregistered engine bytes');expect('missing-registration');fs.unlinkSync(path.join(root,'Game/assets/orphan.png'));
  const audio=structuredClone(asset);fs.writeFileSync(path.join(root,'assets/sound.wav'),'audio');audio.source.files=[{path:'assets/sound.wav',sha256:hash(Buffer.from('audio'))}];audio.atlas.versions[0].files=audio.source.files;write([audio]);expect('media-category');
  write([asset]);const before=fs.readFileSync(path.join(root,'assets/catalog.json'));
  assert.throws(()=>changeAtlas(root,readAtlas(root).revision,{operation:'curate',patches:[{asset_id:asset.id,atlas:{gates:{}}}]}),/越界/);
  assert.equal(hash(fs.readFileSync(path.join(root,'assets/catalog.json'))),hash(before));checks++;
  console.log(JSON.stringify({result:'pass',checks}));
} finally {
  // Only the verified temporary fixture created above is removed.
  const target=path.resolve(root);
  if (!target.startsWith(path.resolve(os.tmpdir())+path.sep) || !path.basename(target).startsWith('atlas-registration-')) throw Error('临时夹具路径越界');
  fs.rmSync(target,{recursive:true,force:true});
}
