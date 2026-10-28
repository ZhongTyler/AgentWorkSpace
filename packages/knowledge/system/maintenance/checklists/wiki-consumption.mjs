import {parentReview, assertReviewOwnership} from './reviewer-route.mjs';
import {verifyPageReview} from './ingest-page-review.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {safe, sha} from './raw-quality.mjs';
import {sectionInventory} from './core-review-control.mjs';
import {reviewerConfiguration, boundReviewerLog} from './ingest-runtime-contract.mjs';
import {substantiveSection} from './ingest-wiki-inputs.mjs';
export {substantiveSection};

const need = (ok, message) => { if (!ok) throw Error('Wiki consumption: ' + message); };
const text = (root, rel) => fs.readFileSync(safe(root, rel), 'utf8').replace(/^\uFEFF/, '');
const json = (root, rel) => JSON.parse(text(root, rel));
const hash = (root, rel) => sha(fs.readFileSync(safe(root, rel)));
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);

// Bookkeeping candidates only; cross-page omissions remain a human/model judgment.
export function consumptionCandidates(root,run,semantic){
  const result=structuredClone(semantic),latest=new Map((run.execution_control.page_reviews??[]).map(r=>[r.page,r]));
  const valid=new Set(),exceptions=[];
  for(const [page,task] of latest){
    if(task.status!=='passed')continue;
    try{verifyPageReview(root,run,semantic.consumption,{path:task.report_path,sha256:task.report_sha256},run.execution_control.parent_reviewer.agent_id);valid.add(page);}catch(error){exceptions.push({page,reason:error.message});}
  }
  for(const row of result.consumption??[])for(const d of row.decisions??[]){
    if(d.disposition==='planned'&&d.destinations?.length&&d.destinations.every(x=>valid.has(x.path)))d.disposition='absorbed';
    else if(d.disposition!=='absorbed')exceptions.push({raw:row.raw,claim_ids:d.claim_ids,disposition:d.disposition,reason:'Confirm actual coverage or explicit exception; no automatic semantic approval.'});
  }
  return {semantic:result,exceptions};
}

export function consumptionMetrics(semantic){
  const rows=semantic.consumption??[],pages=new Set(),destinations=new Set(),claims=new Set();
  let multi=0;
  for(const row of rows){
    const own=new Set();
    for(const d of row.decisions??[]){
      for(const id of d.claim_ids??[])claims.add(JSON.stringify([row.raw,id]));
      for(const to of d.destinations??[]){pages.add(to.path);own.add(to.path);destinations.add(JSON.stringify([row.raw,to.path,to.heading??'']));}
    }
    if(own.size>1)multi++;
  }
  return {raw_count:new Set(rows.map(x=>x.raw)).size,wiki_page_count:pages.size,destination_count:destinations.size,mapped_claim_count:claims.size,multi_page_raw_count:multi,basis:'Distinct Raw, Wiki, Raw/page/heading destinations and Raw/claim IDs. Mapping counts are not semantic PASS.'};
}

// Select an actual paragraph by exact unique anchor; never invent or normalize punctuation.
export function extractQuote(markdown,heading,anchor) {
  need(nonempty(anchor),'exact anchor required');
  const body=substantiveSection(markdown,heading),matches=body.split(/\n\s*\n/).filter(x=>x.includes(anchor));
  need(matches.length===1,'anchor must identify exactly one paragraph');
  const quote=matches[0].trim();need(quote.length>=12,'substantive quote too short');
  return {heading,quote,scope:'actual paragraph only; controller must assess semantic coverage'};
}

// Full section evidence for multi-claim decisions; never change semantic dispositions.
export function bindSectionQuotes(root, semantic) {
  const result=structuredClone(semantic);
  need(Array.isArray(result.consumption),'consumption array required');
  for(const row of result.consumption)for(const decision of row.decisions??[]) {
    if(!['planned','absorbed','existing'].includes(decision.disposition))continue;
    for(const destination of decision.destinations??[]) {
      need(/^wiki\/[^/\\]+\.md$/.test(destination.path),'destination must be a Wiki page');
      destination.quote=substantiveSection(text(root,destination.path),destination.heading).trim();
      need(destination.quote.length>=12,'substantive quote too short');
    }
  }
  return result;
}

