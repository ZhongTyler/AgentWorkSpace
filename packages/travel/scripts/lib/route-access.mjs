// Pure adapter: works with portable trip.json or an existing project's route/place arrays.
const text = v => typeof v === 'string' && v.trim().length > 0;
const publicUrl = v => {
  try { const u = new URL(v); return /^https?:$/.test(u.protocol) && !u.username && !u.password && ![...u.searchParams.keys()].some(k=>/token|cookie|password|secret|authorization|signature/i.test(k)); }
  catch { return false; }
};

export function inspectRouteAccess(route, places) {
  const errors=[], reasons=[];
  const points=route.stops.map(id=>places.find(p=>p.id===id)).filter(Boolean);
  const sameGroup=points.length>=2 && !!points[0].accessGroup && points.every(p=>p.accessGroup===points[0].accessGroup);
  if(sameGroup && ['walking','official'].includes(route.mode)) reasons.push('同一综合体转场');
  if(route.mode==='walking' && points.some(p=>/airport|station|terminal|机场|航站楼|车站|站台/i.test([p.kind,p.name].join(' ')))) reasons.push('机场或车站步行：核对入口、楼层与公共区');
  const a=route.access;
  if(sameGroup && ['walking','official'].includes(route.mode) && !a) errors.push('同组转场缺少access通道说明');
  if(a){
    reasons.push('已登记通道说明');
    if(!['indoor','mixed','outdoor'].includes(a.kind))errors.push('access.kind须为indoor/mixed/outdoor');
    if(!Array.isArray(a.steps)||!a.steps.length||!a.steps.every(text))errors.push('access.steps须有可读步骤');
    if(!text(a.constraints))errors.push('access.constraints须说明通道条件与未知边界');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(a.checkedAt||'')||!Number.isFinite(Date.parse(a.checkedAt)))errors.push('access.checkedAt缺少有效核验日期');
    if(!Array.isArray(a.sources)||!a.sources.length||!a.sources.every(s=>publicUrl(s.url)&&text(s.claim)))errors.push('access.sources须保留URL与支持的结论');
    if(['indoor','mixed'].includes(a.kind) && route.mode!=='official')errors.push('室内/混合通道须用official指引；可导航室外段另拆');
    if(['indoor','mixed'].includes(a.kind) && (!publicUrl(route.officialUrl)||/google\.[^/]+\/maps\/dir/i.test(route.officialUrl)))errors.push('室内通道须有到达说明或平面图，不能用Google街道导航代替');
  }
  return {id:route.id,date:route.date,reasons,status:errors.length?'invalid':a?'documented':reasons.length?'needs-review':'ordinary',errors};
}

export function routeAccessReport(routes, places) {
  const all=routes.map(r=>inspectRouteAccess(r,places));
  return {scope:'通道结构与候选筛选；不证明现场可通行或人工已阅读来源',total:all.length,documented:all.filter(r=>r.status==='documented').length,
    needsReview:all.filter(r=>r.status==='needs-review').length,errors:all.flatMap(r=>r.errors.map(e=>r.id+': '+e)),rows:all.filter(r=>r.reasons.length||r.errors.length)};
}
