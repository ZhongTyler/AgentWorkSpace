import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {calculate} from './chart.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const colors={ink:'#263b34',muted:'#5c665f',line:'#c9cec1',paper:'#f8f6ef',white:'#fffef9',accent:'#24684e',warn:'#8e4c21'};
const elements={木:'#286d48',火:'#a63e36',土:'#816526',金:'#856025',水:'#285e80'};
const units=s=>[...String(s)].reduce((a,c)=>a+(c.charCodeAt(0)>0x2e80?1:0.56),0);
function wrap(s,max){const out=[];let line='';for(const c of String(s)){if(c==='\n'){out.push(line);line='';continue;}if(line&&units(line+c)>max){out.push(line);line='';}line+=c;}if(line)out.push(line);return out;}
class Sheet {
  constructor(width,height){this.width=width;this.height=height;this.parts=[];}
  box(x,y,w,h,fill=colors.white,stroke='none',radius=0){this.parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`);}
  line(x1,y1,x2,y2,color=colors.line){this.parts.push(`<path d="M${x1} ${y1}L${x2} ${y2}" fill="none" stroke="${color}"/>`);}
  text(x,y,s,size=24,{fill=colors.ink,anchor='start',weight=400,serif=false}={}){
    this.parts.push(`<text x="${x}" y="${y}" font-family="${serif?'SimSun, Songti SC, serif':'Microsoft YaHei, Noto Sans CJK SC, sans-serif'}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}">${esc(s)}</text>`);
  }
  lines(x,y,items,size=22,lineHeight=32,style={}){items.forEach((s,i)=>this.text(x,y+i*lineHeight,s,size,style));return y+items.length*lineHeight;}
  svg(){return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}" role="img"><title>确定性排盘图</title><rect width="${this.width}" height="${this.height}" fill="${colors.paper}"/>${this.parts.join('')}</svg>\n`;}
}
function header(s,r,title,details=true){
  s.text(48,78,title,48,{serif:true});
  const tag=r.synthetic?'公开合成样例':'排盘结果';
  const pending=r.status!=='calculated_for_confirmed_input';
  s.text(s.width-48,58,tag,23,{anchor:'end',fill:colors.muted});
  s.text(s.width-48,94,pending?'输入或口径待确认':'输入与口径已确认',23,{anchor:'end',fill:pending?colors.warn:colors.accent});
  if(details){
    s.text(48,139,`公历 ${r.calendar.solar}   ·   ${r.request.gender==='male'?'男':'女'}   ·   ${r.calendar.timezone}`,25);
    s.text(48,178,`农历 ${r.calendar.lunar.display}`,25);
    s.text(48,216,'民用标准时 · 未作夏令时或真太阳时修正',22,{fill:colors.muted});
  }
}
const warnLabels={
  birth_input_not_confirmed:'出生资料尚未确认',
  conventions_are_explicit_calculation_assumptions_not_user_preferences:'当前口径是计算假设，尚非用户偏好',
  late_zi_bazi_day_and_hour_stem_conventions_must_be_read_together:'晚子时：日界切换与时干进日口径须一起核对',
  within_two_minutes_of_calculated_jie_boundary_verify_birth_time_precision:'接近交节：请核对出生时间精度',
  iztro_exact_year_divide_uses_lichun_date_not_bazi_lichun_instant:'紫微立春年界按日期，不等于八字交节时刻',
  iztro_leap_month_late_zi_exception_see_upstream_fixLunarMonthIndex:'闰月晚子时采用原版特殊处理',
  engines_lunar_calendar_disagree_do_not_merge_charts:'两引擎农历不同，需核对后再使用'
};
export function warnings(r){return r.warnings.map(x=>warnLabels[x]??x);}
function footer(s,r,y,engine){
  const notes=wrap(warnings(r).join('；')||'盘面计算不等于独立校盘或预测效力验证',(s.width-96)/21);
  s.height=Math.max(s.height,y+100+notes.length*30);
  s.line(48,y,s.width-48,y);
  s.text(48,y+36,engine+' · 仅为所列输入与口径下的计算结果',21,{fill:colors.muted});
  s.lines(48,y+73,notes,21,30,{fill:colors.warn});
}

