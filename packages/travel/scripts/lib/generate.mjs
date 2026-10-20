import fs from 'node:fs';
import path from 'node:path';
import { ROOT, VERSION, read, write, inside, loadTrip, inputHash, routeUrl, routeHash, budget, esc, md, hash, now, safeUrl } from './core.mjs';
import { validate } from './validate.mjs';
import { researchStatus, sniff } from './research.mjs';
import { drivingOverviews } from './maps-weather.mjs';
import { MAP_LABEL, mapProvider, mapCity, placeUrl, routePrecision } from './maps.mjs';
import {expandNarratives} from './narrative.mjs';
import {renderNarrative,compileWiki} from './claims.mjs';

export function projection(project) {
  const trip=loadTrip(project), result=validate(trip,project);
  if(!result.valid)throw Error(result.errors.join('\n'));
  const data=Object.fromEntries(['schemaVersion','title','start','end','referenceCurrency','rates','mapProvider','mapCity','places','catalog','orders','todos','routes','expenses','knowledge','shopping','guides','journal','weatherLocations','days'].map(k=>[k,structuredClone(trip[k])]));
  const provider=mapProvider(trip);
  data.map={provider,label:MAP_LABEL[provider],city:mapCity(trip,trip.places)};
  data.presentation=structuredClone(trip.presentation||{});
  expandNarratives(trip,data,renderNarrative);
  const photo=p=>{
    if(!p)return null;
    const bytes=fs.readFileSync(inside(project,p.file)), mime=sniff(bytes);
    if(!mime)throw Error('Only local raster photos can be embedded');
    return {caption:p.caption||'',source:p.source,license:p.license,data:'data:'+mime+';base64,'+bytes.toString('base64')};
  };
  for(const p of data.places) { p.mapUrl=placeUrl(trip,p); p.photo=photo(p.photo); delete p.review; }
  for(const j of data.journal)j.photo=photo(j.photo);
  data.overviews=drivingOverviews(trip).map(r=>{
    const file=inside(project,'assets/routes/'+r.id+'.json');
    if(fs.existsSync(file)){
      const c=read(file);
      if(c.routeHash!==routeHash(trip,r))throw Error('Stale driving overview '+r.id);
      const bytes=fs.readFileSync(inside(project,c.file));
      if(hash(bytes)!==c.hash)throw Error('Overview screenshot fingerprint mismatch');
      if(c.reviewed)r.image='data:'+sniff(bytes)+';base64,'+bytes.toString('base64');
    }
    return {...r,url:routeUrl(trip,r),exact:routePrecision(trip,r)};
  });
  data.orders=data.orders.map(o=>{
    // Explicit output whitelist: no raw evidence paths, cancellation tokens or arbitrary metadata.
    const {id,title,category,date,start,end,party,placeId,status,amount,instructions,cancelRule}=o;
    return {id,title,category,date,start,end,party,placeId,status,amount,instructions,cancelRule};
  });
  for(const r of data.routes){
    r.url=routeUrl(trip,r);
    r.exact=routePrecision(trip,r);
    r.pending=r.status==='pending';
    if(r.capture?.reviewed && r.capture.routeHash===routeHash(trip,r)){
      const bytes=fs.readFileSync(inside(project,r.capture.file)), mime=sniff(bytes);
      if(!mime)throw Error('Invalid route screenshot');
      r.image='data:'+mime+';base64,'+bytes.toString('base64');
    }
    delete r.capture;
  }
  data.knowledge=data.knowledge.map(k=>({id:k.id,title:k.title,summary:k.summary,city:k.city,text:compileWiki(trip,k,fs.readFileSync(inside(project,k.path),'utf8'))}));
  data.weather=[];
  const pointer=inside(project,'weather/latest.json');
  if(fs.existsSync(pointer)){
    const latest=read(pointer), bytes=fs.readFileSync(inside(project,latest.file));
    if(hash(bytes)!==latest.hash)throw Error('Weather snapshot fingerprint mismatch');
    data.weather=JSON.parse(bytes).locations;
    for(const w of data.weather){
      const current=trip.weatherLocations.find(l=>l.id===w.id);if(!current)continue;
      const coordinates=w.coordinates||w;
      if(current.latitude!==coordinates.latitude||current.longitude!==coordinates.longitude||current.timezone!==w.timezone)throw Error('Weather location changed; refresh snapshot for '+w.id);
    }
  }
  data.budget=budget(trip);
  data.warnings=result.warnings;
  data.sourceHash=inputHash(project);
  return data;
}
function derivedDocs(data,stats) {
  const name=id=>data.places.find(p=>p.id===id)?.name||id||'';
  const lines=['# '+data.title,'','> 生成文件。修改trip.json后运行sync；此处不要独立编辑。','','## 全程一览','','|日期|城市|人数|主线|住宿|','|---|---|---|---|---|'];
  for(const d of data.days)lines.push('|'+[d.date,d.city,d.party,d.summary,name(d.stayId)].map(md).join('|')+'|');
  for(const d of data.days){
    lines.push('','## '+d.date+' '+d.city,'',d.summary,'','|时间|行动|地点|','|---|---|---|');
    for(const t of d.timeline)lines.push('|'+[t.start+'–'+t.end,t.title,name(t.placeId)].map(md).join('|')+'|');
    lines.push('','### 餐食');
    for(const m of d.meals){const c=data.catalog.find(c=>c.id===m.catalogId);lines.push('- '+m.meal+' / '+m.role+'：'+(c?.name||m.note||'自炊'));}
    lines.push('','### 路线');
    for(const id of d.routeIds){const r=data.routes.find(r=>r.id===id);lines.push(r.url?'- ['+r.stops.map(name).join(' → ')+']('+r.url+')':'- '+r.stops.map(name).join(' → ')+'（路线待定）');if(r.access)lines.push(...r.access.steps.map(s=>'  - '+s),'  - '+r.access.constraints);}
    lines.push('','### 待办');
    for(const t of data.todos.filter(t=>t.status==='open'&&t.dates.includes(d.date)))lines.push('- '+t.when+'：'+t.action);
  }
  lines.push('','## 订单');
  for(const o of data.orders)lines.push('- '+o.date+' '+o.start+' '+o.title+' / '+o.party+'人 / '+o.status);
  const catalog=['# 餐厅、咖啡与补给','','> 生成文件。店铺事实源：trip.json.catalog。'];
  for(const c of data.catalog)catalog.push('','## '+c.city+' / '+c.name,'',c.kind+' · '+(c.cuisine||''),'',c.price?c.price.min+'–'+c.price.max+' '+c.price.currency+' / '+c.price.basis:'价格未知','',c.openingHours||'营业时间待核验',c.url?'[来源]('+c.url+')':'');
  const nowLines=['# 当前工作','','> 自动派生统计，不建立第二份全程待办。','',JSON.stringify(stats.counts), '','## 结构与复查提示',...data.warnings.map(w=>'- '+w),'','## 未完成行动',...data.todos.filter(t=>t.status==='open').map(t=>'- '+t.dates.join('、')+' / '+t.when+' / '+t.action)];
  return {...Object.fromEntries(data.knowledge.map(k=>['wiki/'+k.id+'.md',k.text])), '行程总表.md':lines.join('\n')+'\n','餐厅清单.md':catalog.join('\n')+'\n','NOW.md':nowLines.join('\n')+'\n',
    'Wiki索引.md':'# 主题索引\n\n'+data.knowledge.map(k=>'- '+k.title+'：'+k.summary).join('\n')+'\n',
    'research-status.json':stats,'budget.json':data.budget,'data.json':data};
}
export function sync(project) {
  const data=projection(project), stats=researchStatus(project);
  for(const [file,body] of Object.entries(derivedDocs(data,stats)))write(inside(project,'generated/'+file),body);
  write(inside(project,'generated/receipt.json'),{sourceHash:data.sourceHash,generatedAt:now()});
  return {sourceHash:data.sourceHash,warnings:data.warnings,counts:stats.counts};
}
export function build(project) {
  const result=sync(project), data=read(inside(project,'generated/data.json'));
  const css=['style.css','editorial.css','hierarchy.css'].map(name=>fs.readFileSync(path.join(ROOT,'web',name),'utf8')).join('\n');
  const helpers=[fs.readFileSync(path.join(ROOT,'scripts/lib/maps.mjs'),'utf8'),fs.readFileSync(path.join(ROOT,'scripts/lib/temporary-route.mjs'),'utf8')].join('\n').replace(/^import\s+.*$/gm,'').replace(/^export\s+(?=(?:function|const|let|class))/gm,'');
  const js=fs.readFileSync(path.join(ROOT,'web/app.js'),'utf8').replace('/* TEMPORARY_ROUTE_HELPERS */',helpers);
  const json=JSON.stringify(data).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; connect-src \'none\'; font-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>'+esc(data.title)+'</title><style>'+css+'</style></head><body><header><a href="#overview" id="brand">'+esc(data.title)+'</a><span>随身旅行手册 · 离线版</span></header><nav id="nav" aria-label="主导航"></nav><main id="main"></main><dialog id="detail"><button id="close" aria-label="关闭详情">关闭 ×</button><div id="detail-content"></div></dialog><footer>资料快照，非实时状态。外部地图与来源需联网。此文件含采用的行程信息，请仅分享给同行者。</footer><script id="trip-data" type="application/json">'+json+'</script><script>'+js+'</script></body></html>';
  const output=inside(project,'build/index.html');
  write(output,html);
  write(inside(project,'build/receipt.json'),{version:VERSION,sourceHash:result.sourceHash,artifactHash:hash(html),builtAt:now(),mode:'private-offline'});
  return {file:output,bytes:Buffer.byteLength(html),...result};
}
export function freshness(project) {
  const sourceHash=inputHash(project), check={sourceHash};
  for(const dir of ['generated','build']){
    const file=inside(project,dir+'/receipt.json');
    check[dir]=fs.existsSync(file)&&read(file).sourceHash===sourceHash;
  }
  if(check.build){const receipt=read(inside(project,'build/receipt.json')),file=inside(project,'build/index.html');check.build=fs.existsSync(file)&&receipt.artifactHash===hash(fs.readFileSync(file));}
  return check;
}
