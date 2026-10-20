'use strict';
/* TEMPORARY_ROUTE_HELPERS */
const D=JSON.parse(document.getElementById('trip-data').textContent);
const $=s=>document.querySelector(s);
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe=u=>{try{const x=new URL(u);return ['https:','http:'].includes(x.protocol)?x.href:'';}catch{return '';}};
const link=(url,label)=>safe(url)?'<a href="'+e(safe(url))+'" target="_blank" rel="noreferrer">'+e(label)+'</a>':'';
const place=(id,label)=>{const p=D.places.find(p=>p.id===id);return p?'<button class="place" data-place="'+e(id)+'">'+e(typeof label==='string'&&label?label:p.name)+'</button>':'';};
const names=D.places.flatMap(p=>[p.name,...p.aliases||[]].map(n=>({n,id:p.id}))).filter(x=>x.n).sort((a,b)=>b.n.length-a.n.length);
function rich(text){
  let s=String(text||''),out='';
  while(s){let found=null,at=s.length;for(const a of names){const i=s.indexOf(a.n);if(i>=0&&i<at){found=a;at=i;}}if(!found){out+=e(s);break;}out+=e(s.slice(0,at))+place(found.id,found.n);s=s.slice(at+found.n.length);}
  return out;
}
const empty=text=>'<p class="empty">'+e(text)+'</p>';
const price=c=>c?.price?e(c.price.min+'–'+c.price.max+' '+c.price.currency+' / '+(c.price.basis==='person'?'人':'合计')):'价格未核验';
const image=photo=>photo?'<img class="photo" src="'+e(photo.data)+'" alt="'+e(photo.caption)+'"><small class="caption">'+e(photo.caption)+' · '+link(photo.source,'图片来源')+' · '+e(photo.license)+'</small>':'';
const tabs=[['overview','总览'],['day','每日执行'],['maps','地图路线']];
const resources=[['weather','天气'],['orders','订单待办'],['dining','餐饮补给'],['shopping','购物'],['guides','实用指南'],['wiki','延伸阅读'],['journal','旅行手册']];
const sections=[['projects','今天的体验'],['routes','地图与选点'],['timeline','时间线'],['meals','吃饭'],['stay','住宿'],['check','核对']];
const P=D.presentation||{};
const MAP=D.map||{provider:'google',label:'Google Maps',city:''};
const labelKind={restaurant:'餐厅',cafe:'咖啡',supermarket:'超市',activity:'水上活动',walking:'步行',driving:'驾车',transit:'公共交通',official:'运营方接驳'};
const wikiLinks=ids=>(ids||[]).map(id=>wikiButton(id,D.knowledge.find(k=>k.id===id)?.title)).join(' ');
function visitDetail(j){return j.visit?'<div class="visit-detail">'+(j.visit.duration?'<p class="duration">'+e(j.visit.duration)+'</p>':'')+(j.visit.steps?.length?'<ol>'+j.visit.steps.map(step=>'<li>'+rich(step)+'</li>').join('')+'</ol>':'')+(j.visit.tip?'<aside class="field-note">'+rich(j.visit.tip)+'</aside>':'')+'</div>':'';}
let date=D.days[0]?.date,section='projects',view='overview',focusBefore=null;
let draft=null,draftRoute=null;
function wikiButton(id,label='阅读详情'){return D.knowledge.some(k=>k.id===id)?'<button data-wiki="'+e(id)+'">'+e(label)+'</button>':'';}
function catalog(id){
 const c=D.catalog.find(c=>c.id===id);if(!c)return '';
 return '<article class="catalog"><small class="eyebrow">'+e(c.city)+' · '+e(labelKind[c.kind]||c.kind)+'</small><h3>'+place(c.placeId)+'</h3><p>'+rich(c.description||c.cuisine)+'</p>'+(c.dishes?.length?'<p class="dishes"><span>点单线索 · 旧清单</span>'+c.dishes.map(e).join(' / ')+'</p>':'')+(c.price?'<p class="price">'+price(c)+'<small>'+e(c.priceNote||(!c.verifiedAt?'历史预算参考':'价格参考'))+'</small></p>':'')+(c.recommendation?'<p class="field-note">'+rich(c.recommendation)+'</p>':'')+'<details class="catalog-details"><summary>营业、订位与资料</summary>'+(c.openingHours?'<p>'+e(c.openingHours)+'</p>':'<p>营业时间待查。</p>')+(c.verifiedAt?'<small>核对于 '+e(c.verifiedAt)+'</small>':'')+'<p>'+link(c.url,'菜单与来源')+' '+link(c.bookingUrl,'订位入口')+'</p>'+wikiLinks(c.wikiIds)+'</details></article>';
}
function dates(){return '<div class="dates" aria-label="选择日期">'+D.days.map(d=>'<button data-date="'+e(d.date)+'" class="'+(d.date===date?'selected':'')+'">'+e(d.date.slice(5))+'</button>').join('')+'</div>';}
function weatherLabel(code){if(code==null)return '天气未知';if(code===0)return '晴';if([1,2,3].includes(code))return '晴间多云 / 阴';if([45,48].includes(code))return '雾';if(code>=51&&code<=67)return '小雨 / 雨';if(code>=71&&code<=77)return '雪';if(code>=80&&code<=82)return '阵雨';if([85,86].includes(code))return '阵雪';if(code>=95)return '雷暴';return '代码 '+code;}
function weatherCards(day,open=false){
 const items=day.weatherIds.map(id=>D.weather.find(w=>w.id===id)||D.weatherLocations.find(w=>w.id===id)).filter(Boolean);
 if(!items.length)return '';
 return items.map(w=>{
  const x=w.daily?.find(x=>x.date===day.date);
  const fields=[];
  if(x?.sunrise)fields.push('日出 '+x.sunrise);
  if(x?.sunset)fields.push('日落 '+x.sunset);
  if(x?.daylightHours!=null)fields.push('日照 '+x.daylightHours+'小时');
  if(x?.feelsMin!=null&&x?.feelsMax!=null)fields.push('体感 '+x.feelsMin+'—'+x.feelsMax+'°C');
  if(x?.rain!=null)fields.push('降水 '+x.rain+'mm');
  if(x?.rainProbability!=null)fields.push('降水概率 '+x.rainProbability+'%');
  if(x?.wind!=null)fields.push('风速 '+x.wind+'km/h');
  if(x?.gust!=null)fields.push('阵风 '+x.gust+'km/h');
  const temperatures=x&&x.min!=null&&x.max!=null?x.min+'—'+x.max+'°C':'未留存温度';
  return '<details class="weather" '+(open?'open':'')+'><summary><span class="weather-place">'+e(w.name)+'</span><strong class="weather-temp">'+e(temperatures)+'</strong><span class="weather-state">'+(x?.code!=null?e(weatherLabel(x.code)):'')+(x?.historical?' · 历史预报':'')+'</span></summary><div class="grid"><div>'+fields.map(f=>'<span>'+e(f)+'</span>').join('')+'</div><div><small>'+e(w.timezone)+(x?.originalFetchedAt?' · 获取于 '+e(x.originalFetchedAt):!x?.historical&&w.fetchedAt?' · 获取于 '+e(w.fetchedAt):'')+'</small>'+(x?.historical?'<p>来源和真实查询时刻未留存，不用于穿衣或出海决策。</p>':'<p>远期仅供趋势参考，临近复查。</p>')+'<p>'+link(w.source,'预报来源')+'</p></div></div></details>';
 }).join('');
}
function chart(){
 const rows=D.weather.filter(w=>D.days.some(d=>d.weatherIds.includes(w.id))).map(w=>({...w,points:w.daily.filter(x=>D.days.some(d=>d.date===x.date&&d.weatherIds.includes(w.id))&&Number.isFinite(x.min)&&Number.isFinite(x.max))})).filter(w=>w.points.length);
 if(!rows.length)return empty('有预报数据后显示逐日最高 / 最低温。');
 const values=rows.flatMap(w=>w.points.flatMap(x=>[x.min,x.max])),lo=Math.min(...values)-2,hi=Math.max(...values)+2;
 const x=d=>50+D.days.findIndex(a=>a.date===d)*900/Math.max(1,D.days.length-1),y=t=>200-(t-lo)*160/(hi-lo);
 const colors=['#126c67','#aa4d32','#4b59a3','#886826','#963b76','#46733b'];
 return '<svg class="weather-chart" role="img" aria-label="逐日高低温，多城市并列保留" viewBox="0 0 1000 250"><path d="M50 35V210H970" fill="none" stroke="#aebdb8"/>'+D.days.map(d=>'<text x="'+x(d.date)+'" y="236" text-anchor="middle" font-size="12">'+e(d.date.slice(5))+'</text>').join('')+rows.map((w,i)=>['max','min'].map(k=>'<polyline points="'+w.points.map(p=>x(p.date)+','+y(p[k])).join(' ')+'" fill="none" stroke="'+colors[i%colors.length]+'" stroke-width="2" '+(k==='min'?'stroke-dasharray="5 4"':'')+'/>'+w.points.map(p=>'<circle cx="'+x(p.date)+'" cy="'+y(p[k])+'" r="3" fill="'+colors[i%colors.length]+'"><title>'+e(w.name+' '+p.date+' '+k+' '+p[k]+'°C')+'</title></circle>').join('')).join('')).join('')+'</svg><div class="chart-key">'+rows.map((w,i)=>'<span style="color:'+colors[i%colors.length]+'">'+e(w.name)+'</span>').join('')+'<small>实线最高温，虚线最低温；详细数值见逐日卡。</small></div>';
}
const overviews=day=>D.overviews.filter(r=>r.date===day).map(r=>'<h2>当日自驾全览</h2>'+routeCard(r)).join('');
function routeCard(r){const mode=r.pending?'路线待定 · 仅示意顺序':e(labelKind[r.mode]||r.mode)+(r.branch&&r.branch!=='default'?' · 备选':'');return '<article class="panel route-card"><h3>'+r.stops.map(place).join(' → ')+'</h3><p class="route-mode">'+mode+'</p>'+(r.access?'<ol>'+r.access.steps.map(s=>'<li>'+e(s)+'</li>').join('')+'</ol><p>'+e(r.access.constraints)+'</p>':'')+(r.image&&!r.pending&&r.mode!=='official'?'<img class="route-image" src="'+e(r.image)+'" alt="'+e(r.id)+' 路线全览">':(r.mode==='official'&&!r.pending?'<p class="muted">按运营方指引到达。</p>':''))+'<p class="route-action">'+(r.pending?'<span class="muted">交通方式与走向待定，出发前再在地图核对</span>':link(r.url,r.access&&r.mode==='official'?'打开通道指引':r.exact===false?'在'+MAP.label+'搜索终点':'打开路线')+(r.exact===false?'<small class="field-note">未登记坐标，'+MAP.label+'只能搜索到终点</small>':''))+'</p></article>';}
function todoList(day){const t=D.todos.filter(t=>t.status==='open'&&(!day||t.dates.includes(day)));return t.length?t.map(t=>'<div class="todo"><small>'+e(t.kind)+' / '+e(t.when)+'</small>'+rich(t.action)+'</div>').join(''):empty('此处没有未完成行动。');}
const el = (tag, className, html = '') => {
    const node = document.createElement(tag);
    node.className = className;
    node.innerHTML = html;
    return node;
  };