export function baziSheet(r){
  const s=new Sheet(1460,1600),b=r.charts.bazi,cfg=r.conventions.bazi;
  header(s,r,'八字命盘');
  s.text(48,255,`日界：${cfg.dayBoundary==='midnight'?'零点换日':'23点换日'}   ·   起运法 ${cfg.yunSect}   ·   年/月以计算交节时刻分界`,22,{fill:colors.muted});
  const tx=48,ty=280,lw=132,cw=308,w=1364;
  const rows=[['柱位',54],['天干十神',48],['天干',104],['地支',104],['藏干 / 十神',122],['五行',48],['纳音',50],['长生',48],['旬空',48]];
  const keys=['year','month','day','hour'],names=['年柱','月柱','日柱','时柱'];
  const total=rows.reduce((n,x)=>n+x[1],0);
  s.box(tx,ty,w,total,colors.white,colors.line);
  s.box(tx+lw+cw*2,ty,cw,total,'#eef2e9');
  let y=ty;
  for(let ri=0;ri<rows.length;ri++){
    const [label,h]=rows[ri];
    if(ri)s.line(tx,y,tx+w,y);
    s.text(tx+18,y+h/2+8,label,22,{fill:colors.muted});
    for(let i=0;i<4;i++){
      const p=b.pillars[keys[i]],cx=tx+lw+cw*i+cw/2;
      if(ri===0)s.text(cx,y+36,names[i],26,{anchor:'middle',weight:600});
      if(ri===1)s.text(cx,y+33,p.stemTenGod,24,{anchor:'middle'});
      if(ri===2||ri===3)s.text(cx,y+80,p.ganzhi[ri-2],76,{anchor:'middle',serif:true,fill:elements[p.fiveElements[ri-2]]});
      if(ri===4)p.hiddenStems.forEach((g,j)=>s.text(cx,y+31+j*31,`${g}  ${p.branchTenGods[j]}`,23,{anchor:'middle'}));
      if(ri===5)s.text(cx,y+33,p.fiveElements,24,{anchor:'middle'});
      if(ri===6)s.text(cx,y+35,p.nayin,24,{anchor:'middle'});
      if(ri===7)s.text(cx,y+33,p.growthStage,24,{anchor:'middle'});
      if(ri===8)s.text(cx,y+33,p.voidBranches,24,{anchor:'middle'});
    }
    y+=h;
  }
  for(let i=0;i<4;i++)s.line(tx+lw+cw*i,ty,tx+lw+cw*i,ty+total);
  s.text(48,ty+total+48,`大运  ·  ${b.yun.forward?'顺行':'逆行'}  ·  ${b.yun.startSolar} 交运`,29,{weight:600});
  const o=b.yun.offset;
  s.text(48,ty+total+85,`起运偏移 ${o.years}年${o.months}月${o.days}日${o.hours}小时；下列年龄采用引擎虚岁口径`,21,{fill:colors.muted});
  const cy=ty+total+107;
  b.yun.cycles.forEach((d,i)=>{
    const x=48+(i%5)*276,yy=cy+Math.floor(i/5)*135;
    s.box(x,yy,260,121,colors.white,colors.line,5);
    s.text(x+18,yy+45,d.ganzhi,36,{serif:true});
    s.text(x+18,yy+78,`${d.startYear}–${d.endYear}年`,22);
    s.text(x+18,yy+107,`${d.startNominalAge}–${d.endNominalAge}岁`,21,{fill:colors.muted});
  });
  const jy=cy+297;
  s.text(48,jy,`前一节：${b.adjacentJie.previous.name} ${b.adjacentJie.previous.solar}`,21,{fill:colors.muted});
  s.text(48,jy+34,`后一节：${b.adjacentJie.next.name} ${b.adjacentJie.next.solar}`,21,{fill:colors.muted});
  footer(s,r,jy+64,`lunar-javascript ${r.provenance.engines['lunar-javascript'].version}`);
  return s;
}