export function diagnoseConsumption(root,run,semantic,stage='stage3', {requireReview=true}={}) {
  if(!consumptionEnabled(run))return {status:'legacy_not_required',errors:[]};
  const inventory=consumptionInventory(root,run),errors=[];
  const rows=semantic.consumption;
  if(!Array.isArray(rows))return {status:'failed',errors:['consumption array required']};
  for(const item of inventory){
    const matches=rows.filter(x=>x?.raw===item.raw);
    try{validateConsumption([item],matches,{stage,readWiki:p=>text(root,p),readRegistry:()=>text(root,'system/registry/raw-list.md')});}
    catch(e){errors.push({raw:item.raw,message:e.message});}
    for(const row of matches)for(const d of Array.isArray(row.decisions)?row.decisions:[])for(const to of Array.isArray(d?.destinations)?d.destinations:[]){
      if(!object(to)){errors.push({raw:item.raw,message:'destination must be an object'});continue;}
      if(stage!=='stage3'&&d.disposition!=='existing')continue;
      try{need(nonempty(to.quote)&&to.quote.trim().length>=12&&substantiveSection(text(root,to.path),to.heading).includes(to.quote),'quote absent from substantive section: '+to.path);}
      catch(e){errors.push({raw:item.raw,claim_ids:d.claim_ids,path:to.path,message:e.message});}
    }
  }
  for(const row of rows)if(!inventory.some(x=>x.raw===row?.raw))errors.push({raw:row?.raw,message:'Unknown Raw'});
  if(!errors.length&&run.execution_control?.mechanical_contract_version===1)try {
    validatePreservation(rows,stage==='stage3'?json(root,run.package_data.path).sections.stage2.semantic.consumption:null);
  }catch(e){errors.push({message:e.message});}
  if(!errors.length && requireReview)try{checkConsumption(root,run,semantic,stage);}catch(e){errors.push({message:e.message});}
  return {status:errors.length?'failed':'passed',scope:requireReview?'bound_review':'mechanical_preparation_only',errors};
}

export function consumptionEnabled(run) {
  const state=run.execution_control??{}, version=state.wiki_consumption_contract_version;
  if (state.runtime_contract_version>=3) need(version===1,'runtime v3 requires consumption contract v1');
  if (version===undefined && !(state.runtime_contract_version>=3)) return false;
  need(version===1,'unknown consumption contract version');
  return true;
}

// Reuse the passed audit ledger; legacy inputs use actual Raw section IDs.
export function consumptionInventory(root, run) {
  return (run.artifacts ?? []).filter(x => x.kind === 'raw' && x.disposition === 'ingested').map(a => {
    const audits = (run.content_audits ?? []).filter(x => x.raw_path === a.path);
    need(audits.length === 1, 'expected one passed audit for ' + a.path);
    const audit = audits[0], receipt = json(root, audit.path);
    need(hash(root, audit.path) === audit.sha256 && receipt.status === 'passed', 'audit drift or failure: ' + a.path);
    need(receipt.raw_path === a.path && receipt.raw_sha256 === hash(root, a.path), 'Raw drift: ' + a.path);
    const ledger = json(root, receipt.manifest_path);
    need(hash(root, receipt.manifest_path) === receipt.manifest_sha256, 'ledger drift: ' + a.path);
    const units = Array.isArray(ledger.claims) ? ledger.claims.map(c => ({id:c.id, meaning:c.meaning}))
      : sectionInventory(text(root, a.path)).map(s => ({id:s.id, meaning:s.heading}));
    need(units.length > 0 && new Set(units.map(x => x.id)).size === units.length, 'empty/duplicate inventory');
    return {raw:a.path, ledger:receipt.manifest_path, inventory_kind:Array.isArray(ledger.claims)?'core_claims':'raw_sections', units};
  });
}

