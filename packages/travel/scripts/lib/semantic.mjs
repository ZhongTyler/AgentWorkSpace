import fs from 'node:fs';
import {loadTrip,inside,inputHash,read} from './core.mjs';
import {inspectNarratives} from './narrative.mjs';
import {inspectClaims} from './claims.mjs';
export function semanticAudit(project){
  const trip=loadTrip(project),documents=trip.knowledge.map(k=>({id:k.id,text:fs.readFileSync(inside(project,k.path),'utf8')}));
  return {inputHash:inputHash(project),...inspectNarratives(trip,documents)};
}
export function claimsAudit(project,{asOf}={}){
  const trip=loadTrip(project),documents=trip.knowledge.map(k=>({id:k.id,text:fs.readFileSync(inside(project,k.path),'utf8')}));
  const registryFile=inside(project,'research/registry.json'),registry=(fs.existsSync(registryFile)?read(registryFile):[]).map(r=>({...r,...(r.review?{digestion:read(inside(project,r.review))}:{})}));
  return {inputHash:inputHash(project),...inspectClaims(trip,documents,registry,asOf)};
}