function dayShell(html, day) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const root = el('div', 'daily-page');
    root.append(template.content);
    const heading = root.querySelector(':scope > h1');
    const intro = root.querySelector(':scope > .daily-intro');
    const masthead = el('section', 'daily-masthead');
    const dateBlock = el('div', 'day-stamp', '<span>' + e(day.date.slice(5, 7)) + '月</span><b>' + e(day.date.slice(8)) + '</b>');
    const content = el('div', 'daily-masthead-copy');
    heading.textContent = day.city || '当天安排';
    const summary = intro.querySelector(':scope > p');
    summary.textContent = day.summary || '';
    content.append(heading, intro);
    masthead.append(dateBlock, content);
    root.querySelector('.dates').after(masthead);
    const tabs = root.querySelector('.primary-tabs');
    const tools = root.querySelector('.day-tools');
    if (tabs && tools) {
      const navigation = el('div', 'daily-navigation');
      tabs.before(navigation);
      navigation.append(tabs, tools);
    }
    const index = root.querySelector('.experience-index');
    if (index) {
      const redundantHeading = index.previousElementSibling;
      if (redundantHeading?.tagName === 'H2' && redundantHeading.textContent === '今天的体验') redundantHeading.remove();
      index.prepend(el('span', 'sequence-label', '今日顺序'));
      [...index.querySelectorAll('button')].forEach((button, i) => {
        button.prepend(el('span', 'sequence-number', String(i + 1).padStart(2, '0')));
      });
    }
    return root.outerHTML;
  }
