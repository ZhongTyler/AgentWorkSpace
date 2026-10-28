import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {LunarUtil}=require('lunar-javascript');
const branches='子丑寅卯辰巳午未申酉戌亥';
export const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
export const hash=v=>crypto.createHash('sha256').update(stable(v)).digest('hex');
export function factPack(chart){
  const body=chart.charts||chart, facts=[];
  const add=(system,kind,key,value,text,source)=>{const id='DF-'+hash([system,kind,key]).slice(0,16);facts.push({id,system,kind,key,value,text,source});};
  const b=body.bazi, rawZ=body.ziwei;
  // Accept the reviewed case projection as well as the original engine record.
  const z=rawZ?.native?rawZ:rawZ?.palaces?{native:{
    earthlyBranchOfSoulPalace:rawZ.soulBranch,earthlyBranchOfBodyPalace:rawZ.bodyBranch,
    palaces:rawZ.palaces.map((p,index)=>({...p,index,earthlyBranch:p.earthlyBranch||p.branch}))}}:rawZ;
  if(b?.pillars){
    const day=b.dayMaster||b.pillars.day.ganzhi[0];
    if(!'甲乙丙丁戊己庚辛壬癸'.includes(day)||day.length!==1)throw Error('invalid_day_master');
    add('bazi','day_master','dayMaster',day,'本命日干：'+day,'calculation.bazi');
    for(const stem of '甲乙丙丁戊己庚辛壬癸'){
      const value=LunarUtil.SHI_SHEN[day+stem];
      add('bazi','ten_god','stem:'+stem,{dayStem:day,otherStem:stem,tenGod:value},stem+'相对本命'+day+'为'+value,'lunar-javascript 1.7.7 LunarUtil.SHI_SHEN');
    }
    for(const [name,p]of Object.entries(b.pillars)){
      const gz=p.ganzhi;
      if(typeof gz!=='string'||gz.length!==2||!branches.includes(gz[1]))throw Error('invalid_pillar_for_fact_pack');
      const hidden=LunarUtil.ZHI_HIDE_GAN[gz[1]].map(stem=>({stem,tenGod:LunarUtil.SHI_SHEN[day+stem]}));
      const value={ganzhi:gz,stemTenGod:LunarUtil.SHI_SHEN[day+gz[0]],hidden};
      add('bazi','pillar',name,value,name+'柱'+gz+'：天干'+value.stemTenGod+'；藏干'+hidden.map(x=>x.stem+x.tenGod).join('、'),'calculation.bazi.pillars + pinned relation table');
    }
    for(const c of b.yun?.cycles||b.cycles||[]){
      const value={ganzhi:c.ganzhi,startYear:c.startYear,endYear:c.endYear,tenGod:LunarUtil.SHI_SHEN[day+c.ganzhi[0]]};
      add('bazi','time_layer','dayun:'+c.index,value,'八字大运'+c.ganzhi+'，'+c.startYear+'—'+c.endYear+'；干相对本命为'+value.tenGod,'calculation.bazi.yun');
    }
  }
  const palaces=z?.native?.palaces;
  if(z?.native)add('ziwei','framework','soul_body',{soul:z.native.earthlyBranchOfSoulPalace,body:z.native.earthlyBranchOfBodyPalace},'命宫地支'+z.native.earthlyBranchOfSoulPalace+'；身宫地支'+z.native.earthlyBranchOfBodyPalace,'calculation.ziwei.native');
  if(palaces){
    if(palaces.length!==12||new Set(palaces.map(p=>p.earthlyBranch)).size!==12||palaces.some(p=>!branches.includes(p.earthlyBranch)))throw Error('invalid_palace_ring');
    for(const p of palaces){
      const i=branches.indexOf(p.earthlyBranch),around=offset=>palaces.find(x=>x.earthlyBranch===branches[(i+offset)%12]);
      const rel={palace:p.name,branch:p.earthlyBranch,opposite:around(6).name,trines:[around(4).name,around(8).name]};
      add('ziwei','palace_relation',p.name,rel,p.name+'对宫为'+rel.opposite+'；三合宫为'+rel.trines.join('、'),'calculation.ziwei.native.palaces / branch ring');
      for(const category of ['majorStars','minorStars','adjectiveStars'])for(const s of p[category]||[]){
        const value={palace:p.name,star:s.name,brightness:s.brightness||null,mutagen:s.mutagen||null,layer:'natal'};
        add('ziwei','star',p.name+':'+s.name,value,p.name+'本命'+s.name+(s.brightness?'（'+s.brightness+'）':'')+(s.mutagen?'，生年化'+s.mutagen:''),'calculation.ziwei.native.palaces');
      }
      if(p.decadal)add('ziwei','time_layer','decadal:'+p.name,{palace:p.name,...p.decadal},'紫微大限'+p.decadal.heavenlyStem+p.decadal.earthlyBranch+'在'+p.name+'，年龄段'+(p.decadal.range||[]).join('—'),'calculation.ziwei.native.palaces.decadal');
    }
  }
  for(const [index,snapshot]of (chart.snapshots||[]).entries())for(const [layer,value]of Object.entries(snapshot.bazi||{})){
    if(value?.ganzhi)add('bazi','time_layer','snapshot:'+index+':'+layer,value,'八字切片'+index+'的'+layer+'：'+value.ganzhi,'calculation.snapshots.bazi');
  }
  const timeEntries=[
    ...(rawZ?.transit?[{key:'transit',asOf:chart.request?.transit,ziwei:rawZ.transit}]:[]),
    ...(chart.snapshots||[]).map((s,i)=>({...s,key:'snapshot:'+i,asOf:s.asOf||s.date||s.target})),
    ...(chart.time_slices||[]).map((s,i)=>({...s,key:'slice:'+i,asOf:s.asOf||s.date||null}))
  ];
  for(const t of timeEntries){
    const year=t.year??(Number(String(t.asOf?.date||t.asOf||'').slice(0,4))||null);
    if(year!==null&&(!Number.isInteger(year)||year<1900||year>2100))throw Error('invalid_snapshot_year');
    if(t.bazi)for(const [layer,item]of Object.entries(t.bazi)){
      const ganzhi=typeof item==='string'?item:item?.ganzhi;
      if(!ganzhi)continue;
      // Keep the legacy snapshot fact above, and add an explicit dated view.
      const value={year,asOf:t.asOf??null,layer,ganzhi};
      add('bazi','dated_layer',t.key+':'+layer,value,(year??'指定时刻')+'八字'+layer+'：'+ganzhi,'input.'+t.key+'.bazi');
    }
    for(const [layer,item]of Object.entries(t.ziwei||{})){
      if(!item?.palaceNames)continue;
      if(!palaces||item.palaceNames.length!==12||!Number.isInteger(item.index)||item.index<0||item.index>11)throw Error('invalid_transit_palace_map');
      if(!Array.isArray(item.mutagen)||item.mutagen.length!==4)throw Error('invalid_transit_mutagen');
      const positions=item.palaceNames.map((name,index)=>({index,branch:palaces[index].earthlyBranch,natalPalace:palaces[index].name,layerPalace:name}));
      const transformations=item.mutagen.map((star,index)=>({star,mutagen:['禄','权','科','忌'][index],
        positions:palaces.filter(p=>['majorStars','minorStars','adjectiveStars'].some(k=>(p[k]||[]).some(s=>s.name===star))).map(p=>({branch:p.earthlyBranch,natalPalace:p.name,layerPalace:item.palaceNames[p.index]}))}));
      const value={year,asOf:t.asOf??null,layer,stem:item.heavenlyStem,branch:item.earthlyBranch,
        soulPosition:positions[item.index],positions,transformations,
        flowStars:(item.stars||[]).flatMap((ss,index)=>ss.length?[{...positions[index],stars:ss.map(s=>s.name)}]:[])};
      add('ziwei','dated_layer',t.key+':'+layer,value,(year??'指定时刻')+'紫微'+layer+'，'+item.heavenlyStem+item.earthlyBranch+'，命宫在本命'+value.soulPosition.natalPalace+'；'+transformations.map(x=>x.star+'化'+x.mutagen).join('、'),'input.'+t.key+'.ziwei / iztro indexed palace order');
    }
  }
  return {schema_version:1,kind:'computed_fact_pack',chart_sha256:hash(chart),facts,
    limits:['Computed relations under the pinned engine conventions, not event predictions.','Input/background/outcomes are not relabelled as engine facts.','Unbound free prose still requires semantic review.']};
}

