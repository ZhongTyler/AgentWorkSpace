import assert from 'node:assert/strict';
import fs from 'node:fs';
import {shenshaFor,shenshaRules} from './shensha.mjs';
import {studyView} from './study-view.mjs';
process.env.TZ='Asia/Shanghai';
const input=JSON.parse(fs.readFileSync(new URL('./example.synthetic.json',import.meta.url),'utf8'));
const checks=[];
function test(name,fn){try{fn();checks.push({name,status:'PASS'});}catch(e){checks.push({name,status:'FAIL',error:e.message});}}
const make=(year,month,day,hour)=>Object.fromEntries(['year','month','day','hour'].map((k,i)=>[k,{ganzhi:[year,month,day,hour][i]}]));
let v;
test('public_fixture_has_expected_pillar_markers',()=>{
  v=studyView(input,{date:'2027-10-21',time:'12:00'});
  assert.deepEqual(Object.fromEntries(Object.entries(v.bazi.shensha.natal).map(([k,s])=>[k,s.map(x=>x.name)])),{year:['华盖'],month:['文昌贵人','驿马'],day:['阳刃','将星'],hour:['驿马']});
});
test('natal_markers_do_not_change_when_transit_changes',()=>{assert.deepEqual(v.bazi.shensha.natal,studyView(input,{date:'2031-02-08',time:'23:00'}).bazi.shensha.natal);});
test('flow_uses_birth_day_stem_not_transit_day_stem',()=>{assert(v.bazi.shensha.flow.yearly.some(s=>s.name==='金舆'&&s.bases[0].value==='丙'&&s.bases[0].matched==='未'));});
test('yin_stem_blade_is_not_silently_invented',()=>{const p=make('庚子','甲申','乙卯','辛辰');assert(!shenshaFor(p,{probe:{ganzhi:'戊辰'}}).probe.some(s=>s.id==='blade'));});
test('xin_tianyi_keeps_both_noble_branches',()=>{const p=make('庚子','甲申','辛卯','丁酉');for(const gz of ['甲寅','丙午'])assert(shenshaFor(p,{probe:{ganzhi:gz}}).probe.some(s=>s.id==='tianyi'));});
test('tiande_trigram_mapping_is_a_branch_match',()=>{const p=make('庚子','乙卯','丁酉','丁亥');assert(shenshaFor(p,{probe:{ganzhi:'甲申'}}).probe.some(s=>s.id==='tiande'&&s.bases[0].target==='申'));assert(!shenshaFor(p,{probe:{ganzhi:'丁丑'}}).probe.some(s=>s.id==='tiande'));});
test('yuede_checks_stem_from_birth_solar_month',()=>{const p=make('庚子','甲申','丁酉','丁亥');assert(shenshaFor(p,{probe:{ganzhi:'壬午'}}).probe.some(s=>s.id==='yuede'));assert(!shenshaFor(p,{probe:{ganzhi:'丙午'}}).probe.some(s=>s.id==='yuede'));});
test('dual_year_day_basis_is_preserved_without_duplicate_sign',()=>{const p=make('庚子','甲申','丙辰','丁酉'),s=shenshaFor(p,{probe:{ganzhi:'甲寅'}}).probe.filter(s=>s.id==='horse');assert.equal(s.length,1);assert.deepEqual(s[0].bases.map(b=>b.label),['本命年支','本命日支']);});
test('unstarted_luck_has_empty_markers',()=>{assert.deepEqual(shenshaFor(make('庚辰','甲申','丙午','庚寅'),{decadal:null}).decadal,[]);});
test('selected_wenchang_variant_is_not_merged_with_other_book',()=>{const p=make('庚子','甲申','乙卯','丁酉');assert(shenshaFor(p,{probe:{ganzhi:'丙午'}}).probe.some(s=>s.id==='wenchang'));assert(!shenshaFor(p,{probe:{ganzhi:'丁亥'}}).probe.some(s=>s.id==='wenchang'));});
test('peach_filter_exposes_nayin_limitation',()=>{assert(shenshaRules.find(r=>r.id==='peach').note.includes('未作为完整咸池成例'));});
test('all_rules_have_unique_identity_and_visible_source_boundary',()=>{assert.equal(shenshaRules.length,12);assert.equal(new Set(shenshaRules.map(r=>r.id)).size,12);for(const r of shenshaRules){assert(r.source&&r.note&&r.basis);assert(!r.note.includes('必然'));}});
const result={status:checks.every(c=>c.status==='PASS')?'PASS_WITH_LIMITS':'FAIL',checks,synthetic_only:true,limits:['Selected source-table matches, not all App signs or independent chart validation.','No prediction claims.']};
console.log(JSON.stringify(result,null,2));if(result.status==='FAIL')process.exitCode=1;