export function annualSheet(r){
  const s=new Sheet(1660,1420);header(s,r,'八字大运 · 流年表');
  s.text(48,254,'每列为一步大运；每格列出年份、流年干支和虚岁。交运精确时刻请结合主盘核对。',22,{fill:colors.muted});
  const x=48,y=282,cw=156,rh=92;
  r.charts.bazi.yun.cycles.forEach((d,i)=>{
    const xx=x+i*cw;s.box(xx,y,cw,72,'#e9eee3',colors.line);
    s.text(xx+cw/2,y+33,d.ganzhi,29,{anchor:'middle',serif:true});
    s.text(xx+cw/2,y+59,`${d.startNominalAge}–${d.endNominalAge}岁`,18,{anchor:'middle'});
    d.annuals.forEach((a,j)=>{const yy=y+72+j*rh;
      s.box(xx,yy,cw,rh,j%2?colors.paper:colors.white,colors.line);
      s.text(xx+cw/2,yy+29,`${a.year}年`,20,{anchor:'middle'});
      s.text(xx+cw/2,yy+58,a.ganzhi,27,{anchor:'middle',serif:true});
      s.text(xx+cw/2,yy+81,`${a.nominalAge}岁`,18,{anchor:'middle',fill:colors.muted});
    });
  });
  footer(s,r,1312,`lunar-javascript ${r.provenance.engines['lunar-javascript'].version}`);return s;
}

