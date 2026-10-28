import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const cli=path.join(root,'chart.mjs');
const host=path.resolve(root,'../../../Life/Metaphysics/scripts/chart.mjs');
const base=JSON.parse(fs.readFileSync(path.join(root,'example.synthetic.json'),'utf8'));
const checks=[];
function run(input, {program=cli,timezone='Etc/UTC',reject=false,offline=false}={}) {
  const preload=offline?['--require',path.join(root,'offline-guard.cjs')]:[];
  const p=spawnSync(process.execPath,[...preload,program,'calculate','--input','-'],{
    input:JSON.stringify(input),encoding:'utf8',env:{...process.env,TZ:timezone},windowsHide:true,timeout:20000
  });
  if(p.error)throw p.error;
  if(reject){assert.equal(p.status,1,p.stdout);return JSON.parse(p.stderr).error;}
  assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);
}
function test(name,fn){try{fn();checks.push({name,status:'PASS'});}catch(e){checks.push({name,status:'FAIL',error:e.message});}}
const pillars=r=>Object.values(r.charts.bazi.pillars).map(x=>x.ganzhi);
const cfg=(ziwei={},bazi={})=>({conventions:{ziwei,bazi}});
test('runtime_integrity_without_engine_loading',()=>{
  const p=spawnSync(process.execPath,[host,'health'],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);
  const h=JSON.parse(p.stdout);assert.equal(h.engine_loaded,false);assert.equal(h.files_checked,1057);
});
test('public_upstream_ziwei_fixture_through_life_host',()=>{
  const r=run(base,{program:host});const a=r.charts.ziwei.native;
  assert.deepEqual(pillars(r),['庚辰','甲申','丙午','庚寅']);
  assert.equal(a.earthlyBranchOfSoulPalace,'午');assert.equal(a.earthlyBranchOfBodyPalace,'戌');
  assert.equal(a.fiveElementsClass,'木三局');assert.equal(a.soul,'破军');assert.equal(a.body,'文昌');
  assert.equal(a.palaces.length,12);assert.equal(new Set(a.palaces.map(p=>p.earthlyBranch)).size,12);
  assert.equal(a.palaces.flatMap(p=>p.majorStars).length,14);
  assert.equal(r.persisted,false);assert.equal(r.network,false);assert.equal(r.synthetic,true);
});
test('public_upstream_bazi_fixture',()=>{
  const r=run({...base,system:'bazi',date:'2005-12-23',time:'08:37'});
  assert.deepEqual(pillars(r),['乙酉','戊子','辛巳','壬辰']);
  assert.equal(r.charts.bazi.yun.cycles.length,10);
  assert.equal(r.charts.bazi.yun.cycles.flatMap(x=>x.annuals).find(x=>x.year===2023).ganzhi,'癸卯');
});
test('late_zi_both_bazi_sects_match_upstream_fixture',()=>{
  const x={...base,system:'bazi',date:'1988-02-15',time:'23:30'};
  assert.deepEqual(pillars(run(x)),['戊辰','甲寅','庚子','戊子']);
  assert.deepEqual(pillars(run({...x,...cfg({},{dayBoundary:'zi-start'})})),['戊辰','甲寅','辛丑','戊子']);
});
test('hko_2026_lichun_minute_bracket',()=>{
  const a=run({...base,system:'bazi',date:'2026-02-04',time:'04:01'});
  const b=run({...base,system:'bazi',date:'2026-02-04',time:'04:03'});
  assert.deepEqual(pillars(a).slice(0,2),['乙巳','己丑']);
  assert.deepEqual(pillars(b).slice(0,2),['丙午','庚寅']);
  assert(a.warnings.some(x=>x.startsWith('within_two_minutes')));
});
test('ziwei_year_boundary_is_configurable',()=>{
  const x={...base,system:'ziwei',date:'2026-02-10'};
  const n=run(x).charts.ziwei.native.rawDates.chineseDate.yearly.join('');
  const e=run({...x,...cfg({yearDivide:'exact'})}).charts.ziwei.native.rawDates.chineseDate.yearly.join('');
  assert.equal(n,'乙巳');assert.equal(e,'丙午');
});
test('ziwei_exact_year_is_date_based_not_bazi_instant',()=>{
  const r=run({...base,date:'2026-02-04',time:'01:30',...cfg({yearDivide:'exact'})});
  assert.equal(r.charts.bazi.pillars.year.ganzhi,'乙巳');
  assert.equal(r.charts.ziwei.native.rawDates.chineseDate.yearly.join(''),'丙午');
  assert(r.warnings.includes('iztro_exact_year_divide_uses_lichun_date_not_bazi_lichun_instant'));
});
test('solar_lunar_leap_roundtrip',()=>{
  const a=run({...base,date:'2023-04-05'});
  const b=run({...base,date:'2023-02-15',calendar:'lunar',leapMonth:true});
  assert.deepEqual(a.calendar,b.calendar);assert.deepEqual(a.charts,b.charts);
});
test('leap_month_half_split_and_late_zi_exception',()=>{
  const soul=(d,fix,time='03:30')=>run({...base,system:'ziwei',date:d,time,...cfg({fixLeap:fix})}).charts.ziwei.native.earthlyBranchOfSoulPalace;
  assert.equal(soul('2023-04-05',true),soul('2023-04-05',false));
  assert.notEqual(soul('2023-04-06',true),soul('2023-04-06',false));
  assert.equal(soul('2023-04-06',true,'23:30'),soul('2023-04-06',false,'23:30'));
});
test('ziwei_late_zi_current_vs_forward',()=>{
  const a=run({...base,system:'ziwei',time:'23:30'});
  const b=run({...base,system:'ziwei',time:'23:30',...cfg({dayDivide:'current'})});
  assert.notDeepEqual(a.charts.ziwei.native.palaces,b.charts.ziwei.native.palaces);
  assert.equal(a.charts.ziwei.timeIndex,12);
});
test('early_zi_and_hour_boundary_indexes',()=>{
  for(const [time,index] of [['00:00',0],['00:59',0],['01:00',1],['22:59',11],['23:00',12]])
    assert.equal(run({...base,system:'ziwei',time}).charts.ziwei.timeIndex,index);
});
test('explicit_transit_matches_public_upstream_decadal',()=>{
  const r=run({...base,system:'ziwei',transit:{date:'2023-08-19',time:'03:12'}});
  const h=r.charts.ziwei.transit;assert.equal(h.decadal.index,2);assert.equal(h.decadal.heavenlyStem,'庚');
  assert.equal(h.decadal.earthlyBranch,'辰');assert.equal(h.age.nominalAge,24);
  assert.deepEqual(h.decadal.mutagen,['太阳','武曲','太阴','天同']);
});
test('parent_timezone_cannot_change_chart',()=>{
  assert.deepEqual(run(base,{timezone:'America/New_York'}),run(base,{timezone:'Asia/Tokyo'}));
});
test('no_cross_call_configuration_leak',()=>{
  const before=run(base);run({...base,...cfg({algorithm:'zhongzhou',dayDivide:'current'})});assert.deepEqual(run(base),before);
});
test('both_engines_and_transit_work_with_network_and_subprocess_blocked',()=>{
  const r=run({...base,transit:{date:'2023-08-19',time:'03:12'}},{offline:true});
  assert.equal(r.charts.ziwei.transit.age.nominalAge,24);assert.equal(r.charts.bazi.yun.cycles.length,10);
});
test('unconfirmed_assumptions_are_not_user_preferences',()=>{
  assert.equal(run(base).status,'calculated_with_assumptions');
  assert.equal(run({...base,inputConfirmed:true,conventionsConfirmed:true}).status,'calculated_for_confirmed_input');
});
for(const [name,change,code] of [
  ['invalid_solar_day',{date:'2000-02-31'},'invalid_solar_day'],
  ['non_leap_century',{date:'1900-02-29'},'invalid_solar_day'],
  ['nonexistent_lunar_leap',{calendar:'lunar',date:'2024-02-15',leapMonth:true},'invalid_lunar_date_or_leap_month'],
  ['lunar_day_overflow',{calendar:'lunar',date:'2023-02-30',leapMonth:true},'invalid_lunar_date_or_leap_month'],
  ['unknown_lunar_leap_flag',{calendar:'lunar'},'lunar_leapMonth_flag_required'],
  ['foreign_timezone',{timezone:'UTC-05:00'},'unsupported_time_basis_resolve_timezone_dst_or_solar_time_first'],
  ['unresolved_dst',{timeBasis:'civil_dst'},'unsupported_time_basis_resolve_timezone_dst_or_solar_time_first'],
  ['true_solar_not_implemented',{timeBasis:'true_solar'},'unsupported_time_basis_resolve_timezone_dst_or_solar_time_first'],
  ['missing_gender',{gender:undefined},'invalid_gender'],
  ['invalid_time',{time:'24:00'},'invalid_time'],
  ['unknown_field',{extra:true},'unknown_input_field'],
  ['unsafe_implicit_settings',{preset:undefined},'explicit_preset_or_conventions_required'],
  ['unsupported_year',{date:'1800-01-01'},'date_outside_supported_range'],
  ['transit_before_birth',{transit:{date:'1999-12-31',time:'12:00'}},'transit_before_birth'],
  ['solar_leap_flag',{leapMonth:true},'leapMonth_requires_lunar']
])test(name,()=>assert.equal(run({...base,...change},{reject:true}),code));
test('gregorian_2000_leap_day_is_valid',()=>assert.equal(run({...base,date:'2000-02-29'}).calendar.lunar.day,25));
test('malformed_json_does_not_echo_private_input',()=>{
  const p=spawnSync(process.execPath,[host,'calculate','--input','-'],{input:'{"secret_birth_record":',encoding:'utf8'});
  assert.equal(p.status,1);assert.equal(JSON.parse(p.stderr).error,'invalid_json');assert(!p.stderr.includes('secret_birth_record'));
});
const out={status:checks.every(x=>x.status==='PASS')?'PASS_WITH_LIMITS':'FAIL',checks,
  scope:'public upstream fixtures and synthetic boundary checks; no real case or independent mobile-software parity',
  predictive_accuracy:'not_tested',private_cases_read:false};
console.log(JSON.stringify(out,null,2));if(out.status==='FAIL')process.exitCode=1;
