import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {safe, sha} from './raw-quality.mjs';
import {splitRaw, metadataPreflight} from './ingest-review-support.mjs';
import {parentReview} from './reviewer-route.mjs';

// Controller-owned header, writer-owned body. No inferred metadata or overwrites.
export function prepareWriter(root, runPath) {
  const runFile=safe(root,runPath), run=JSON.parse(fs.readFileSync(runFile,'utf8').replace(/^\uFEFF/,''));
  if(['completed','awaiting_final_review'].includes(run.status)) throw Error('Cannot prepare writer for sealed/completed run');
  const sources=(run.items??[]).filter(x=>typeof x==='string'&&x.startsWith('Clippings/'));
  if(!sources.length || new Set(sources).size!==sources.length) throw Error('Unique Clippings inputs required');
  const rows=sources.map((source,i)=>{
    const stem=path.join(path.dirname(runFile),'raw-bodies',String(i+1).padStart(2,'0'));
    const body=safe(root,fs.existsSync(stem+'.md')?stem+'.md':stem+'.json',false);
    return {source:safe(root,source),body,format:body.endsWith('.json')?'sections_v1':'legacy_markdown'};
  });
  for(const row of rows) {
    fs.mkdirSync(path.dirname(row.body),{recursive:true});
    try { fs.writeFileSync(row.body,JSON.stringify({schema_version:1,title:'',sections:[]},null,2)+'\n',{flag:'wx'}); } catch(e) { if(e.code!=='EEXIST')throw e; safe(root,row.body); }
  }
  return {status:'prepared',root:fs.realpathSync(root),outputs:rows,
    turn_preflight:{executable:'node',argv:[path.join(fs.realpathSync(root),'system/maintenance/checklists/ingest-runtime-contract.mjs'),'agent-preflight','--run',runFile,'--agent','<actual-bound-agent-id>','--turn-started-at','<dispatch-UTC-timestamp>'],instruction:'Run first on every initial, continued or resumed turn. Wait for binding if necessary; do not read source prose or write before PASS. A previous-turn PASS cannot authorize this turn. On mismatch return the observed configuration and stop; never alter registration to match drift.'},
    source_fidelity:'Preserve the author\'s claims, attribution, uncertainty and reasoning. Do not insert your own legal, ethical or operational prescriptions into Raw. Example: retain an author\'s request for professional advice; do not add a new dismissal procedure. Retain the author\'s assessment of an operating practice; do not redefine the article as exclusively an ethical risk diagnosis. External evaluation belongs in the host\'s separately attributed Wiki synthesis.',
    delivery:parentReview(run)?'Only write the article assigned in the current pipeline task, report its exact body path and finish this turn. The parent dispatches the next article to this same session before reviewing your delivered article. Keep delivered bodies unchanged unless assigned a repair. After the batch Stage1 checkpoint and Stage2 plan, this same writer handles Wiki page groups. The parent performs full-source non-author review; it is not a fresh independent context.':'Complete and notify one article at a time with its exact body path; then continue the next article without waiting. Do not edit delivered bodies while review is active. The host assembles only delivered rows and one independent reviewer processes ready articles in order. Aggregate findings per article; repair only after review releases that article. All articles still require full-source review.',
    instruction:'Read complete sources and writing rules. Edit only these absolute paths; preserve drafts on resume. For sections_v1 supply title and sections [{heading,source_locator,body}]. Write full prose, not summaries. The assembler renders H1/H2 and source markers; do not put H1/H2 in body. Return paths.'};
}

