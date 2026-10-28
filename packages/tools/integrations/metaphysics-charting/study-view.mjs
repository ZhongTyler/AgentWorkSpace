import {createRequire} from 'node:module';
import {calculate} from './chart.mjs';
import {warnings as humanWarnings} from './render.mjs';
import {shenshaView} from './shensha.mjs';
const require=createRequire(import.meta.url);
const gan='甲乙丙丁戊己庚辛壬癸',zhi='子丑寅卯辰巳午未申酉戌亥';
export function studyView(input,asOf){
  const record=calculate({...input,system:'both',transit:asOf});
  const {Solar,LunarUtil}=require('lunar-javascript');
  const {util,astro}=require('iztro');
  const natal=record.calendar.solar.split(/[- :]/).map(Number);
  const e=Solar.fromYmdHms(...natal).getLunar().getEightChar();
  e.setSect(record.conventions.bazi.dayBoundary==='midnight'?2:1);
  const master=e.getDayGan();
  const relative=gz=>{
    if(!gz)return null;
    const stems=LunarUtil.ZHI_HIDE_GAN[gz[1]];
    return {ganzhi:gz,hiddenStems:stems,stemTenGod:LunarUtil.SHI_SHEN[master+gz[0]],
      branchTenGods:stems.map(g=>LunarUtil.SHI_SHEN[master+g]),
      fiveElements:LunarUtil.WU_XING_GAN[gz[0]]+LunarUtil.WU_XING_ZHI[gz[1]],
      nayin:LunarUtil.NAYIN[gz],voidBranches:LunarUtil.getXunKong(gz),
      growthStage:e._getDiShi(zhi.indexOf(gz[1]))};
  };
  const [yy,mm,dd]=asOf.date.split('-').map(Number),[hh,mi,ss=0]=asOf.time.split(':').map(Number);
  const target=Solar.fromYmdHms(yy,mm,dd,hh,mi,ss).getLunar().getEightChar();
  target.setSect(record.conventions.bazi.dayBoundary==='midnight'?2:1);
  const luck=e.getYun(input.gender==='male'?1:0,record.conventions.bazi.yunSect);
  const cycles=luck.getDaYun(11).filter(d=>d.getEndYear()>=d.getStartYear()).map(d=>({
    index:d.getIndex(),startYear:d.getStartYear(),endYear:d.getEndYear(),startAge:d.getStartAge(),endAge:d.getEndAge(),
    ganzhi:d.getGanZhi(),pillar:relative(d.getGanZhi()),
    smallLuck:d.getXiaoYun(d.getEndYear()-d.getStartYear()+1).map(x=>({year:x.getYear(),age:x.getAge(),...relative(x.getGanZhi())}))
  }));
  const currentCycle=cycles.find(c=>yy>=c.startYear&&yy<=c.endYear)??null;
  const relationships=[],pillars=record.charts.bazi.pillars,entries=Object.entries(pillars);
  for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
    const [a,p]=entries[i],[b,q]=entries[j],ag=p.ganzhi[0],bg=q.ganzhi[0],az=p.ganzhi[1],bz=q.ganzhi[1];
    if(LunarUtil.HE_GAN_5[gan.indexOf(ag)]===bg)relationships.push({a,b,type:'天干五合',left:ag,right:bg});
    if(LunarUtil.HE_ZHI_6[zhi.indexOf(az)]===bz)relationships.push({a,b,type:'地支六合',left:az,right:bz});
    if(LunarUtil.CHONG[zhi.indexOf(az)]===bz)relationships.push({a,b,type:'地支相冲',left:az,right:bz});
  }
  const palaces=record.charts.ziwei.native.palaces;
  const {fixLeap,...ziweiConfig}=record.conventions.ziwei;
  const functional=astro.withOptions({dateStr:record.calendar.solar.slice(0,10),timeIndex:record.charts.ziwei.timeIndex,
    gender:input.gender==='male'?'男':'女',language:'zh-CN',fixLeap,config:ziweiConfig});
  const ziweiCycles=functional.decadalList().map(c=>({index:c.index,ageRange:c.ageRange,yearRange:c.yearRange,
    ganzhi:c.heavenlyStem+c.earthlyBranch,palaceName:c.palaceName}));
  const flies=palaces.map(p=>({from:p.index,stem:p.heavenlyStem,routes:util.getMutagensByHeavenlyStem(p.heavenlyStem).map((star,i)=>({
    star,mutagen:['禄','权','科','忌'][i],to:palaces.find(q=>[...q.majorStars,...q.minorStars,...q.adjectiveStars].some(s=>s.name===star))?.index??null
  }))}));
  const flow={decadal:currentCycle?.pillar??null,smallLuck:currentCycle?.smallLuck.find(x=>x.year===yy)??null,
    yearly:relative(target.getYear()),monthly:relative(target.getMonth()),daily:relative(target.getDay()),hourly:relative(target.getTime())};
  return {record,asOf,notes:humanWarnings({...record,warnings:record.warnings.filter(x=>!['birth_input_not_confirmed','conventions_are_explicit_calculation_assumptions_not_user_preferences'].includes(x))}),bazi:{cycles,currentCycleIndex:currentCycle?.index??null,
    luckGrouping:'引擎虚岁年度分组；不是精确交运日划分',relationships,
    flow,shensha:shenshaView(pillars,flow)},
    ziwei:{flies,cycles:ziweiCycles},limits:['关系只列原版合冲表，不判断合化、喜忌或预测。','神煞为单独的12项已核表项预设，未作手机App全量或独立校验；自坐未移植。流曜与四化采用iztro当前固定表。']};
}
