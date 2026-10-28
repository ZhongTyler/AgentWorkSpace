import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const VERSION = 'knowledge-health/2';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const rel = value => value.replaceAll('\\', '/');
function safe(root, value) {
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw Error(`Path escapes Knowledge: ${value}`);
  let cursor = resolved;
  while (!fs.existsSync(cursor) && cursor !== root) cursor = path.dirname(cursor);
  const real = fs.realpathSync(cursor);
  if (real !== root && !real.startsWith(root + path.sep)) throw Error(`Symlink escapes Knowledge: ${value}`);
  return resolved;
}
function files(root, prefix) {
  const target = safe(root, prefix);
  if (!fs.existsSync(target)) return [];
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw Error(`Health refuses linked input: ${prefix}`);
  if (!stat.isDirectory()) return [rel(path.relative(root, target))];
  return fs.readdirSync(target).sort().flatMap(name => files(root, rel(path.join(prefix, name))));
}
function json(root, name, fallback = null) {
  const full = safe(root, name);
  return fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '')) : fallback;
}
function manifest(root, prefixes) {
  return Object.fromEntries([...new Set(prefixes.flatMap(p => files(root, p)))].sort().map(p => [p, sha(fs.readFileSync(safe(root, p)))]));
}
// Invocation-local snapshot, never an mtime-based or cross-run validity cache.
export function healthInputs(root) {
  const lists=new Map(),hashes=new Map();
  const stats={list_requests:0,list_hits:0,hash_requests:0,hashed_files:0};
  const fingerprint=p=>{stats.hash_requests++;if(!hashes.has(p)){hashes.set(p,sha(fs.readFileSync(safe(root,p))));stats.hashed_files++;}return hashes.get(p);};
  const collect=prefixes=>Object.fromEntries([...new Set(prefixes.flatMap(p=>{stats.list_requests++;if(lists.has(p))stats.list_hits++;else lists.set(p,files(root,p));return lists.get(p);} ))].sort().map(p=>[p,fingerprint(p)]));
  return {manifest:collect,fingerprint,stats};
}
// Only explicitly delimited historical projections are excluded. An unmatched
// marker remains visible, so a damaged boundary cannot hide a current warning.
export function currentStatusText(text) {
  return text.replace(/<!-- status-history:start -->[\s\S]*?<!-- status-history:end -->/g, '');
}
function finding(code, file, detail, severity = 'warning', kind = 'mechanical') {
  return { code, path: file, detail, severity, kind, owner: kind === 'semantic_review' ? 'knowledge-content-owner' : 'knowledge-maintainer', action: kind === 'semantic_review' ? 'Review meaning and applicability; preserve original decision until re-reviewed.' : 'Inspect affected authority and repair only within authorized scope, then recheck.', authorization: /^(wiki|raw-sources|Clippings|domains|groups)\//.test(file) ? 'content-owner authorization required for edits' : 'explicit derived-maintenance scope required for writes' };
}
const definitions = [
  ['graph', 'check-knowledge-graph.ps1', [], ['wiki','raw-sources','domains','Clippings','system/registry']],
  ['page_health', 'check-wiki-page-health.ps1', ['-Mode','Report'], ['wiki','system/maintenance/wiki-split-closures.json']],
  ['governance', 'check-wiki-governance.ps1', ['-Mode','Report'], ['wiki','raw-sources','domains','NOW.md','system/registry/KNOWLEDGE_STATUS.md','system/maintenance/wiki-semantic-review-closures.json','system/maintenance/wiki-split-closures.json']],
  ['groups', 'check-wiki-groups.ps1', ['-Mode','Enforce','-RequireGroupsField','-RejectLegacyThemes'], ['wiki','groups','system/registry','system/maintenance']],
  ['group_navigation', 'sync-wiki-groups.ps1', ['-Mode','Check'], ['wiki','groups','system/registry','system/maintenance']],
  ['quick_reference', 'sync-quick-reference-groups.ps1', ['-Mode','Check'], ['wiki','groups','system/registry','system/maintenance']],
  ['source_ledgers', 'sync-wiki-source-ledgers.ps1', ['-Mode','Check'], ['wiki','raw-sources','system/registry']],
  ['link_anchors', 'sync-wiki-link-anchors.ps1', ['-Mode','Check'], ['wiki','system/maintenance/wiki-related-page-anchor-overrides.json']],
  ['capacity', 'sync-capacity-risks.ps1', ['-Mode','Check'], ['wiki','NOW.md','system/registry','system/maintenance/wiki-split-closures.json']],
  ['clipping_identity', 'sync-clipping-migration-hashes.ps1', ['-Mode','Check'], ['Clippings','raw-sources','system/registry/clipping-path-migrations.json']],
  ['query_contract', 'run-query-contract.ps1', [], ['README.md','AGENTS.md','COMMAND_MANUAL.md','system/README.md','system/integrations','system/query']]
];
// Content decisions bind policy, while executable check receipts bind code.
// A formatting or unrelated ingest-script change must not invalidate a semantic decision.
const closurePolicies = {
  'wiki-split/v1': ['wiki/README.md','system/protocols/WIKI-LINK-STANDARD.md','groups/README.md'],
  'wiki-semantic/v1': ['wiki/README.md'],
  'health-review/v1': ['system/maintenance/checklists/knowledge-health-check.md','wiki/README.md']
};
export function closureRuleBindings(root, collect = prefixes=>manifest(root,prefixes)) {
  return Object.fromEntries(Object.entries(closurePolicies).map(([scope,paths]) => {
    const inputs=collect(paths);
    return [scope,{hash:sha(JSON.stringify(inputs)),inputs,missing:paths.filter(p=>!Object.hasOwn(inputs,p))}];
  }));
}
// One validity decision owns both closure reminders and discovery disposition.
export function closureReviewReasons(entry, {root, closureRules, expectedScope, ruleHash, now, events=[], changed=[], fingerprint=p=>sha(fs.readFileSync(safe(root,p)))}) {
 const bound=entry.input_hashes,reasons=[];
 if(!bound||!Object.keys(bound).length) reasons.push('legacy closure has no input version binding; cannot certify still current');
 else for(const [p,h]of Object.entries(bound))if(!fs.existsSync(safe(root,p))||fingerprint(p)!==h)reasons.push(`input changed: ${p}`);
 if(entry.rule_scope){
  if(entry.rule_scope!==expectedScope)reasons.push('invalid rule scope');
  else if(closureRules[expectedScope].missing.length)reasons.push('required policy file missing');
  else if(entry.rule_hash&&entry.rule_hash!==closureRules[expectedScope].hash)reasons.push('scoped policy changed');
 }else if(entry.rule_hash&&entry.rule_hash!==ruleHash)reasons.push('legacy global rules changed; review before scoped migration');
 if(entry.review_by&&(!Number.isFinite(Date.parse(entry.review_by))||Date.parse(entry.review_by)<=Date.parse(now)))reasons.push('review date reached');
 if(entry.review_events?.some(e=>events.includes(e)))reasons.push('review event reached');
 if(changed.some(p=>(p===entry.path||entry.path==='wiki'&&p.startsWith('wiki/'))&&!Object.hasOwn(bound??{},p)))reasons.push('affected content has no current binding');
 if(!entry.review_by&&!entry.review_events?.length)reasons.push('review_when needs Agent interpretation; no machine-evaluable deadline or event');
 if(!entry.rule_hash)reasons.push('no rule version binding');
 return reasons;
}
export function applyReviewDisposition(f, {root, closures}) {
 if(f.severity!=='warning')return f; // Never downgrade an error or an unknown code.
 const split='system/maintenance/wiki-split-closures.json',semantic='system/maintenance/wiki-semantic-review-closures.json';
 const current=c=>!c.reasons.length&&Object.hasOwn(c.entry.input_hashes??{},f.path),nonempty=v=>typeof v==='string'&&v.trim().length>0;
 let match;
 try{
  const completed=r=>r.state==='completed'&&r.plan&&r.receipt&&fs.existsSync(safe(root,r.plan))&&json(root,r.receipt)?.status==='passed';
  if(f.code==='wiki_capacity_evaluate_split'){
   match=closures.find(c=>c.registry===split&&c.entry.path===f.path&&current(c)&&nonempty(c.entry.reason)&&(c.entry.state==='deferred'?nonempty(c.entry.review_when):completed(c.entry)));
   // Historic review cannot exempt an actual current hard-limit violation.
   if(match&&fs.readFileSync(safe(root,f.path),'utf8').trimEnd().split(/\r?\n/).length>=500)match=null;
  }else if(['wiki_h2_numbering_gap','wiki_h2_numbering_start'].includes(f.code)){
   match=closures.find(c=>c.registry===split&&c.entry.path===f.path&&current(c)&&completed(c.entry)&&c.entry.numbering_assessment?.findings?.some(a=>a.code===f.code&&a.detail===f.detail)&&nonempty(c.entry.numbering_assessment?.reason)&&c.entry.numbering_assessment?.evidence&&fs.existsSync(safe(root,c.entry.numbering_assessment.evidence)));
  }else if(f.code==='wiki_domains_review'){
   match=closures.find(c=>c.registry===semantic&&c.entry.path===f.path&&c.entry.state==='validated'&&c.entry.domain_sections&&current(c)&&nonempty(c.entry.reason)&&nonempty(c.entry.review_when));
   if(match){
    const text=fs.readFileSync(safe(root,f.path),'utf8'),fm=text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]??'';
    const inline=fm.match(/^domains:\s*\[([^\]]*)\]/m),block=fm.match(/^domains:\s*\r?\n((?:[ \t]+-.*\r?\n?)+)/m);
    const domains=(inline?inline[1].split(/[,，]/):block?[...block[1].matchAll(/^[ \t]+-\s*(.+)$/gm)].map(m=>m[1]):[]).map(s=>s.trim().replace(/^["']|["']$/g,''));
    const headings=[...text.matchAll(/^##[ \t]+(.+?)\r?$/gm)].map(m=>m[1]);
    if(!domains.length||domains.some(d=>!match.entry.domain_sections[d]?.length||match.entry.domain_sections[d].some(h=>!headings.includes(h))))match=null;
   }
  }else if(f.code==='source_conflict_review_candidate'){
   match=closures.find(c=>c.registry===semantic&&c.entry.path===f.path&&c.entry.heading===f.detail.replace(/^H[23]:/,'')&&['not_a_conflict','disclosed_evolution'].includes(c.entry.state)&&current(c)&&nonempty(c.entry.reason)&&nonempty(c.entry.review_when));
  }
 }catch{return f;} // Missing, unsafe or malformed evidence never acknowledges a finding.
 if(!match)return f;
 return {...f,severity:'info',original_severity:f.severity,disposition:match.entry.state==='deferred'?'deferred_not_due':match.entry.state==='disclosed_evolution'?'reviewed_conflict_disclosed':'reviewed_retained',registry:match.registry,review_reason:match.entry.reason,review_when:match.entry.review_when??match.entry.review_events?.join(', ')??null,review_by:match.entry.review_by??null,action:'Retain the documented decision; re-review on input/policy change, original review triggers or expiry. This is not source-truth certification.'};
}
export function runHealth({root, scope = 'affected', previous = null, changed = [], now = new Date().toISOString(), events = [], host = process.platform === 'win32' ? 'powershell' : 'pwsh', only = null} = {}) {
  const start = performance.now(); root = fs.realpathSync(root);
  if (!['affected','full'].includes(scope)) throw Error('scope must be affected or full');
  const inputsReader=healthInputs(root);
  const common = inputsReader.manifest(['system/maintenance/checklists','system/protocols','wiki/README.md','raw-sources/README.md','groups/README.md']);
  const ruleHash = sha(JSON.stringify(common));
  const closureRules = closureRuleBindings(root,inputsReader.manifest);
  const checks = [];
  for (const [id, script, args, dependencies] of definitions) {
    if (only && !only.includes(id)) continue;
    const inputs = inputsReader.manifest(dependencies);
    const fingerprint = sha(JSON.stringify({version:VERSION, ruleHash, inputs}));
    const old = previous?.checks?.find(c => c.id === id);
    if (scope === 'affected' && previous?.engine === VERSION && old?.fingerprint === fingerprint && old.execution !== 'tool_failed' && old.complete === true && old.executed_at && Date.parse(now) >= Date.parse(old.executed_at) && Date.parse(now) - Date.parse(old.executed_at) < 86400000 && (!old.details?.summary?.next_threshold_review_at || Date.parse(now) < Date.parse(old.details.summary.next_threshold_review_at))) {
      checks.push({...old, execution:'reused', reused_from: previous.generated_at, elapsed_ms:0}); continue;
    }
    const before = performance.now();
    const scriptPath = safe(root, `system/maintenance/checklists/${script}`);
    const quote = v => "'" + v.replaceAll("'", "''") + "'";
    const command = `$ProgressPreference = 'SilentlyContinue'; [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); & ${quote(scriptPath)} ${args.map(v=>v.startsWith('-')?v:quote(v)).join(' ')}; exit $LASTEXITCODE`;
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'));
    const result = spawnSync(host, ['-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')], {cwd:root,env,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024,windowsHide:true});
    let parsed = null; try { parsed = JSON.parse(result.stdout?.trim().replace(/^\uFEFF/,'')); } catch {}
    const failedTool = Boolean(result.error) || result.status === null || ![0,1,2].includes(result.status) || (result.status === 0 && id !== 'query_contract' && !parsed);
    let findings = [...(parsed?.findings ?? []), ...(parsed?.failures ?? []).map(f=>({...f,severity:'error'})), ...(Array.isArray(parsed?.warnings)?parsed.warnings:[]).map(f=>({...f,severity:'warning'}))].map(f=>({...finding(f.code ?? id, f.path ?? '', f.detail ?? f.details ?? JSON.stringify(f), f.severity ?? 'warning', /candidate|semantic|capacity|split/.test(f.code ?? '') ? 'semantic_review':'mechanical'), ...(f.target_path?{target_path:f.target_path}:{})}));
    if ((failedTool || result.status !== 0 || parsed?.status === 'failed') && !findings.length) findings.push(finding(failedTool?'tool_execution_failed':`${id}_not_current`, `system/maintenance/checklists/${script}`, result.error?.message ?? (result.stderr || result.stdout || `No valid structured result; exit=${result.status}`).trim(), 'error'));
    checks.push({id, fingerprint, input_count:Object.keys(inputs).length, dependencies, execution:failedTool?'tool_failed':'executed', complete:!failedTool, status:failedTool?'tool_failed':result.status!==0||findings.some(f=>f.severity==='error')?'failed':findings.length?'needs_review':'passed', exit_code:result.status, executed_at:now, elapsed_ms:Math.round(performance.now()-before), findings, details: parsed ? {status:parsed.status,summary:parsed.summary} : result.stdout?.trim().slice(0,4000), invalidation: !old?'no_previous_evidence':old.fingerprint!==fingerprint?'inputs_or_rules_changed':'full_or_expired'});
  }
  const observations = [], closures=[];
  const registry = json(root,'system/registry/ingest-auto-review-state.json');
  const runFiles = files(root,'system/maintenance/ingest-runs').filter(p=>p.endsWith('/run.json')&&!p.includes('/revisions/'));
  const runs = runFiles.map(p=>({path:p, run:json(root,p)}));
  const active = runs.filter(({run})=>!['completed','abandoned'].includes(run.status));
  // Standard runs do not occupy the automatic-review registry. Missing legacy
  // policy keeps its historical deferred interpretation for registry auditing.
  const automatic = active.filter(({run})=>run.review_policy !== 'interactive');
  const standard = active.filter(({run})=>run.review_policy === 'interactive');
  if ((!registry && automatic.length) || (registry && ((registry.status==='inactive' && automatic.length) || (registry.status!=='inactive' && (!automatic.some(({run})=>run.batch_id===registry.batch_id) || automatic.some(({run})=>run.batch_id!==registry.batch_id)))))) observations.push(finding('run_registry_drift','system/registry/ingest-auto-review-state.json',`registry=${registry?.status ?? 'missing'}; automatic active runs=${automatic.map(r=>r.path).join(',')}`,'error'));
  for (const item of standard) observations.push({...finding('standard_run_active',item.path,`Standard run ${item.run.batch_id}: ${item.run.status}; automatic registry is not used.`,'info'), action:'Read this run manifest for the current stage and required approval; do not activate the automatic registry.'});
  if (registry?.last_completed_batch && !runs.some(r=>path.basename(path.dirname(r.path))===registry.last_completed_batch && r.run.status==='completed')) observations.push(finding('last_completed_run_missing','system/registry/ingest-auto-review-state.json',registry.last_completed_batch,'error'));
  for(const p of ['NOW.md','system/registry/KNOWLEDGE_STATUS.md']) {
    if(!fs.existsSync(safe(root,p))) { observations.push(finding('status_summary_missing',p,'Derived summary is unavailable.')); continue; }
    const text=fs.readFileSync(safe(root,p),'utf8');
    if(registry?.status==='inactive' && !standard.length && /(?:当前|状态|本轮|最近|等待)[^\n]*(?:待.*审核|等待.*审核|awaiting_review)/i.test(currentStatusText(text))) observations.push(finding('status_summary_review_candidate',p,'Registry is inactive but current summary contains awaiting-review language; explicitly delimited history is excluded.','warning'));
  }
  for(const registryPath of ['system/maintenance/wiki-semantic-review-closures.json','system/maintenance/wiki-split-closures.json','system/maintenance/health-issues.json']) {
    const doc=json(root,registryPath); if(!doc) continue;
    const entries=[...(doc.records??[]),...(doc.domain_reviews??[]),...(doc.conflict_reviews??[]),...(doc.issues??[]),...(doc.source_marker_policy?[{...doc.source_marker_policy,path:'wiki',id:'source_marker_policy'}]:[])];
    for(const entry of entries) {
      const expectedScope=registryPath.endsWith('/wiki-split-closures.json')?'wiki-split/v1':registryPath.endsWith('/wiki-semantic-review-closures.json')?'wiki-semantic/v1':'health-review/v1';
      const reasons=closureReviewReasons(entry,{root,closureRules,expectedScope,ruleHash,now,events,changed,fingerprint:inputsReader.fingerprint});
      closures.push({entry,registry:registryPath,reasons});
      const state=reasons.length?'review_required':entry.state==='resolved'||entry.state==='completed'?'resolved':'deferred_not_due';
      observations.push({...finding(reasons.length?'closure_recheck_required':'closure_current',entry.path??registryPath, reasons.join('; ') || entry.reason || 'Version-bound closure is current.',reasons.length?'warning':'info','semantic_review'), disposition:state, registry:registryPath, review_when:entry.review_when??null});
    }
  }
  const findings=[...checks.flatMap(c=>{
   const effective=c.findings.map(f=>applyReviewDisposition(f,{root,closures}));
   c.effective_status=c.status==='failed'||c.status==='tool_failed'?c.status:effective.some(f=>f.severity==='error')?'failed':effective.some(f=>f.severity==='warning')?'needs_review':'passed';
   return effective;
  }),...observations];
  return {schema_version:1,engine:VERSION,generated_at:now,root,requested_scope:scope,scope_reason:scope==='full'?'Explicit full check; no reuse.':'Whole cross-page dependency modules rerun when any bound input changes; unchanged modules reused for at most 24h. No changed-file-only filtering.',changed_paths:changed,rule_hash:ruleHash,closure_rule_bindings:closureRules,checks,findings,unchecked:['semantic truth, source fidelity and user acceptance require Agent/human review','historical artifact JSON beyond run manifests; use graph -IncludeHistoricalJson for explicit archival audit',...(only?['diagnostic module subset selected; not a complete health check']:[])],status:only?'partial':checks.some(c=>c.execution==='tool_failed')?'incomplete':findings.some(f=>f.severity==='error')?'issues_found':findings.some(f=>f.severity==='warning')?'needs_review':'mechanically_healthy',elapsed_ms:Math.round(performance.now()-start),writes_performed:false,summary:{executed:checks.filter(c=>c.execution==='executed').length,reused:checks.filter(c=>c.execution==='reused').length,tool_failed:checks.filter(c=>c.execution==='tool_failed').length,findings:findings.length}};
}
export function markdown(report) {
 const cell = value => String(value ?? '').replaceAll('|','\\|').replaceAll('\n','<br>');
 const html = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const grouped = new Map();
 for (const f of report.findings) {
   const key=JSON.stringify([f.code,f.owner,f.authorization]);
   if(!grouped.has(key)) grouped.set(key,{code:f.code,owner:f.owner,authorization:f.authorization,items:[],actions:new Set()});
   const group=grouped.get(key);group.items.push(f);group.actions.add(f.action);
 }
 const summary=[...grouped.values()].map(g=>`| ${cell(g.code)} | ${g.items.length} | ${cell([...new Set(g.items.map(f=>f.disposition??f.severity))].join(', '))} | ${cell(g.owner)} | ${cell(g.authorization)} | ${cell([...g.actions].join(' '))} |`).join('\n');
 const details=[...grouped.values()].map(g=>`<details>\n<summary>${html(g.code)} — ${g.items.length} 项；${html(g.owner)}</summary>\n\n<pre>${html(JSON.stringify(g.items,null,2))}</pre>\n\n</details>`).join('\n\n');
 return `# Knowledge 健康检查\n\n状态：${report.status}；范围：${report.requested_scope}；版本：${report.engine}；耗时：${report.elapsed_ms} ms。\n\n${report.scope_reason}\n\n| 检查 | 执行 | 有效处置结果 | 毫秒 |\n|---|---|---|---|\n${report.checks.map(c=>`| ${c.id} | ${c.execution} | ${c.effective_status??c.status} | ${c.elapsed_ms} |`).join('\n')}\n\n## 问题与处置\n\n共 ${report.findings.length} 项，按问题类型、owner 和授权范围汇总为 ${grouped.size} 组；数量不代表严重程度，复核候选不等于已确认错误。\n\n${summary ? '| 类型 | 数量 | 状态 | Owner | 写入授权 | 动作 |\n|---|---:|---|---|---|---|---|\n'+summary : '本次机械检查未发现问题。'}\n\n## 完整明细\n\n各模块原始发现保留在JSON的checks.findings；统一findings追加当前审结处置及原始严重程度，不删除发现。下方完整展示处置后的全部字段。\n\n${details}\n\n## 未检查\n\n${report.unchecked.map(s=>`- ${s}`).join('\n')}\n\n检查不修改知识、状态或历史证据；修复后重新检查，不把机械健康当作语义正确。\n`;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  const args=process.argv.slice(2); const value=k=>{const i=args.indexOf(k); return i<0?null:args[i+1];};
  const root=value('--root')??path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
  const previous=value('--previous')?json(fs.realpathSync(root),value('--previous')):null;
  const report=runHealth({root,scope:value('--scope')??'affected',previous,changed:args.flatMap((v,i)=>v==='--changed'?[args[i+1]]:[]),events:args.flatMap((v,i)=>v==='--event'?[args[i+1]]:[])});
  console.log(value('--format')==='markdown'?markdown(report):JSON.stringify(report,null,2));
  process.exitCode=report.status==='incomplete'?3:report.status==='issues_found'?2:0;
 } catch(e) {console.error(`KNOWLEDGE_HEALTH_FAILED: ${e.message}`);process.exitCode=3;}
}