function practicalEntry(j, open = false) {
    const day = D.days.find(d => d.date === j.date);
    const items = D.journal.filter(x => x.date === j.date && x.kind === 'experience');
    const number = String(items.findIndex(x => x.id === j.id) + 1).padStart(2, '0');
    const windows = day.timeline.filter(t => (j.placeIds || []).includes(t.placeId));
    const time = windows.length ? windows.map(t => t.start + '—' + t.end).join(' / ') : '';
    const orders = D.orders.filter(o => o.date === j.date && o.status === 'booked' && (j.placeIds || []).includes(o.placeId));
    const steps = j.visit?.steps || [];
    const visit = j.visit ? '<div class="visit-detail">' +
      (steps.length ? '<section class="experience-steps"><h3>怎么安排</h3><ol>' + steps.map(s => '<li>' + rich(s) + '</li>').join('') + '</ol></section>' : '') +
      '<aside class="experience-aside">' +
      (j.visit.duration ? '<div class="duration-card"><span>时间与边界</span><p class="duration">' + e(j.visit.duration) + '</p></div>' : '') +
      (j.visit.tip ? '<div class="field-note"><span>注意</span><p>' + rich(j.visit.tip) + '</p></div>' : '') + '</aside></div>' : '';
    const places = (j.placeIds || []).map(id => '<span class="place-entry">' + place(id) + '</span>').join('');
    const readings = (j.wikiIds || []).map(id => wikiButton(id, D.knowledge.find(k => k.id === id)?.title || '专题详情')).join('');
    return '<details class="experience" data-experience="' + e(j.id) + '" ' + (open ? 'open' : '') + '>' +
      '<summary><span class="experience-number" aria-hidden="true">' + number + '</span>' +
      '<div class="experience-heading"><h2>' + e(j.title) + '</h2>' +
      (time ? '<p class="experience-time"><span>相关时段</span> <time>' + e(time) + '</time></p>' : '') + '</div>' +
      '<span class="experience-toggle" aria-hidden="true"><span class="when-closed">展开 ＋</span><span class="when-open">收起 −</span></span></summary>' +
      '<div class="experience-body">' + image(j.photo) + '<div class="text">' + rich(j.text) + '</div>' + visit +
      orders.map(o => '<div class="experience-order"><span>本项预订</span><strong>' + e(o.start + (o.end ? '—' + o.end : '') + ' / ' + o.party + '人') + '</strong><p>' + rich(o.instructions) + '</p></div>').join('') +
      '<footer class="experience-resources">' + (places ? '<div class="arrival-group"><span>地点与到达</span><div>' + places + '</div></div>' : '') +
      (readings ? '<div class="reading-links"><span>了解更多</span><div>' + readings + '</div></div>' : '') + '</footer></div></details>';
  }