// A question view omits auxiliary natal stars and unrelated years, never a requested year.
export function relevantFacts(chart,{system='both',years=[],layers=['cycle','annual','decadal','yearly']}={}){
  if(!['bazi','ziwei','both'].includes(system)||!Array.isArray(years)||years.some(y=>!Number.isInteger(y)||y<1900||y>2100)||new Set(years).size!==years.length)throw Error('invalid_fact_scope');
  if(!Array.isArray(layers)||!layers.length||layers.some(x=>!['cycle','annual','decadal','yearly','smallLuck','age','monthly','daily','hourly'].includes(x))||new Set(layers).size!==layers.length)throw Error('invalid_time_layers');
  const pack=factPack(chart),systems=system==='both'?['bazi','ziwei']:[system];
  const selected=pack.facts.filter(f=>systems.includes(f.system)&&
    (f.kind!=='dated_layer'||layers.includes(f.value.layer)&&(!years.length||years.includes(f.value.year)))&&
    !(f.kind==='ten_god')&&
    !(f.kind==='time_layer'&&f.key.startsWith('snapshot:')));
  const coverageYears=years.length?years:[...new Set(selected.filter(f=>f.kind==='dated_layer').map(f=>f.value.year))];
  const coverage=systems.flatMap(s=>coverageYears.map(year=>({system:s,year,
    layers:selected.filter(f=>f.system===s&&f.kind==='dated_layer'&&f.value.year===year).map(f=>({layer:f.value.layer,fact_id:f.id,asOf:f.value.asOf})),
    scope:'dated_snapshot_not_all_year_boundaries'})));
  return {schema_version:1,kind:'question_fact_view',chart_sha256:pack.chart_sha256,system,years,
    facts:selected,coverage,omitted_fact_count:pack.facts.length-selected.length,full_pack_available:true,limits:pack.limits};
}

