import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkRegistry} from './ingest-score-check.mjs';

// Read-only, cheap registry checks before any package or host-cost work.
export function preflight(root, runPath, staged = false) {
  root = fs.realpathSync(root);
  const local = value => {
    const full = fs.realpathSync(path.resolve(root, value));
    if (!full.startsWith(root + path.sep)) throw Error('Path escapes Knowledge: ' + value);
    return full;
  };
  const run = JSON.parse(fs.readFileSync(local(runPath), 'utf8').replace(/^\uFEFF/, ''));
  const checks = [], add = (id, problems) => checks.push({id, passed: !problems.length, problems});
  if(run.execution_control?.mechanical_contract_version===1) {
    try {checkRegistry(root,run);add('intrinsic_score_registration',[]);}
    catch(e){add('intrinsic_score_registration',[e.message]);}
  }
  const read = name => fs.readFileSync(local(name), 'utf8');
  const physical = fs.readdirSync(local('raw-sources'), {withFileTypes:true}).filter(x => x.isFile() && x.name.endsWith('.md') && x.name !== 'README.md' && !x.name.endsWith('.template.md')).map(x => x.name);
  const text = read('system/registry/raw-list.md');
  const categories = [...text.matchAll(/^###\s+[^\r\n]+\r?\n([\s\S]*?)(?=^###\s+|(?![\s\S]))/gm)].filter(x => /（共\s*\d+\s*篇）/.test(x[1]));
  const rows = body => [...body.matchAll(/^\|\s*([^|\r\n]+\.md)\s*\|/gm)].map(x => x[1].trim());
  const names = categories.flatMap(x => rows(x[1]));
  const counts = [];
  if (categories.length !== 2) counts.push('Expected two counted categories');
  for (const c of categories) if (+c[1].match(/（共\s*(\d+)\s*篇）/)[1] !== rows(c[1]).length) counts.push('Category declared count differs from rows');
  if (names.length !== physical.length) counts.push(`listed=${names.length} physical=${physical.length}`);
  for (const name of new Set([...names, ...physical])) if (names.filter(x => x === name).length !== 1 || !physical.includes(name)) counts.push('Missing, duplicate or nonphysical Raw: ' + name);
  add('raw_list_counts_match', counts);
  const raws = (run.artifacts ?? []).filter(x => x.kind === 'raw' && x.disposition === 'ingested');
  add('batch_raw_registry_exact', raws.filter(x => names.filter(n => n === path.basename(x.path)).length !== 1).map(x => x.path));
  add('status_raw_counts_current', ['NOW.md','system/registry/KNOWLEDGE_STATUS.md'].filter(x => !new RegExp('^\\s*-\\s*raw：' + physical.length + '(?:\\s|$)', 'm').test(read(x))));
  const git = (...args) => execFileSync('git', ['-C',root,...args], {encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const baseline = run.commits?.stage1;
  if (!baseline) throw Error('Stage1 checkpoint is required');
  const changed = git('diff', ...(staged ? ['--cached'] : []), '--name-only','-z',baseline,'--').split('\0');
  const required = ['NOW.md','system/maintenance/CHANGELOG.md','system/registry/KNOWLEDGE_STATUS.md'];
  if (raws.length) required.push('system/registry/raw-list.md','system/registry/index.md');
  add('maintenance_sync_paths', required.filter(x => !changed.includes(x)));
  if (staged) add('registry_index_matches_worktree', required.filter(x => {
    try { return git('show',':'+x).replaceAll('\r\n','\n') !== read(x).replaceAll('\r\n','\n'); }
    catch { return true; }
  }));
  return {status:checks.every(x => x.passed) ? 'passed' : 'failed', raw_count:physical.length,
    failed_checks:checks.filter(x => !x.passed), required_paths:required,
    next_action:'Fill missing registration fields from reviewed content; review diff, stage exact paths, then Seal. No semantic values are inferred.'};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args={}; for(let i=2;i<process.argv.length;i+=2) args[process.argv[i].slice(2)]=process.argv[i+1];
    const result=preflight(args.root,args.run,args.staged==='true'); console.log(JSON.stringify(result,null,2));
    if(result.status!=='passed') process.exitCode=2;
  } catch(e) { console.error(e.message); process.exitCode=2; }
}