function stayCard(d){
 const p=D.places.find(p=>p.id===d.stayId);
 return '<section class="stay-card"><h2>今晚落脚</h2>'+(p?'<h3>'+place(p.id)+'</h3><p>'+e(p.description||'')+'</p><div class="arrival-address"><span>到达位置</span><p>'+e(p.address)+'</p>'+link(p.mapUrl,'打开地图位置')+'</div>'+(p.arrivalNote?'<p class="field-note">'+e(p.arrivalNote)+'</p>':''):empty('未填写住宿或在途。'))+'</section>';
}
function dayView(){
 const d=D.days.find(d=>d.date===date);
 let body='';
 if(section==='projects'){const items=D.journal.filter(j=>j.date===d.date&&j.kind==='experience');body='<h2>今天的体验</h2>'+(items.length?'<div class="experience-index" aria-label="项目目录">'+items.map(j=>'<button data-experience-jump="'+e(j.id)+'">'+e(j.shortTitle||j.title)+'</button>').join('')+'</div>':'')+items.map((j,i)=>journalEntry(j,true,i===0)).join('');if(!items.length)body='<section class="transfer-day"><h2>今天在路上</h2>'+D.journal.filter(j=>j.date===d.date).map(j=>'<p class="lead">'+rich(j.text)+'</p>').join('')+'<ol>'+d.timeline.map(t=>'<li><time>'+e(t.start)+'</time><span>'+rich(t.title)+'</span></li>').join('')+'</ol></section>';}
 if(section==='timeline')body='<ol class="timeline">'+d.timeline.map(t=>'<li><time>'+e(t.start)+'–'+e(t.end)+'</time><div><strong>'+rich(t.title)+'</strong><p>'+place(t.placeId)+'</p><small>'+rich(t.note||t.branch||'')+'</small></div></li>').join('')+'</ol>'+(!d.timeline.length?empty('尚未写入当天安排。'):'');
 if(section==='routes')body=mapPanel(d);
 if(section==='meals')body=['breakfast','lunch','coffee','dinner','grocery'].map(m=>{const all=d.meals.filter(x=>x.meal===m);if(!all.length)return '';return '<section class="panel meal-section"><h2>'+e({breakfast:'早餐',lunch:'午餐',coffee:'咖啡',dinner:'晚餐',grocery:'采购'}[m])+'</h2>'+all.filter(x=>x.role==='default').map(x=>'<div class="meal-choice"><span class="meal-role">默认</span>'+catalog(x.catalogId)+(x.note?'<p class="meal-note">'+rich(x.note)+'</p>':'')+'</div>').join('')+(all.some(x=>x.role==='alternative')?'<details><summary>备选</summary>'+all.filter(x=>x.role==='alternative').map(x=>catalog(x.catalogId)+'<p>'+rich(x.note)+'</p>').join('')+'</details>':'')+'</section>';}).join('')||empty('尚无餐次安排。');
 if(section==='stay')body=stayCard(d);
 if(section==='check')body='<h2>当天核对</h2>'+todoList(d.date)+(d.notes?'<aside class="execution-note"><h3>执行备注</h3><p>'+rich(d.notes)+'</p></aside>':'');
 const activeTool=sections.slice(2).some(([id])=>id===section),items=D.journal.filter(j=>j.date===d.date&&j.kind==='experience');
 const button=([id,n])=>'<button aria-pressed="'+(section===id)+'" data-section="'+id+'" class="'+(section===id?'selected':'')+'">'+n+'</button>';
 return dayShell(dates()+'<h1>'+e(d.date.slice(5))+'　'+e(d.city)+'</h1><div class="daily-intro"><p>'+rich(d.summary||'')+'</p><div class="day-highlights">'+(d.highlights||[]).map(h=>'<span>'+e(h)+'</span>').join('')+'</div><small>'+d.party+'人 · '+e(d.timezone)+'</small></div>'+weatherCards(d)+(D.orders.some(o=>o.date===date&&o.status==='booked')?'<div class="booking-strip">'+D.orders.filter(o=>o.date===date&&o.status==='booked').map(o=>'<div><time>'+e(o.start)+'</time><span>'+place(o.placeId)+'</span><small>'+e(D.catalog.some(c=>c.kind==='restaurant'&&c.placeId===o.placeId)?'用餐预约':'集合 / 活动')+'</small></div>').join('')+'</div>':'')+'<div class="primary-tabs" role="navigation" aria-label="当天阅读">'+sections.slice(0,2).map(button).join('')+'</div><details class="day-tools" '+(activeTool?'open':'')+'><summary>当天工具</summary><div class="tool-tabs" role="navigation" aria-label="当天工具">'+sections.slice(2).map(button).join('')+'</div>'+(activeTool?'<div class="tool-content">'+body+'</div>':'')+'</details>'+(!activeTool?body:''),d);
}
function journalEntry(j,practical=false,open=false){
 if(practical)return practicalEntry(j,open);
 const d=D.days.find(d=>d.date===j.date),ids=j.placeIds||[];
 const windows=practical?d.timeline.filter(t=>ids.includes(t.placeId)):[];
 const orders=practical?D.orders.filter(o=>o.date===j.date&&o.status==='booked'&&ids.includes(o.placeId)):[];
 const title='<h2>'+e(j.title)+'</h2>',timing=(windows.length?'<p class="experience-time">'+windows.map(t=>e(t.start+'–'+t.end+' '+t.title)).join(' · ')+'</p>':'');
 const content=image(j.photo)+'<div class="text">'+rich(j.text)+'</div>'+(practical?visitDetail(j)+'<div class="reading-links">'+wikiLinks(j.wikiIds)+'</div>':j.visit?'<details class="journal-practical"><summary>游览与安排</summary>'+visitDetail(j)+'<div class="reading-links">'+wikiLinks(j.wikiIds)+'</div></details>':'')+orders.map(o=>'<p class="price">预订 '+e(o.start+' / '+o.party+'人')+' '+rich(o.instructions)+'</p>').join('')+(practical?'<p>'+ids.map(place).join('　')+'</p>':'');
 return practical?'<details class="experience" data-experience="'+e(j.id)+'" '+(open?'open':'')+'><summary>'+title+timing+'</summary><div class="experience-body">'+content+'</div></details>':'<article class="panel journal-entry '+e(j.kind||'experience')+'" data-experience="'+e(j.id)+'">'+title+content+'</article>';
}
function mapPanel(day){
 const routes=day.routeIds.map(id=>D.routes.find(r=>r.id===id)).filter(Boolean);
 if(!routes.length)return empty('当天没有登记地面分段路线；不要用虚构公路线代替航班或室内通道。');
 if(!routes.some(r=>r.id===draftRoute))draftRoute=routes[0].id;
 const r=routes.find(r=>r.id===draftRoute),routeOptions=routes.map(r=>'<option value="'+e(r.id)+'" '+(r.id===draftRoute?'selected':'')+'>'+e(r.stops.map(id=>D.places.find(p=>p.id===id)?.name||id).join(' → '))+' / '+e(r.branch)+'</option>').join('');
 const context=[...new Set([...routes.flatMap(r=>r.stops),...day.timeline.map(t=>t.placeId),...D.journal.filter(j=>j.date===day.date).flatMap(j=>j.placeIds||[]),...day.meals.map(m=>D.catalog.find(c=>c.id===m.catalogId)?.placeId),day.stayId].filter(Boolean))];
 const candidates=D.places.filter(p=>context.includes(p.id)&&p.mapUrl&&p.address);
 const key='travel-draft:'+date+':'+r.id,fingerprint=D.sourceHash+':'+r.id;
 if(!draft||draft.key!==key){let raw=null;try{raw=sessionStorage.getItem(key);}catch{}draft={key,fingerprint,stops:restoreDraft(raw,fingerprint,candidates.map(p=>p.id))||[...r.stops]};}
 const options=selected=>candidates.map(p=>'<option value="'+e(p.id)+'" '+(p.id===selected?'selected':'')+'>'+e(p.name)+'</option>').join('');
 let links='',controls='';
 if(r.mode!=='official'){
  try{links=draft.stops.length<2?empty('至少选择两个地点才能生成导航链接。'):splitDirections(draft.stops,r.mode,D.places,MAP.provider,MAP.city).map((s,i)=>link(s.href,(s.exact?'在'+MAP.label+'规划':'在'+MAP.label+'搜索终点')+(draft.stops.length>5?' · 分段 '+(i+1):''))).join('　');}catch{links=empty(MAP.provider==='amap'?'该组合缺少已登记的高德坐标，无法生成逐点导航；请在地点卡打开具体位置，或在 trip.json 补 places.location。':'该组合缺少已登记的精确 Google Maps 位置，请先在地点卡查看并核对，不能据此生成可靠路线。');}
  controls='<div class="draft-selectors"><label>起点<select data-draft-end="start">'+options(draft.stops[0])+'</select></label><label>终点<select data-draft-end="end">'+options(draft.stops.at(-1))+'</select></label></div><ol class="draft-stops">'+draft.stops.map((id,i)=>'<li>'+place(id)+'<div><button data-draft-move="'+i+'" data-delta="-1" '+(!i?'disabled':'')+' aria-label="上移第'+(i+1)+'站">↑</button><button data-draft-move="'+i+'" data-delta="1" '+(i===draft.stops.length-1?'disabled':'')+' aria-label="下移第'+(i+1)+'站">↓</button><button data-draft-remove="'+i+'" aria-label="移除第'+(i+1)+'站">×</button></div></li>').join('')+'</ol><label>加入当天地点<select id="draft-add">'+options(null)+'</select></label><div class="draft-actions"><button data-draft-add>加到末尾</button><button data-draft-reset>恢复正式分段</button></div><div class="draft-links">'+links+'</div>';
 }else controls='<p>本段按运营方指引执行，不支持改成地面路线。</p>'+link(r.url,'打开正式指引');
 return '<section class="map-panel"><h2>地点与路线</h2><label>正式分段<select id="draft-route">'+routeOptions+'</select></label>'+(r.image&&r.mode!=='official'?'<details><summary>查看此段路线截图</summary><img class="route-image" src="'+e(r.image)+'" alt="'+e(r.id)+' 路线全览"></details>':'')+'<p class="muted">以下仅示意顺序，不是路网地图，不计算耗时。临时选点不改正式行程；实际道路与时刻以'+e(MAP.label)+'和现场指引为准。'+(MAP.provider==='amap'&&D.places.some(p=>!(p.location&&Number.isFinite(p.location.lng)))?' 未登记坐标的点只能在高德中搜索，不能一键规划整段。':'')+'</p>'+controls+'<details class="formal-routes"><summary>全部正式分段与到达说明</summary>'+overviews(day.date)+routes.map(routeCard).join('')+'</details></section>';
}
function saveDraft(){try{sessionStorage.setItem(draft.key,JSON.stringify({fingerprint:draft.fingerprint,stops:draft.stops}));}catch{}render();}
function markdown(text){
 // Safe readable Markdown subset; raw HTML is never executed.
 const lines=String(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'').split(/\r?\n/);
 let table=false,out='';
 const inline=s=>{
   const parts=s.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g);
   return parts.map(p=>{const m=p.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);return m?link(m[2],m[1]):rich(p).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');}).join('');
 };
 for(const line of lines){
   if(line.startsWith('|')){if(!table){out+='<div class="table-scroll"><table>';table=true;}if(!/^\|[\s|:-]+\|?$/.test(line))out+='<tr>'+line.split('|').slice(1,-1).map(x=>'<td>'+inline(x.trim())+'</td>').join('')+'</tr>';continue;}
   if(table){out+='</table></div>';table=false;}
   // Blockquotes carry framing notes; an empty ">" is a separator, never a paragraph of its own.
   if(/^>/.test(line)){const body=line.replace(/^>\s?/,'').trim();if(body)out+='<p class="note">'+inline(body)+'</p>';continue;}
   const h=line.match(/^(#{1,4}) (.*)$/);
   out+=h?'<h'+(h[1].length+1)+'>'+inline(h[2])+'</h'+(h[1].length+1)+'>':line.trim()?'<p>'+inline(line.replace(/^[-*] /,'• '))+'</p>':'';
 }
 return out+(table?'</table></div>':'');
}
function render(){
 const parsed=location.hash.slice(1).split('/');
 view=parsed[0]||'overview';if(parsed[1]&&D.days.some(d=>d.date===parsed[1]))date=parsed[1];
 section=sections.some(([id])=>id===parsed[2])?parsed[2]:'projects';
 $('#nav').innerHTML=[...tabs,...resources].map(([id,n])=>'<a href="#'+id+'/'+date+'" class="'+(view===id?'active':'')+'"'+(view===id?' aria-current="page"':'')+'>'+n+'</a>').join('');
 let html='';
 if(view==='overview')html='<section class="hero editorial-hero"><div class="hero-copy"><p class="eyebrow">'+e(P.kicker||'YOUR TRAVEL COMPANION')+'</p><h1>'+e(P.headline||D.title)+'</h1><p class="hero-subtitle">'+e(P.subtitle||'沿途的体验，按天展开。')+'</p><p class="hero-meta">'+e(D.start.slice(5))+' — '+e(D.end.slice(5))+' · '+D.days.length+'天</p><a class="primary" href="#journal/'+date+'">翻开旅行手册 ↗</a><a class="secondary" href="#day/'+date+'">查看每日安排 →</a></div><div class="hero-art" aria-hidden="true"><div class="coast coast-one"></div><div class="coast coast-two"></div><div class="coast coast-three"></div><span class="art-caption">THE JOURNEY</span></div></section><section class="journey-heading"><div><p class="eyebrow">DAY BY DAY</p><h2>'+e(P.journeyTitle||'一路上的日子')+'</h2></div><a href="#orders/'+date+'">查看订单与待办 →</a></section><div class="journey-list">'+D.days.map((d,i)=>'<article class="overview-day"><time><b>'+e(d.date.slice(8))+'</b><small>'+e(d.date.slice(5,7))+'月 · '+String(i+1).padStart(2,'0')+'</small></time><div><h3>'+e(d.city||'')+'</h3><p>'+rich(d.summary)+'</p><div class="day-highlights">'+(d.highlights||[]).map(h=>'<span>'+e(h)+'</span>').join('')+'</div></div><a href="#day/'+d.date+'">当天安排 ↗</a></article>').join('')+'</div>';
 else if(view==='day')html=dayView();
 else if(view==='weather')html='<h1>旅途天气</h1>'+(D.weather.some(w=>w.daily?.some(x=>x.historical))?'<p class="field-note">保存的历史预报，非实况。未留存的日出、风力等信息不作推断。</p>':'')+chart()+dates()+weatherCards(D.days.find(d=>d.date===date),true);
 else if(view==='maps')html='<h1>地图路线</h1><p class="field-note">导航入口已列出；标记「路线待定」的分段只表示当天顺序，没有导航入口，出发前再按住宿位置核对。</p>'+dates()+overviews(date)+D.routes.filter(r=>r.date===date).map(routeCard).join('');
 else if(view==='orders')html='<h1>订单与行动</h1><h2>已订安排</h2>'+D.orders.filter(o=>o.status==='booked').map(o=>'<article class="panel booking-card"><div class="booking-when"><span>'+e(o.date)+'</span><strong>'+e(o.start+(o.end?'—'+o.end:''))+'</strong><small>'+o.party+'人</small></div><div><h3>'+e(o.title)+'</h3><p>'+place(o.placeId)+'</p><p>'+rich(o.instructions)+'</p>'+(o.cancelRule?'<p class="booking-policy"><span>取消与变更</span>'+e(o.cancelRule)+'</p>':'')+'</div></article>').join('')+'<h2>按日待办</h2>'+D.days.map(d=>'<details class="todo-day"><summary>'+e(d.date)+'<span>'+D.todos.filter(t=>t.status==='open'&&t.dates.includes(d.date)).length+'项待办</span></summary>'+todoList(d.date)+'</details>').join('')+'<details><summary>当前预算区间</summary>'+Object.entries(D.budget.totals).map(([c,v])=>'<p>'+e(c+' '+v.min+'–'+v.max)+'</p>').join('')+'<p>已录入项目缺价 '+D.budget.unknown+' 项；备选不重复计入。未录入的交通、住宿等不计入，不能视为完整旅行预算。</p></details>';
 else if(view==='dining')html='<h1>餐饮与补给</h1>'+[...new Set(D.catalog.filter(c=>c.kind!=='activity').map(c=>c.city))].map(city=>'<h2>'+e(city)+'</h2>'+['restaurant','cafe','supermarket'].map(kind=>{const list=D.catalog.filter(c=>c.city===city&&c.kind===kind);return list.length?'<h3>'+e({restaurant:'餐厅',cafe:'咖啡店',supermarket:'超市',activity:'项目'}[kind])+'</h3><div class="grid">'+list.map(c=>catalog(c.id)).join('')+'</div>':'';}).join('')).join('');
 else if(view==='shopping'||view==='guides')html='<h1>'+(view==='shopping'?'购物':'实用指南')+'</h1>'+[...new Set(D[view].map(c=>c.region))].map(region=>'<h2>'+e(region)+'</h2>'+D[view].filter(c=>c.region===region).map(c=>'<article class="panel guide-card"><h3>'+e(c.title)+'</h3><p>'+rich(c.summary)+'</p>'+wikiButton(c.wikiId)+link(c.url,'来源')+'</article>').join('')).join('');
 else if(view==='wiki')html='<h1>延伸阅读</h1><input type="search" id="search" placeholder="搜索主题与正文" aria-label="搜索Wiki"><div id="wiki-results">'+wikiResults('')+'</div>';
 else if(view==='journal')html='<div class="journal"><header class="journal-heading"><p class="eyebrow">THE TRAVEL JOURNAL</p><h1>'+e(P.headline||D.title)+'</h1><p>'+e(P.subtitle||'')+'</p></header>'+D.days.map(d=>'<section><time>'+e(d.date)+'</time>'+D.journal.filter(j=>j.date===d.date).map(j=>journalEntry(j)).join('')+'</section>').join('')+'</div>';
 else html=empty('没有这个页面。');
 $('#main').dataset.view=view;
 $('#main').innerHTML=html;
 $('#search')?.addEventListener('input',event=>{$('#wiki-results').innerHTML=wikiResults(event.target.value);});
}
function wikiResults(query){return D.knowledge.filter(k=>(k.title+k.summary+k.text).toLowerCase().includes(query.toLowerCase())).map(k=>'<article class="panel wiki-card"><h3>'+e(k.title)+'</h3><p>'+e(k.summary)+'</p>'+wikiButton(k.id)+'</article>').join('')||empty('未找到匹配主题。');}
function show(html){focusBefore=document.activeElement;$('#detail-content').innerHTML=html;$('#detail').showModal();$('#close').focus();}
document.addEventListener('click',event=>{
 const p=event.target.closest('[data-place]');if(p){const obj=D.places.find(x=>x.id===p.dataset.place),c=D.catalog.find(c=>c.placeId===obj.id),j=D.journal.find(j=>j.kind==='experience'&&j.placeIds?.includes(obj.id));show('<div class="place-detail">'+image(obj.photo)+'<p class="eyebrow">'+e(c?.city||labelKind[obj.kind]||'地点')+'</p><h1>'+e(obj.name)+'</h1><p class="lead">'+e(obj.description)+'</p>'+D.orders.filter(o=>o.placeId===obj.id&&o.status==='booked').map(o=>'<div class="day-summary"><h3>我的预订</h3><strong>'+e(o.title)+'</strong><p class="price">'+e(o.date+' · '+o.start+(o.end?'—'+o.end:'')+' / '+o.party+'人')+'</p><p>'+e(o.instructions)+'</p></div>').join('')+(c?'<div class="place-facts">'+(c.price?'<p class="price">'+price(c)+'<small>'+e(c.priceNote||(!c.verifiedAt?'历史预算参考':'价格参考'))+'</small></p>':'')+(c.dishes?.length?'<p>点单参考：'+c.dishes.map(e).join(' / ')+'</p>':'')+(c.openingHours?'<p>'+e(c.openingHours)+'</p>':'')+'</div>':'')+(j?.visit?'<details><summary>怎么体验</summary>'+visitDetail(j)+'</details>':'')+'<h3>到达位置</h3><p>'+e(obj.address)+'</p>'+(obj.arrivalNote?'<p class="field-note">定位待核：'+e(obj.arrivalNote)+'</p>':'')+link(obj.mapUrl||placeUrl({places:D.places,mapProvider:MAP.provider,mapCity:MAP.city,days:[]},obj),'打开具体地图位置 ↗')+'<div class="reading-links">'+wikiLinks(obj.wikiIds||c?.wikiIds||j?.wikiIds)+'</div></div>');return;}
 const k=event.target.closest('[data-wiki]');if(k){const obj=D.knowledge.find(x=>x.id===k.dataset.wiki);show('<article class="wiki-detail">'+markdown(obj.text)+'</article>');return;}
 const day=event.target.closest('[data-date]');if(day){date=day.dataset.date;draft=null;location.hash=view+'/'+date;render();return;}
 const tab=event.target.closest('[data-section]');if(tab){section=tab.dataset.section;location.hash='day/'+date+'/'+section;render();return;}
 const jump=event.target.closest('[data-experience-jump]');if(jump){const target=[...document.querySelectorAll('.experience')].find(x=>x.dataset.experience===jump.dataset.experienceJump);if(target){target.open=true;target.scrollIntoView({block:'start'});}return;}
 if(event.target.closest('[data-draft-reset]')){draft=null;try{sessionStorage.removeItem('travel-draft:'+date+':'+draftRoute);}catch{}render();return;}
 if(event.target.closest('[data-draft-add]')){if(draft.stops.length<100)draft.stops.push($('#draft-add').value);saveDraft();return;}
 const remove=event.target.closest('[data-draft-remove]');if(remove){draft.stops.splice(Number(remove.dataset.draftRemove),1);saveDraft();return;}
 const move=event.target.closest('[data-draft-move]');if(move){const i=Number(move.dataset.draftMove),j=i+Number(move.dataset.delta);if(j>=0&&j<draft.stops.length)[draft.stops[i],draft.stops[j]]=[draft.stops[j],draft.stops[i]];saveDraft();}
});
document.addEventListener('change',event=>{
 if(event.target.id==='draft-route'){draftRoute=event.target.value;draft=null;render();}
 if(event.target.matches('[data-draft-end]')){if(!draft.stops.length)draft.stops.push(event.target.value);else draft.stops[event.target.dataset.draftEnd==='start'?0:draft.stops.length-1]=event.target.value;saveDraft();}
});
$('#close').onclick=()=>$('#detail').close();
$('#detail').addEventListener('close',()=>focusBefore?.focus());
window.addEventListener('hashchange',render);
render();
