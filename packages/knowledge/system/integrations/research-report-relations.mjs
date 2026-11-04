/** Typed discovery metadata only. Catalog owns relations; Wiki/Group blocks are projections. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const relationMarker='research-report-links';
const block=/\n?<!-- generated:research-report-links:start -->[\s\S]*?<!-- generated:research-report-links:end -->\n?/g;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
export const withoutResearchNavigation=text=>text.replaceAll('\r\n','\n').replace(block,'\n').trimEnd();
export const anchorHash=text=>sha(withoutResearchNavigation(text));
export const researchRef=(id,unit)=>`knowledge:research:${id}/${encodeURIComponent(unit)}`;
export function wikiPath(value){
 if(typeof value!=='string')return null;
 if(value.startsWith('knowledge:wiki:'))value='wiki/'+value.slice('knowledge:wiki:'.length).replace(/\.md$/,'')+'.md';
 return /^wiki\/[^/\\]+\.md$/.test(value)&&!value.includes('\0')?value:null;
}
export function safeRelationFile(root,relative){
 const base=fs.realpathSync(root),file=fs.realpathSync(path.resolve(base,relative)),rel=path.relative(base,file);
 if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)||!fs.statSync(file).isFile())throw Error('relation_path_outside_root');
 return file;
}
const scalar=(text,key)=>new RegExp('^'+key+':\\s*([^\\r\\n]+)','m').exec(text)?.[1].trim().replace(/^['"]|['"]$/g,'')??'';
const list=(text,key)=>{const value=scalar(text,key);return value.startsWith('[')?value.slice(1,-1).split(',').map(v=>v.trim().replace(/^['"]|['"]$/g,'')).filter(Boolean):[];};
export function relationAnchor(root,from,read=file=>fs.readFileSync(file,'utf8')){
 const relative=from?.kind==='wiki'?wikiPath(from.path):from?.kind==='group'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(from.id)?`groups/${from.id}.md`:null;
 if(!relative)throw Error('invalid_relation_anchor');
 const text=read(safeRelationFile(root,relative));
 if(from.kind==='group'){
  if(scalar(text,'id')!==from.id||scalar(text,'status')!=='active'||scalar(text,'approval_status')!=='approved')throw Error('relation_group_not_active_approved');
  const receipt=scalar(text,'last_review_receipt');
  if(!/^(docs|system)\/.+\.json$/.test(receipt))throw Error('relation_group_review_missing');
  const record=JSON.parse(read(safeRelationFile(root,receipt)).replace(/^\uFEFF/,''));
  if(record.group_id!==from.id||record.definition_hash!==scalar(text,'definition_hash')||record.repository_revision!==scalar(text,'reviewed_revision'))throw Error('relation_group_review_mismatch');
 }
 return {path:relative,text,sha256:anchorHash(text),names:from.kind==='group'?[from.id,scalar(text,'name'),...list(text,'aliases')]:[relative]};
}
const nonempty=v=>typeof v==='string'&&v.trim().length>0;
export function relationShape(link){
 if(!link||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(link.id)||!nonempty(link.unit)||!['mechanism_example','counterexample','comparison'].includes(link.relation)||!nonempty(link.purpose))throw Error('invalid_relation_shape');
 for(const field of ['terms','questions','conditions','exclusions'])if(!Array.isArray(link[field])||!link[field].length||link[field].some(v=>!nonempty(v)))throw Error('invalid_relation_'+field);
 if(!Array.isArray(link.evidence)||!link.evidence.length||link.evidence.some(e=>!nonempty(e.path)||!nonempty(e.heading)))throw Error('invalid_relation_evidence');
}
export function checkRelation(root,entry,link,{read,anchors}={}){
 relationShape(link);
 if(link.status!=='active')throw Error('relation_not_active');
 const review=link.review;
 if(review?.status!=='approved'||!nonempty(review.reviewer_id)||!nonempty(review.rationale)||!Number.isFinite(Date.parse(review.reviewed_at)))throw Error('relation_not_reviewed');
 if(review.manifest_sha256!==entry.manifest_sha256)throw Error('relation_manifest_changed');
 const key=JSON.stringify(link.from);
 let anchor=anchors?.get(key);
 if(!anchor){anchor=relationAnchor(root,link.from,read);anchors?.set(key,anchor);}
 if(review.anchor_sha256!==anchor.sha256)throw Error('relation_anchor_changed');
 return anchor;
}
/** Match explicit useful vocabulary in the current need; anchor membership alone is never sufficient. */
export function matchingTerms(link,request){
 const texts=[request.need.question,...request.need.critical_questions,...request.terms,...request.reformulations].map(x=>x.toLowerCase());
 const matched=link.terms.filter(term=>texts.some(t=>t.includes(term.toLowerCase())));
 const normalize=text=>text.trim().replace(/[？?！!。]+$/u,'').trim();
 for(const question of link.questions??[]){const q=normalize(question.toLowerCase());if(q&&texts.some(t=>normalize(t).includes(q)))matched.push('question:'+question);}
 // Exclusions describe semantic boundaries for the selecting Agent, not a fabricated keyword classifier.
 return [...new Set(matched)];
}
export function relationSelected(link,anchor,request,wikiCandidates=[]){
 if(!request.sources.wiki)return false;
 if(link.from.kind==='wiki')return new Set([...request.paths,...request.related_from,...wikiCandidates].map(wikiPath).filter(Boolean)).has(anchor.path);
 return request.groups.some(g=>anchor.names.includes(g));
}
const clean=s=>s.replaceAll('\n',' ').replaceAll('\r',' ').replaceAll('[','(').replaceAll(']',')');
export function navigationBlock(root,anchorPath,rows){
 if(!rows.length)return '';
 const lines=['<!-- generated:research-report-links:start -->','## 补充案例研究','',
  '> 以下是按问题选读的研究候选，独立于Raw来源与Wiki Group成员；未读正文不作证据。'];
 for(const {entry,link} of rows){
  // Human link targets are derived from the accepted manifest by the maintenance caller.
  if(!link.navigation_target)throw Error('navigation_target_required');
  const target=link.navigation_target;
  lines.push('',`- [${clean(entry.title)} · ${clean(link.unit)}](<${target}>)（${link.relation}）：${clean(link.purpose)}`,
   `  - 适用：${link.conditions.map(clean).join('；')}。排除：${link.exclusions.map(clean).join('；')}。`,
   `  - 稳定引用：\`${researchRef(entry.id,link.unit)}\`；仅提供定位与原研究范围，不代表独立互证或本次看图/听音。`);
 }
 lines.push('<!-- generated:research-report-links:end -->');return lines.join('\n');
}
export function projectNavigation(text,generated){
 const normalized=text.replaceAll('\r\n','\n'),starts=(normalized.match(/<!-- generated:research-report-links:start -->/g)??[]).length,ends=(normalized.match(/<!-- generated:research-report-links:end -->/g)??[]).length;
 if(starts!==ends||starts>1)throw Error('malformed_research_navigation');
 const eol=text.includes('\r\n')?'\r\n':'\n';
 const base=normalized.replace(block,'\n').trimEnd()+'\n';
 // Wiki source/related sections remain footers. Group member blocks are untouched.
 const footer=/^## (?:相关页面|来源)\s*$/m.exec(base);
 const next=generated?(footer?base.slice(0,footer.index)+generated+'\n'+base.slice(footer.index):base.trimEnd()+'\n\n'+generated+'\n'):base;
 return next.replaceAll('\n',eol);
}