// Project the supplied layer map into the exact palace axis the question asks about.
// This adds no astrological meaning and leaves the original fact view and IDs unchanged.
export function palaceFocus(view,palaceNames){
  if(!Array.isArray(palaceNames)||palaceNames.some(p=>typeof p!=='string'))throw Error('palace_names_required');
  return view.facts.filter(f=>f.system==='ziwei'&&f.kind==='dated_layer').flatMap(f=>palaceNames.flatMap(name=>{
    const main=f.value.positions.find(p=>p.layerPalace===name);if(!main)return [];
    const index=branches.indexOf(main.branch),at=offset=>f.value.positions.find(p=>p.branch===branches[(index+offset)%12]);
    const position=p=>({...p,
      natalStars:view.facts.filter(s=>s.system==='ziwei'&&s.kind==='star'&&s.value.palace===p.natalPalace).map(s=>({fact_id:s.id,...s.value})),
      layerTransformations:f.value.transformations.filter(t=>t.positions.some(q=>q.branch===p.branch)).map(t=>({star:t.star,mutagen:t.mutagen})),
      flowStars:f.value.flowStars.find(x=>x.branch===p.branch)?.stars||[]});
    return [{fact_id:f.id,year:f.value.year,asOf:f.value.asOf,layer:f.value.layer,questionPalace:name,
      main:position(main),opposite:position(at(6)),trines:[position(at(4)),position(at(8))],
      identity:'computed_relation_not_event_prediction'}];
  }));
}
export function auditFactAssertions(pack,assertions){
  const issues=[],ids=new Set();
  for(const a of assertions||[]){
    const f=pack.facts.find(f=>f.id===a.fact_id);
    if(!a.id||ids.has(a.id)){issues.push({code:'assertion_identity_required',id:a.id});continue;}ids.add(a.id);
    if(!f||stable(f.value)!==stable(a.value)||a.system!==f.system)issues.push({code:'derived_fact_mismatch',id:a.id});
    if(a.statement!==undefined&&a.statement!==f?.text)issues.push({code:'fact_text_must_use_renderer',id:a.id});
  }
  return issues;
}
export function renderFactAssertions(pack,assertions){
  if(auditFactAssertions(pack,assertions).length)throw Error('invalid_fact_assertions');
  return assertions.map(a=>pack.facts.find(f=>f.id===a.fact_id).text).join('\n');
}
