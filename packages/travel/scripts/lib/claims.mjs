import {safeUrl,uid} from './core.mjs';
import {narrativeSlots,renderFacts} from './narrative.mjs';
const isDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function renderNarrative(trip,text){
  const value=text.replace(/\{\{claim:([^{}]+)\}\}/g,(_,id)=>{
    const claim=(trip.claims||[]).find(c=>c?.id===id);if(!claim)throw Error('Unknown claim '+id);
    if(typeof claim.text!=='string'||claim.text.includes('{{claim:'))throw Error('Claim text cannot reference another claim '+id);
    return renderFacts(trip,claim.text);
  });
  if(value.includes('{{claim:'))throw Error('Malformed claim reference');
  return renderFacts(trip,value);
}
export function inspectClaims(trip,documents=[],registry=[],asOf=new Date().toISOString().slice(0,10)){
  const errors=[],warnings=[],used=[],seen=new Set(),claims=trip.claims||[];
  const err=(id,message)=>errors.push({where:id,message}),warn=(id,message)=>warnings.push({where:id,message});
  if(!isDate(asOf))throw Error('asOf must be YYYY-MM-DD');
  if(!Array.isArray(claims))return {valid:false,errors:[{where:'claims',message:'claims must be an array'}],warnings,semanticAcceptance:'not-evaluated-by-script'};
  const wikiIds=new Set((trip.knowledge||[]).map(k=>k.id));
  for(const c of claims){
    try{
      if(!c||typeof c!=='object'||Array.isArray(c))throw Error('Claim must be an object');
      uid(c.id);if(seen.has(c.id))throw Error('Duplicate claim ID');seen.add(c.id);
      if(!c.text?.trim()||!c.scope?.trim()||!Array.isArray(c.wikiIds)||!c.wikiIds.length)throw Error('Claim needs text, scope and Wiki IDs');
      if(c.wikiIds.some(id=>!wikiIds.has(id)))throw Error('Claim links unknown Wiki');
      if(!['fact','recommendation','experience','uncertain'].includes(c.kind)||!['supported','disputed','unverified'].includes(c.status))throw Error('Invalid claim kind/status');
      if(c.kind==='recommendation'&&!c.rationale?.trim())throw Error('Recommendation needs reasoning, not just a source URL');
      if(c.text.includes('{{claim:'))throw Error('Nested claims are not allowed');renderFacts(trip,c.text);
      if(!isDate(c.checkedAt)||c.checkedAt>asOf)throw Error('Claim needs a real, nonfuture checkedAt');
      if(!isDate(c.reviewAfter)||c.reviewAfter<c.checkedAt)throw Error('Claim needs reviewAfter >= checkedAt');
      if(c.reviewAfter<asOf)warn(c.id,'Claim review is due; do not refresh checkedAt merely by editing');
      if((c.validFrom&&!isDate(c.validFrom))||(c.validUntil&&!isDate(c.validUntil))||(c.validFrom&&c.validUntil&&c.validUntil<c.validFrom))throw Error('Invalid validity window');
      if(!Array.isArray(c.evidence))throw Error('evidence must be an array');
      for(const source of c.evidence){
        if(!safeUrl(source.url)||!source.title?.trim()||!source.locator?.trim()||!source.supports?.trim())throw Error('Evidence needs safe URL, title, locator and exact support');
        if(!['official','firsthand','secondary'].includes(source.kind)||!['supports','contradicts','context'].includes(source.relation))throw Error('Invalid evidence kind/relation');
        if(!isDate(source.checkedAt)||source.checkedAt>asOf)throw Error('Evidence checkedAt must be real and nonfuture');
        if(source.checkedAt>c.checkedAt)warn(c.id,'Evidence is newer than claim review; check whether the conclusion still holds');
        if(source.rawId){
          const row=registry.find(r=>r.id===source.rawId);
          if(!row?.rawHash||row.url!==source.url||row.rawHash!==source.rawHash)throw Error('Evidence raw identity/version mismatch');
          if(!row.digestion||row.digestion.rawHash!==row.rawHash)warn(c.id,'Referenced raw has no current digestion review; saved bytes are not read evidence');
          else if(row.digestion.status!=='complete')warn(c.id,'Raw digestion is partial; scope this conclusion to the actually read evidence');
        }
      }
      if(c.status==='supported'&&!c.evidence.some(e=>e.relation==='supports'))throw Error('Supported claim needs supporting evidence');
      if(c.status==='supported'&&c.evidence.some(e=>e.relation==='contradicts')&&!c.resolution?.trim())throw Error('Contradicting evidence needs an explicit resolution');
      if(c.status!=='supported')warn(c.id,'Claim remains '+c.status+'; expose uncertainty and an executable fallback');
    }catch(e){err(c?.id||'claims',e.message);}
  }
  for(const slot of [...narrativeSlots(trip),...documents.map(d=>({where:d.id,text:d.text}))]){
    try{renderNarrative(trip,slot.text);}catch(e){err(slot.where,e.message);}
    for(const m of slot.text.matchAll(/\{\{claim:([^{}]+)\}\}/g)){
      const c=claims.find(c=>c?.id===m[1]);used.push({where:slot.where,claim:m[1]});
      if(c&&slot.date&&((c.validFrom&&slot.date<c.validFrom)||(c.validUntil&&slot.date>c.validUntil)))warn(c.id,'Narrative date '+slot.date+' falls outside claim validity');
    }
  }
  return {valid:!errors.length,asOf,errors,warnings,used,counts:{claims:claims.length,supportingEvidence:claims.flatMap(c=>Array.isArray(c?.evidence)?c.evidence:[]).filter(e=>e?.relation==='supports').length},semanticAcceptance:'not-evaluated-by-script',sourceAuthority:'Evidence kind and support are editor declarations, not verified by the script.'};
}
export function compileWiki(trip,wiki,text){
  const ids=new Set([...text.matchAll(/\{\{claim:([^{}]+)\}\}/g)].map(m=>m[1]));
  const claims=(trip.claims||[]).filter(c=>c.wikiIds?.includes(wiki.id)||ids.has(c.id));
  const body=renderNarrative(trip,text);if(!claims.length)return body;
  const lines=['','## 结论与依据',''],social=[];
  for(const c of claims){
    lines.push('### '+c.id,'','适用：'+c.scope+'；核验：'+c.checkedAt+'；复查：'+c.reviewAfter+'；状态：'+c.status+'。');
    if(c.kind==='recommendation')lines.push('判断依据：'+c.rationale);
    if(c.resolution)lines.push('冲突处理：'+c.resolution);
    for(const e of c.evidence){
      const title=e.title.replace(/[\[\]\r\n]/g,' '),xhs=/(^|\.)xiaohongshu\.com$/.test(new URL(e.url).hostname);
      if(xhs){social.push(e);lines.push('- '+title+'（原始笔记见文末）：'+e.supports+'；位置：'+e.locator+'；关系：'+e.relation+'。');}
      else lines.push('- ['+title+']('+e.url+')：'+e.supports+'；位置：'+e.locator+'；关系：'+e.relation+'。');
    }
  }
  const appendix=lines.join('\n')+'\n\n',at=body.search(/^## 原始笔记/m);
  let compiled=at<0?body+'\n'+appendix:body.slice(0,at)+appendix+body.slice(at);
  const missing=[...new Map(social.filter(e=>!body.includes(e.url)).map(e=>[e.url,e])).values()];
  if(missing.length){if(at<0)compiled+='\n## 原始笔记与阅读指引\n';compiled+='\n'+missing.map(e=>'- ['+e.title.replace(/[\[\]\r\n]/g,' ')+']('+e.url+')：'+e.supports+'（'+e.locator+'）').join('\n')+'\n';}
  return compiled;
}
