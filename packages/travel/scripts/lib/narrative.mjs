// Pure narrative bindings. They resolve current facts, never a copied expected value.
const fields={
  trip:['title','start','end'],orders:['title','date','start','end','party','amount'],
  catalog:['name','price','openingHours','verifiedAt'],places:['name','address'],days:['date','city','party']
};
function price(value){
  if(!value||!Number.isFinite(value.min)||!Number.isFinite(value.max)||!/^[A-Z]{3}$/.test(value.currency||''))throw Error('Referenced price is incomplete');
  return (value.min===value.max?value.min:value.min+'–'+value.max)+' '+value.currency+(value.basis==='person'?' / 人':value.basis==='total'?' / 合计':'');
}
export function factValue(trip,ref){
  const parts=String(ref).split('/'),group=parts[0],field=parts.at(-1);
  if(!fields[group]?.includes(field)||(group==='trip'?parts.length!==2:parts.length!==3))throw Error('Unsupported fact reference '+ref);
  const item=group==='trip'?trip:(trip[group]||[]).find(x=>(group==='days'?x.date:x.id)===parts[1]);
  if(!item)throw Error('Unknown fact entity '+ref);
  const value=item[field];
  if(value===null||value===undefined||value==='')throw Error('Missing fact value '+ref);
  if(['price','amount'].includes(field))return price(field==='amount'?{...value,basis:'total'}:value);
  if(!['string','number'].includes(typeof value)||String(value).includes('{{'))throw Error('Fact must be a scalar, not another reference '+ref);
  return String(value);
}
export function renderFacts(trip,text){
  if(typeof text!=='string')throw Error('Narrative must be text');
  const rendered=text.replace(/\{\{fact:([^{}]+)\}\}/g,(_,ref)=>factValue(trip,ref));
  if(rendered.includes('{{fact:'))throw Error('Malformed fact reference');
  return rendered;
}
// Exact editable prose slots, not a recursive scan of private/structured fields.
export function narrativeSlots(trip){
  const slots=[];
  const add=(parent,key,where,context={})=>{if(typeof parent?.[key]==='string')slots.push({parent,key,where,text:parent[key],...context});};
  const list=(parent,key,where,context)=>{for(let i=0;i<(parent?.[key]||[]).length;i++)add(parent[key],i,where+'.'+key+'['+i+']',context);};
  for(const p of trip.places||[])add(p,'description','places/'+p.id+'/description',{placeIds:[p.id]});
  for(const c of trip.catalog||[])for(const key of ['description','recommendation','priceNote'])add(c,key,'catalog/'+c.id+'/'+key,{placeIds:[c.placeId]});
  for(const j of trip.journal||[]){
    const context={date:j.date,placeIds:j.placeIds||[]};
    for(const key of ['title','text'])add(j,key,'journal/'+j.id+'/'+key,context);
    for(const key of ['duration','tip'])add(j.visit,key,'journal/'+j.id+'/visit/'+key,context);
    list(j.visit,'steps','journal/'+j.id+'/visit',context);
  }
  for(const d of trip.days||[]){
    const context={date:d.date};
    for(const key of ['summary','notes'])add(d,key,'days/'+d.date+'/'+key,context);
    list(d,'highlights','days/'+d.date,context);
    for(const [i,t] of (d.timeline||[]).entries())for(const key of ['title','note'])add(t,key,'days/'+d.date+'/timeline/'+i+'/'+key,{date:d.date,placeIds:[t.placeId].filter(Boolean)});
    for(const [i,m] of (d.meals||[]).entries())add(m,'note','days/'+d.date+'/meals/'+i+'/note',context);
  }
  for(const group of ['shopping','guides'])for(const card of trip[group]||[])add(card,'summary',group+'/'+card.id+'/summary');
  for(const key of ['kicker','headline','subtitle','journeyTitle'])add(trip.presentation,key,'presentation/'+key);
  return slots;
}
export function expandNarratives(trip,data,render=renderFacts){
  for(const slot of narrativeSlots(data))slot.parent[slot.key]=render(trip,slot.text);
  return data;
}
export function inspectNarratives(trip,documents=[]){
  const errors=[],warnings=[],references=[];
  for(const slot of [...narrativeSlots(trip),...documents.map(d=>({where:d.id,text:d.text}))]){
    try{renderFacts(trip,slot.text);}catch(e){errors.push({where:slot.where,message:e.message});}
    for(const m of slot.text.matchAll(/\{\{fact:([^{}]+)\}\}/g))references.push({where:slot.where,fact:m[1]});
    // Hints only: this is not natural-language entailment. Linked refs are excluded.
    const literal=slot.text.replace(/\{\{(?:fact|claim):[^{}]+\}\}/g,'');
    const orders=(trip.orders||[]).filter(o=>o.status==='booked'&&o.date===slot.date&&slot.placeIds?.includes(o.placeId));
    if(/预订|预约|订位|集合|reservation|booked|meeting/i.test(literal))for(const m of literal.matchAll(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/g)){
      if(orders.length&&!orders.some(o=>[o.start,o.end].includes(m[0])))warnings.push({where:slot.where,kind:'booking-time-literal',literal:m[0],orderIds:orders.map(o=>o.id),message:'Literal time differs from linked booking; review context or use a fact reference.'});
    }
    const catalogs=(trip.catalog||[]).filter(c=>slot.placeIds?.includes(c.placeId)&&c.price);
    for(const m of literal.matchAll(/\b(\d+(?:\.\d{1,2})?)\s*(NOK|SEK|GBP|EUR|CNY|USD|AUD)\b/g)){
      const matched=catalogs.filter(c=>c.price.currency===m[2]),value=Number(m[1]);
      if(matched.length&&!matched.some(c=>value>=c.price.min&&value<=c.price.max))warnings.push({where:slot.where,kind:'price-literal',literal:m[0],catalogIds:matched.map(c=>c.id),message:'Literal price falls outside linked catalogue range; historical or different menu prices need attribution.'});
    }
  }
  for(const order of (trip.orders||[]).filter(o=>o.status==='booked'&&o.placeId&&o.start)){
    const day=(trip.days||[]).find(d=>d.date===order.date),visits=(day?.timeline||[]).filter(t=>t.placeId===order.placeId&&!t.routeId&&(!t.branch||t.branch==='default'));
    if(visits.length&&!visits.some(t=>t.start<=order.start&&t.end>=(order.end||order.start)))warnings.push({where:'orders/'+order.id,kind:'booking-window',message:'Booked time is outside every same-place visit window; review the timeline or explicitly link orderId.'});
  }
  return {valid:!errors.length,errors,warnings,references,coverage:'Registered fact references and scoped time/price leads only; unlinked prose and world facts need editorial review.',semanticAcceptance:'not-evaluated-by-script'};
}