export function renderSections(draft) {
  const line=x=>typeof x==='string'&&x.trim().length>0&&!/[\r\n]/.test(x);
  if(draft.schema_version!==1||!line(draft.title)||!Array.isArray(draft.sections)||!draft.sections.length)throw Error('Structured Raw needs title and sections_v1');
  const seen=new Set();
  const sections=draft.sections.map(s=>{
    if(!line(s.heading)||/^#/.test(s.heading)||seen.has(s.heading)||!line(s.source_locator)||typeof s.body!=='string'||!s.body.trim())throw Error('Section needs unique heading, source_locator and full body');
    seen.add(s.heading);
    let fence=null;
    for(const l of s.body.split(/\r?\n/)) {
      const m=l.match(/^\s*(`{3,}|~{3,})/);
      if(m){if(!fence)fence=m[1];else if(m[1][0]===fence[0]&&m[1].length>=fence.length)fence=null;continue;}
      if(!fence && (/^#{1,2}\s/.test(l)||/^>\s*📍\s*原文/.test(l)))throw Error('Section body must not duplicate assembler headings or source markers');
    }
    if(fence)throw Error('Unclosed fenced block in section');
    return `## ${s.heading}\n\n> 📍 原文：${s.source_locator}\n\n${s.body}${s.body.endsWith('\n')?'':'\n'}`;
  });
  return `\n# ${draft.title}\n\n${sections.join('\n')}`;
}

export function assembleRaw(root, {header, body, source, output, reuse = false, repairExpectedSha256 = null}) {
  const read=p=>fs.readFileSync(safe(root,p),'utf8');
  const sourceText=read(source), original=splitRaw(sourceText);
  let frozen=read(header);
  // Older run-local headers may predate the canonical source/date mapping.
  // These fields come only from the clipping itself, never from the writer.
  const headerFields=splitRaw(frozen).fields;
  const additions=[];
  if(!headerFields.source_url){
    if(!original.fields.source)throw Error('Source URL is absent from clipping: '+source);
    additions.push(original.fields.source.replace(/^source:/,'source_url:'));
  }
  if(!headerFields.date){
    const published=sourceText.match(/\*(\d{4})年(\d{1,2})月(\d{1,2})日\s+\d{1,2}:\d{2}\*/);
    if(!published)throw Error('Published date requires a source-backed decision: '+source);
    additions.push(`date: ${published[1]}-${published[2].padStart(2,'0')}-${published[3].padStart(2,'0')}`);
  }
  if(additions.length)frozen=frozen.replace(/\r?\n---\r?\n$/,`\n${additions.join('\n')}\n---\n`);
  const draft=read(body), prose=body.endsWith('.json')?renderSections(JSON.parse(draft)):draft;
  const parsed=splitRaw(frozen);
  if(parsed.body.trim()) throw Error('Header template must contain metadata only');
  if(!prose.trim() || /^---\r?\n/.test(prose.replace(/^\uFEFF/,''))) throw Error('Writer must supply nonempty body without frontmatter');
  for(const [key,value] of Object.entries(original.fields)) {
    if(parsed.fields[key]?.trimEnd()!==value.trimEnd()) throw Error('Source metadata changed: '+key);
  }
  const combined=frozen.replace(/^\uFEFF/,'')+prose;
  if(splitRaw(combined).body!==parsed.body+prose) throw Error('Header requires a final newline');
  metadataPreflight(root,combined);
  const destination=safe(root,output,false);
  if(repairExpectedSha256){
    if(!fs.existsSync(destination))throw Error('Repair target is missing');
    const before=fs.readFileSync(destination);
    if(before.toString('utf8')===combined)return {status:'reused',output,sha256:sha(combined)};
    if(sha(before)!==repairExpectedSha256)throw Error('Repair target changed since assignment: '+output);
    const temporary=destination+'.pending';safe(root,temporary,false);
    fs.writeFileSync(temporary,combined);fs.renameSync(temporary,destination);
    return {status:'repaired',output,previous_sha256:repairExpectedSha256,sha256:sha(combined)};
  }
  if(reuse && fs.existsSync(destination)) {
    if(fs.readFileSync(destination,'utf8')!==combined) throw Error('Existing Raw differs; use explicit repair workflow: '+output);
    return {status:'reused',output,sha256:sha(combined)};
  }
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,combined,{flag:'wx'});
  return {status:'assembled',output,source_sha256:sha(read(source)),header_sha256:sha(frozen),body_sha256:sha(draft),rendered_body_sha256:sha(prose),sha256:sha(combined)};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { const a={};for(let i=2;i<process.argv.length;i+=2)a[process.argv[i].slice(2)]=process.argv[i+1];console.log(JSON.stringify(a.action==='prepare-writer'?prepareWriter(a.root,a.run):assembleRaw(a.root,a),null,2)); }
  catch(e){console.error(e.message);process.exitCode=2;}
}