// Traceability only: a matching quote is NOT proof of semantic equivalence.
export function validateConsumption(inventory, consumption, {stage='stage3', readWiki, readRegistry} = {}) {
  need(['stage2','stage3'].includes(stage), 'unsupported stage');
  need(Array.isArray(consumption), 'consumption array required');
  const expected = new Set(inventory.map(x => x.raw));
  need(expected.size === inventory.length && consumption.length === expected.size, 'Raw set mismatch');
  const seenRaw = new Set(), summaries = [];
  for (const row of consumption) {
    need(object(row), 'consumption row must be an object');
    need(expected.has(row.raw) && !seenRaw.has(row.raw), 'unknown/duplicate Raw: ' + row.raw);
    seenRaw.add(row.raw);
    const item = inventory.find(x => x.raw === row.raw), ids = new Set(item.units.map(x => x.id)), seen = new Set();
    need(row.ledger === item.ledger, 'use the passed audit ledger');
    need(Array.isArray(row.decisions) && Array.isArray(row.risks), 'decisions and risks arrays required');
    need(row.risks.every(x => ['cross_domain','compressed','writer_recovery'].includes(x)), 'unknown risk');
    need(nonempty(row.coverage_reason), 'explain full Raw coverage and cross-domain decision');
    const pages = new Set(); let deferred = 0;
    for (const d of row.decisions) {
      need(object(d), row.raw + ': decision must be an object');
      need(Array.isArray(d.claim_ids) && d.claim_ids.length && nonempty(d.reason), 'claim IDs and reason required');
      for (const id of d.claim_ids) { need(ids.has(id) && !seen.has(id), 'unknown/duplicate claim: ' + id); seen.add(id); }
      need(['planned','absorbed','existing','deferred','not_applicable'].includes(d.disposition), 'unknown disposition');
      need(stage !== 'stage3' || d.disposition !== 'planned', 'unexecuted plan at Stage3');
      if (['planned','absorbed','existing'].includes(d.disposition)) {
        need(Array.isArray(d.destinations) && d.destinations.length, 'actual destination required');
        for (const to of d.destinations) {
          need(object(to), row.raw + ': destination must be an object');
          need(typeof to.path === 'string' && /^wiki\/[^/\\]+\.md$/.test(to.path) && !/^(?:wiki\/README|wiki\/.*\.template)\.md$/.test(to.path), 'destination must be a Wiki page');
          need(nonempty(to.heading), 'exact heading required'); pages.add(to.path);
          if (stage === 'stage3' || d.disposition === 'existing') {
            need(typeof readWiki === 'function' && nonempty(to.quote), 'body evidence required');
            const prose = readWiki(to.path).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/<!--[\s\S]*?(?:-->|$)/g, '');
            let fence=null;
            const lines = prose.split(/\r?\n/).map(x => {
              const marker=x.match(/^\s*(`{3,}|~{3,})/);
              if(marker) { if(!fence) fence=marker[1]; else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length) fence=null; return ''; }
              return fence ? '' : x;
            });
            const start = lines.findIndex(x => /^#{1,6} /.test(x) && x.replace(/^#+\s*/, '') === to.heading);
            need(start >= 0 && !['来源','相关页面'].includes(to.heading), 'body heading missing: ' + to.path);
            const depth = lines[start].match(/^#+/)[0].length;
            let end = start + 1;
            while (end < lines.length && !(new RegExp('^#{1,' + depth + '} ')).test(lines[end])) end++;
            const body = lines.slice(start+1,end).filter(x => !/^\s*(?:>|-\s*\[\[raw-sources\/)/.test(x)).join('\n');
            need(to.quote.trim().length >= 12 && body.includes(to.quote), 'quote absent from substantive section: ' + to.path);
          }
        }
      } else {
        need(!d.destinations?.length, 'nonconsumed decision cannot claim destinations');
        if (d.disposition === 'deferred') {
          deferred += d.claim_ids.length;
          need(nonempty(d.review_when) && nonempty(d.registry_tag), 'deferred needs concrete tag and reopening condition');
          if (stage === 'stage3') {
            const registry = readRegistry?.() ?? '';
            const line = registry.split(/\r?\n/).find(x => x.split('|')[1]?.trim() === row.raw.slice('raw-sources/'.length));
            need(line?.split('|')[6]?.includes(d.registry_tag), 'deferred knowledge missing from raw-list unconsumed column');
          }
        }
      }
    }
    need(seen.size === ids.size, 'missing claims: ' + [...ids].filter(x => !seen.has(x)).join(', '));
    summaries.push({raw:row.raw,claims:ids.size,wiki_pages:pages.size,deferred,risks:row.risks});
  }
  return {status:'passed',scope:'mechanical traceability only; not semantic approval',rows:summaries};
}

export function checkConsumption(root, run, semantic, stage='stage3') {
  if (!consumptionEnabled(run)) return {status:'legacy_not_required'};
  const result = validateConsumption(consumptionInventory(root,run), semantic.consumption, {stage,
    readWiki:rel=>text(root,rel),readRegistry:()=>text(root,'system/registry/raw-list.md')});
  if(run.execution_control?.mechanical_contract_version===1) {
    const planned=stage==='stage3'?json(root,run.package_data.path).sections.stage2.semantic.consumption:null;
    validatePreservation(semantic.consumption,planned);
  }
  if (stage==='stage3' && (parentReview(run) || semantic.consumption.some(x=>x.risks.length))) {
    const ref=semantic.consumption_review;
    need(object(ref) && nonempty(ref.path) && ref.path.endsWith('.json'), 'risk review must be run-local');
    const runDirectory=path.dirname(path.resolve(root,run.package_data.path));
    need(path.resolve(root,ref.path).startsWith(runDirectory+path.sep),'risk review must be run-local after path resolution');
    need(hash(root,ref.path)===ref.sha256,'risk review hash drift');
    const report=json(root,ref.path);
    if(parentReview(run))verifyParentPages(root,run,semantic,report);
    result.risk_review=validateRiskReview(run,semantic.consumption,report,rel=>hash(root,rel));
    result.risk_review.configuration=reviewerConfiguration({run,agent:report.reviewer_agent_id,log:boundReviewerLog(run,report.reviewer_agent_id)});
  }
  return result;
}

export function validateRiskReview(run, consumption, report, hashFile) {
  need(report?.schema_version===1 && report.status==='passed' && Array.isArray(report.findings) && !report.findings.length,'risk review not passed or has findings');
  if(run.execution_control?.mechanical_contract_version===1 || report.consumption_sha256!==undefined)need(report.consumption_sha256===sha(JSON.stringify(consumption)),'consumption decisions drift since review preparation');
  assertReviewOwnership(run,report.reviewer_agent_id,consumption.filter(x=>parentReview(run)||x.risks.length).flatMap(x=>[x.raw,...x.decisions.flatMap(d=>(d.destinations??[]).filter(t=>!parentReview(run)||run.execution_control.artifact_authors?.[t.path]).map(t=>t.path))]));
  const risky=consumption.filter(x=>parentReview(run)||x.risks.length), all=new Set(consumption.map(x=>x.raw));
  need(Array.isArray(report.reviewed_raws) && new Set(report.reviewed_raws).size===report.reviewed_raws.length && report.reviewed_raws.every(x=>all.has(x)) && risky.every(x=>report.reviewed_raws.includes(x.raw)),'risk review Raw coverage mismatch');
  const expected=new Set(risky.flatMap(x=>[x.raw,...x.decisions.flatMap(d=>(d.destinations??[]).map(to=>to.path))]));
  need(Array.isArray(report.input_hashes),'risk review needs bound inputs');
  const observed=new Set();
  for(const input of report.input_hashes) {need(object(input),'risk input must be an object');need(expected.has(input.path)&&!observed.has(input.path),'unknown/duplicate risk input');observed.add(input.path);need(hashFile(input.path)===input.sha256,'risk input drift: '+input.path);}
  need(observed.size===expected.size,'risk review missing Raw/Wiki inputs');
  need(nonempty(report.coverage_summary),'risk review needs semantic explanation');
  return {status:'bound',reviewer_agent_id:report.reviewer_agent_id,raw_count:risky.length,scope:parentReview(run)?'parent non-author report and inputs bound; not fresh-context independence or proof of correctness':'independent report and inputs bound; model configuration checked separately; not proof of semantic correctness'};
}

export function validatePreservation(consumption,planned=null) {
  for(const row of consumption)for(const d of row.decisions) {
    need(Array.isArray(d.must_preserve)&&d.must_preserve.length>0&&d.must_preserve.every(nonempty),'decision needs must_preserve semantic dimensions');
    if(planned)for(const id of d.claim_ids) {
      const prior=planned.find(x=>x.raw===row.raw)?.decisions.find(x=>x.claim_ids.includes(id));
      need(prior&&Array.isArray(prior.must_preserve)&&prior.must_preserve.every(x=>d.must_preserve.includes(x)),'planned dimensions dropped: '+row.raw+' '+id);
    }
  }
}

// Fill identity and current hashes before dispatch. No default semantic approval.
export function prepareRiskReview(root,run,semantic,agent) {
  need(!['completed','awaiting_final_review'].includes(run.status),'sealed/completed run is read-only');
  assertReviewOwnership(run,agent,parentReview(run)?[...semantic.consumption.map(x=>x.raw),...semantic.rows.map(x=>x.artifact)]:semantic.consumption.filter(x=>x.risks.length).flatMap(x=>[x.raw,...x.decisions.flatMap(d=>(d.destinations??[]).map(t=>t.path))]));
  const risky=semantic.consumption.filter(x=>parentReview(run)||x.risks.length);
  need(risky.length,'no risk review needed');
  if(run.execution_control?.mechanical_contract_version===1)validatePreservation(semantic.consumption,json(root,run.package_data.path).sections.stage2.semantic.consumption);
  const paths=[...new Set(risky.flatMap(x=>[x.raw,...x.decisions.flatMap(d=>(d.destinations??[]).map(to=>to.path))]))].sort();
  return {schema_version:1,reviewer_agent_id:agent,status:'pending',reviewed_raws:risky.map(x=>x.raw),...(parentReview(run)?{review_mode:'parent_non_author',page_reviews:[]}:{}),
    input_hashes:paths.map(p=>({path:p,sha256:hash(root,p)})),consumption_sha256:sha(JSON.stringify(semantic.consumption)),
    coverage_summary:'',findings:[],requirements:risky.map(x=>({raw:x.raw,decisions:x.decisions.map(d=>({claim_ids:d.claim_ids,must_preserve:d.must_preserve??[]}))})),
    instruction:parentReview(run)?'Parent reviewer verifies collected page evidence, all claim dispositions including deferred/excluded claims and cross-page omissions. Read complete relevant Raw, every changed destination section and affected existing context during per-page review; expand context when placement, conflicts or dependencies remain unclear. Fill only status, findings and coverage_summary after actual semantic review. This is non-author review, not fresh-context independence. Reuse unchanged page evidence; changed page or decision scope requires affected review only.':'Before reading prose on every initial/continued/resumed turn, run ingest-runtime-contract.mjs agent-preflight --run <bound run absolute path> --agent <reviewer_agent_id> --turn-started-at <dispatch UTC timestamp>. Require current-turn PASS; on mismatch stop and report actual configuration. Then read complete listed Raw and destination Wiki. Review every independent claim dimension and unjustified exclusion, not just title/keywords. Edit only status, findings and coverage_summary. Do not refresh hashes or identity. If inputs change, prepare a new version and recheck affected content; no host-authored PASS.'};
}
export function bindRiskReview(root,run,semantic,reportPath,{log}={}) {
  need(!['completed','awaiting_final_review'].includes(run.status),'sealed/completed run is read-only');
  const directory=path.dirname(safe(root,run.package_data.path));
  need(safe(root,reportPath).startsWith(directory+path.sep),'review report must be run-local');
  const report=json(root,reportPath);
  if(parentReview(run))verifyParentPages(root,run,semantic,report);
  validateRiskReview(run,semantic.consumption,report,p=>hash(root,p));
  reviewerConfiguration({run,agent:report.reviewer_agent_id,log:log??boundReviewerLog(run,report.reviewer_agent_id)});
  return {...semantic,consumption_review:{path:reportPath,sha256:hash(root,reportPath)}};
}

function verifyParentPages(root,run,semantic,report){
  assertReviewOwnership(run,report.reviewer_agent_id,semantic.rows.map(x=>x.artifact));
  if(report.review_mode!=='parent_non_author'||!Array.isArray(report.page_reviews))throw Error('Parent review must declare context boundary and page evidence');
  const expected=[...new Set(semantic.consumption.flatMap(x=>x.decisions.flatMap(d=>(d.destinations??[]).map(t=>t.path))))].sort();
  const pages=report.page_reviews.map(ref=>{
    if(!safe(root,ref.path).startsWith(path.dirname(safe(root,run.package_data.path))+path.sep))throw Error('Page evidence must be run-local');
    return verifyPageReview(root,run,semantic.consumption,ref,report.reviewer_agent_id).page;
  }).sort();
  if(JSON.stringify(pages)!==JSON.stringify(expected))throw Error('Page review set must exactly cover all consumption destinations');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action,...argv]=process.argv.slice(2), args={};
    for(let i=0;i<argv.length;i+=2) { need(argv[i].startsWith('--') && argv[i+1], 'expected --key value'); args[argv[i].slice(2)]=argv[i+1]; }
    need(['metrics','inventory','check','diagnose','prepare','extract','bind-quotes','prepare-review','bind-review'].includes(action),'unknown action');
    if(action==='metrics'){console.log(JSON.stringify(consumptionMetrics(json(args.root,args.semantic)),null,2));process.exit(0);}
    if(action==='bind-quotes') {
      const result=bindSectionQuotes(args.root,json(args.root,args.semantic));
      fs.writeFileSync(safe(args.root,args.output,false),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
      console.log(JSON.stringify({status:'generated',path:args.output,scope:'section evidence only; dispositions and review remain unchanged'}));process.exit(0);
    }
    if(action==='extract'){console.log(JSON.stringify(extractQuote(text(args.root,args.wiki),args.heading,args.anchor),null,2));process.exit(0);}
    const run=json(args.root,args.run);
    if(action==='bind-review') {
      const result=bindRiskReview(args.root,run,json(args.root,args.semantic),args.report);
      const output=safe(args.root,args.output,false),directory=path.dirname(safe(args.root,run.package_data.path));
      need(output.startsWith(directory+path.sep),'bound semantic must be run-local');
      fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
      console.log(JSON.stringify({status:'bound',path:args.output,review:result.consumption_review}));process.exit(0);
    }
    if(action==='prepare-review') {
      const semantic=json(args.root,args.semantic),report=prepareRiskReview(args.root,run,semantic,args.agent);
      if(parentReview(run)) {
        need(args.pages,'Parent aggregate needs --pages <JSON array of page report paths>');
        const pages=json(args.root,args.pages);
        need(Array.isArray(pages)&&pages.every(nonempty),'Page report paths must be an array');
        report.page_reviews=pages.map(p=>({path:p,sha256:hash(args.root,p)}));
        verifyParentPages(args.root,run,semantic,report);
      }
      const output=safe(args.root,args.output,false),directory=path.dirname(safe(args.root,run.package_data.path));
      need(output.startsWith(directory+path.sep),'review template must be run-local');
      fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
      console.log(JSON.stringify({status:'pending',path:args.output,reviewer_agent_id:args.agent,input_count:report.input_hashes.length}));process.exit(0);
    }
    const result=action==='inventory'?consumptionInventory(args.root,run):['diagnose','prepare'].includes(action)?diagnoseConsumption(args.root,run,json(args.root,args.semantic),args.stage??'stage3',{requireReview:action!=='prepare'}):checkConsumption(args.root,run,json(args.root,args.semantic),args.stage??'stage3');
    console.log(JSON.stringify(result,null,2));if(result.status==='failed')process.exitCode=1;
  } catch(e) { console.error(e.message); process.exitCode=1; }
}