function starName(s){return s.name+(s.brightness?`（${s.brightness}）`:'')+(s.mutagen?` 化${s.mutagen}`:'');}
function wrapItems(label,items,max,separator=' · '){
  const out=[];let line=label;
  for(const item of items){const sep=line===label?'':separator;if(line!==label&&units(line+sep+item)>max){out.push(line);line=item;}else line+=sep+item;}
  if(line)out.push(line);return out;
}
function palaceContent(p){
  const lines=[];
  if(p.majorStars.length)for(const star of p.majorStars)lines.push({text:starName(star),size:26,color:star.mutagen==='忌'?'#a13f36':colors.accent,h:36});
  else lines.push({text:'主星空宫',size:23,color:colors.muted,h:34});
  for(const [label,stars,size] of [['辅曜',p.minorStars,20],['杂曜',p.adjectiveStars,19]]){
    for(const t of wrapItems(label+'：',stars.length?stars.map(starName):['无'],310/size))lines.push({text:t,size,color:colors.ink,h:size+9});
  }
  lines.push({text:`长生 ${p.changsheng12} · 博士 ${p.boshi12}`,size:18,color:colors.muted,h:27});
  lines.push({text:`将前 ${p.jiangqian12} · 岁前 ${p.suiqian12}`,size:18,color:colors.muted,h:27});
  lines.push({text:`大限 ${p.decadal.range.join('–')}岁`,size:21,color:colors.ink,h:31});
  const ageLines=wrapItems('小限 ',p.ages.map(String),310/18,'、');ageLines[ageLines.length-1]+='岁';
  for(const t of ageLines)lines.push({text:t,size:18,color:colors.muted,h:26});
  return lines;
}
export function ziweiSheet(r){
  const a=r.charts.ziwei.native,cfg=r.conventions.ziwei;
  const contents=a.palaces.map(palaceContent);
  const ch=Math.max(400,...contents.map(x=>x.reduce((h,l)=>h+l.h,0)+85));
  const cw=345,gx=48,gy=160;
  const s=new Sheet(1476,gy+ch*4+164);header(s,r,'紫微斗数命盘',false);
  s.text(48,123,'本命十二宫 · 星曜旁列庙旺与四化',22,{fill:colors.muted});
  const positions={巳:[0,0],午:[1,0],未:[2,0],申:[3,0],辰:[0,1],酉:[3,1],卯:[0,2],戌:[3,2],寅:[0,3],丑:[1,3],子:[2,3],亥:[3,3]};
  if(a.palaces.length!==12||new Set(a.palaces.map(p=>p.earthlyBranch)).size!==12)throw Error('invalid_twelve_palaces');
  a.palaces.forEach((p,i)=>{
    const pos=positions[p.earthlyBranch];if(!pos)throw Error('invalid_palace_branch');
    const x=gx+pos[0]*cw,y=gy+pos[1]*ch,life=p.name==='命宫';
    s.parts.push(`<g data-palace="${esc(p.earthlyBranch)}" data-palace-name="${esc(p.name)}">`);
    s.box(x,y,cw,ch,life?'#edf2e7':colors.white,life?colors.accent:colors.line);
    s.text(x+17,y+36,p.name,26,{weight:600});
    if(p.isBodyPalace)s.text(x+100,y+35,'身宫',19,{fill:colors.warn});
    s.text(x+cw-17,y+36,p.heavenlyStem+p.earthlyBranch,25,{anchor:'end',serif:true});
    s.line(x+16,y+51,x+cw-16,y+51);
    let yy=y+83;for(const l of contents[i]){s.text(x+17,yy,l.text,l.size,{fill:l.color});yy+=l.h;}
    s.parts.push('</g>');
  });
  const cx=gx+cw+35,cy=gy+ch+68,mw=cw*2-70;
  s.text(cx,cy,'紫微斗数 · 本命盘',37,{serif:true});
  const middle=[
    `公历 ${r.calendar.solar}`,`农历 ${a.lunarDate}`,
    `${r.request.gender==='male'?'男':'女'} · ${a.time} · ${r.calendar.timezone}`,
    `命宫 ${a.earthlyBranchOfSoulPalace} · 身宫 ${a.earthlyBranchOfBodyPalace}`,
    `命主 ${a.soul} · 身主 ${a.body} · ${a.fiveElementsClass}`,
    '民用标准时；未作夏令/真太阳时修正',
    `换日：${cfg.dayDivide==='forward'?'晚子算来日':'晚子算当日'}`,
    `年界：${cfg.yearDivide==='normal'?'正月初一':'立春日期（非交节瞬间）'}`,
    `安星：${cfg.algorithm==='default'?'通行版本':'中州版本'}`,
    `闰月：${cfg.fixLeap?'十五日及以前本月，之后下月；晚子例外':'不作半月修正'}`,
    `行限界：${cfg.horoscopeDivide==='normal'?'正月初一':'节气口径'}`,
    `小限界：${cfg.ageDivide==='normal'?'自然年':'生日'}`
  ];
  let yy=cy+53;for(const text of middle){yy=s.lines(cx,yy,wrap(text,mw/23),23,34);yy+=9;}
  s.text(cx,yy+25,'四化（禄权科忌）按本盘引擎表显示。',21,{fill:colors.muted});
  footer(s,r,gy+ch*4+24,`iztro ${r.provenance.engines.iztro.version}`);
  return s;
}

export function transitSheet(r){
  const s=new Sheet(1460,1080),h=r.charts.ziwei.transit,a=r.charts.ziwei.native;
  header(s,r,'紫微行限摘要');
  s.text(48,257,`查询公历 ${r.request.transit.date} ${r.request.transit.time} · ${r.calendar.timezone}`,25,{weight:600});
  let y=300;for(const [key,name] of [['decadal','大限'],['age','小限'],['yearly','流年'],['monthly','流月'],['daily','流日'],['hourly','流时']]){
    const v=h[key];s.box(48,y,1364,99,colors.white,colors.line);
    s.text(67,y+39,name,29,{serif:true});
    const ganzhi=[v.heavenlyStem,v.earthlyBranch].filter(Boolean).join('')||'—';
    s.text(197,y+39,ganzhi,29);
    if(Number.isInteger(v.index)&&a.palaces[v.index])s.text(365,y+39,`命宫位于 ${a.palaces[v.index].earthlyBranch}`,23);
    if(v.nominalAge)s.text(690,y+39,`虚岁 ${v.nominalAge}`,23);
    const mutagen=Array.isArray(v.mutagen)?v.mutagen.map((star,i)=>['禄','权','科','忌'][i]+' '+star).join(' · '):'未提供四化字段';
    s.text(197,y+77,mutagen,22,{fill:colors.muted});y+=99;
  }
  s.text(48,933,'本页为行限摘要；完整流曜和宫位数组保留在计算结果中，未将其叠入本命盘。',21,{fill:colors.muted});
  footer(s,r,962,`iztro ${r.provenance.engines.iztro.version}`);return s;
}

