import fs from 'node:fs';
import {loadTrip,inputHash,inside} from './core.mjs';

// Observable coverage and editorial leads, never semantic or visual approval.
export function quality(project){
  const t=loadTrip(project),experiences=t.journal.filter(j=>j.kind==='experience');
  const linked=j=>Array.isArray(j.wikiIds)&&j.wikiIds.some(id=>t.knowledge.some(k=>k.id===id));
  const details=j=>Array.isArray(j.visit?.steps)&&j.visit.steps.length>0;
  const hints=[];
  for(const d of t.days){
    if((d.summary||'').length>120)hints.push({kind:'long-summary',id:d.date,reason:'检查首屏是否需要拆成短要点，不自动截断。'});
    if(!t.journal.some(j=>j.date===d.date))hints.push({kind:'no-reader-content',id:d.date,reason:'转场日也需要真实安排或简短导读，不强凑游玩项目。'});
  }
  for(const j of experiences){
    if(!details(j)&&!linked(j))hints.push({kind:'depth-review',id:j.id,reason:'没有结构化体验步骤或专题入口；人工检查是否已经讲清楚。'});
    if((j.text||'').length>350&&!details(j))hints.push({kind:'dense-prose',id:j.id,reason:'检查介绍、操作和来源是否应该分层。'});
  }
  const repeated=new Map();
  for(const c of t.catalog){
    if(/以下为旧规划|不凭空补|不把没有来源/.test(c.description||''))hints.push({kind:'catalog-process-prose',id:c.id,reason:'介绍应讲餐厅或体验；历史价格说明放在priceNote，不把资料管理过程当介绍。'});
  }
  for(const k of t.knowledge){
    const file=inside(project,k.path);if(!fs.existsSync(file))continue;
    for(const p of fs.readFileSync(file,'utf8').split(/\r?\n\s*\r?\n/).map(p=>p.trim()).filter(p=>p.length>70&&!p.startsWith('- ['))){
      const ids=repeated.get(p)||[];ids.push(k.id);repeated.set(p,ids);
    }
  }
  for(const [text,ids] of repeated)if(ids.length>2)hints.push({kind:'repeated-background',ids,excerpt:text.slice(0,80),reason:'检查是否可放入共同资料说明；安全条件不因此删除。'});
  return {inputHash:inputHash(project),counts:{days:t.days.length,experiences:experiences.length,experiencesWithSteps:experiences.filter(details).length,experiencesWithWiki:experiences.filter(linked).length,placePhotos:t.places.filter(p=>p.photo).length,journalImages:t.journal.filter(j=>j.photo).length,knowledge:t.knowledge.length},hints,semanticAcceptance:'not-evaluated-by-script',visualAcceptance:'not-evaluated-by-script',humanAcceptance:'not-evaluated-by-script'};
}