export function buildSheets(record){
  if(record.schema_id!=='tyler-metaphysics-calculation-v1')throw Error('invalid_calculation_record');
  const out=[];
  if(record.charts.bazi){out.push({name:'bazi',sheet:baziSheet(record)},{name:'bazi-annuals',sheet:annualSheet(record)});}
  if(record.charts.ziwei){out.push({name:'ziwei',sheet:ziweiSheet(record)});if(record.charts.ziwei.transit)out.push({name:'ziwei-transit',sheet:transitSheet(record)});}
  return out;
}
function sharpModule(){
  const candidates=[process.env.CHART_SHARP_MODULE || 'sharp'];
  for(const candidate of candidates)try{return require(candidate);}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
  throw Error('png_renderer_unavailable_use_svg_or_restore_host_sharp');
}
export function pngRenderer(){return sharpModule();}
export async function render(input,{outputDir,svgOnly=false}={}){
  const record=calculate(input),sheets=buildSheets(record);
  const sharp=svgOnly?null:sharpModule(); // Resolve before creating any output directory.
  const dir=outputDir?path.resolve(outputDir):fs.mkdtempSync(path.join(os.tmpdir(),'metaphysics-display-'));
  if(outputDir)fs.mkdirSync(dir); // A new directory only; never overwrite existing user files.
  const artifacts=[];
  for(const {name,sheet} of sheets){
    const svg=sheet.svg(),svgPath=path.join(dir,name+'.svg');fs.writeFileSync(svgPath,svg,{flag:'wx'});
    let pngPath=null;
    if(sharp){pngPath=path.join(dir,name+'.png');await sharp(Buffer.from(svg)).png().toFile(pngPath);}
    artifacts.push({system:name,width:sheet.width,height:sheet.height,svg:svgPath,png:pngPath,
      svg_sha256:crypto.createHash('sha256').update(svg).digest('hex')});
  }
  return {status:'rendered',calculation_status:record.status,synthetic:record.synthetic,
    artifacts,temporary:!outputDir,case_archive_saved:false,files_written:true,
    rasterizer:sharp?{name:'sharp',version:sharp.versions.sharp}:null,
    warnings:record.warnings,network:false};
}
async function main(){
  try{
    const args=process.argv.slice(2),options={};
    for(let i=0;i<args.length;i++){
      if(args[i]==='--svg-only'){if(options.svgOnly)throw Error('duplicate_option');options.svgOnly=true;continue;}
      const key={'--input':'input','--output-dir':'outputDir'}[args[i]];
      if(!key||options[key]!==undefined||!args[i+1])throw Error('invalid_render_arguments');options[key]=args[++i];
    }
    if(!options.input)throw Error('render_input_required');
    const raw=fs.readFileSync(options.input==='-'?0:options.input,'utf8');if(Buffer.byteLength(raw)>65536)throw Error('input_too_large');
    let input;try{input=JSON.parse(raw.replace(/^\uFEFF/,''));}catch{throw Error('invalid_json');}
    console.log(JSON.stringify(await render(input,options),null,2));
  }catch(e){console.error(JSON.stringify({status:'error',error:/^[a-zA-Z0-9_]+$/.test(e.message)?e.message:'render_failed_check_input_runtime_and_new_output_directory'}));process.exitCode=1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){process.env.TZ='Asia/Shanghai';await main();}
