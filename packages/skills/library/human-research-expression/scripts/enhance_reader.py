"""Stage exact, reader-only edits to an already reviewed deep-game report.

Uses the host navigation and workflow checks. Does not compile study prose,
accept semantic/page gates, alter the manifest, or maintain Knowledge relations.
"""
from pathlib import Path
import argparse, hashlib, importlib.util, json, re, shutil, subprocess, sys, time
sys.dont_write_bytecode = True
OWNED = ('reader/index.html', 'reader/navigation.json')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p, v): p.parent.mkdir(parents=True, exist_ok=True); p.write_text(json.dumps(v, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
def files(root):
    paths = sorted(p for p in root.rglob('*') if p.is_file() and '.git' not in p.relative_to(root).parts)
    if any(p.is_symlink() for p in root.rglob('*')): raise ValueError('Symlinks require a separate owner review')
    return {p.relative_to(root).as_posix():sha(p) for p in paths}
def section(source, sid):
    anchor='<section data-scene="'+sid+'" id="'+sid+'"'
    if source.count(anchor)!=1: raise ValueError('Missing/ambiguous section '+sid)
    start=source.index(anchor); end=source.index('</section>',start)+len('</section>')
    return start,end,source[start:end]
def load_module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
def runtime(report):
    workspace=next(p for p in report.parents if (p/'Research/game-research/deep-game-analysis/workflow.py').is_file())
    deep=workspace/'Research/game-research/deep-game-analysis';sys.path.insert(0,str(deep))
    return workspace,load_module('expression_navigation',deep/'reader-navigation/build.py'),load_module('expression_workflow',deep/'workflow.py')
def local(run,name):
    p=(run/name).resolve()
    if not p.is_relative_to(run): raise ValueError('Expression input outside run: '+name)
    return p
def input_identity(run,workspace):
    plan=read(run/'plan.json');paths=[Path(__file__).resolve(),run/'plan.json']
    paths += [local(run,e['fragment']) for e in plan.get('edits',[])]
    paths += [local(run,p) for p in plan.get('css',[])+plan.get('scripts',[])]
    if plan.get('media_observer'):
        asset=workspace/'Research/.agents/skills/human-research-expression/assets/media-observer'
        paths += [asset/'player.js',asset/'player.css']
    return {str(p):sha(p) for p in paths}
def checked_baseline(report,run):
    baseline=read(run/'baseline.json')
    if baseline['report']!=str(report) or files(report)!=baseline['files']: raise ValueError('Report changed since capture; inspect owner before rebase')
    return baseline
def build(report,run,stage):
    workspace,nav,workflow=runtime(report); baseline=checked_baseline(report,run);plan=read(run/'plan.json')
    if plan.get('change_kind') != 'presentation_only' or plan.get('edits'):
        raise ValueError('Explanations must be authored in study.json and compiled to README/units first; reader-only accepts presentation_only controls/styles, without semantic fragments')
    if stage.exists() or stage.is_relative_to(report) or report.is_relative_to(stage) or stage.is_relative_to(run): raise ValueError('Use a fresh staging directory outside report/run')
    config=read(report/'reader/navigation.json')
    if config['report_id']!=plan['report_id']: raise ValueError('Wrong report identity')
    source=nav.strip_navigation((report/'reader/index.html').read_text(encoding='utf-8'));original=source;changed=set();media_count=0
    for edit in plan.get('edits',[]):
        sid=edit['section'];a,b,old=section(source,sid);fragment=local(run,edit['fragment']).read_text(encoding='utf-8')
        if edit['kind']=='replace_flow':
            new,count=re.subn(r'<div\b(?=[^>]*\bclass="flow")[^>]*>.*?</div>',lambda _:fragment,old,count=1,flags=re.S)
            if count!=1: raise ValueError('Expected one replaceable flow in '+sid)
        elif edit['kind']=='append': new=old[:-len('</section>')]+fragment+'</section>'
        else: raise ValueError('Unknown expression operation')
        source=source[:a]+new+source[b:];changed.add(sid)
    if plan.get('media_observer'):
        asset=workspace/'Research/.agents/skills/human-research-expression/assets/media-observer'
        code="process.stdout.write(require(process.argv[1]).markup('__RX_VIDEO__'));"
        template=subprocess.run(['node','-e',code,str(asset/'player.js')],check=True,capture_output=True,text=True,encoding='utf-8').stdout
        if template.count('__RX_VIDEO__')!=1: raise ValueError('Invalid media template')
        study=read(report/'study.json')
        for s in study['sections']:
            a,b,old=section(source,s['id'])
            count=len(re.findall(r'<video\b',old))
            if not count: continue
            new=re.sub(r'<video\b[^>]*>.*?</video>',lambda m:template.replace('__RX_VIDEO__',m.group()),old,flags=re.S)
            source=source[:a]+new+source[b:];changed.add(s['id']);media_count+=count
        if media_count!=plan['expected_videos']: raise ValueError('Unexpected video coverage')
    css='\n'.join(local(run,n).read_text(encoding='utf-8') for n in plan.get('css',[]))
    scripts='\n'.join(local(run,n).read_text(encoding='utf-8') for n in plan.get('scripts',[]))
    if plan.get('media_observer'):
        css+='\n'+(asset/'player.css').read_text(encoding='utf-8')
        scripts+='\n'+(asset/'player.js').read_text(encoding='utf-8')+"\ndocument.querySelectorAll('[data-media-observer]').forEach(root=>ResearchMediaObserver.mount(root));\n"
    if source.count('</style>')!=1 or source.count('</html>')!=1: raise ValueError('Missing/ambiguous style/document insertion point')
    source=source.replace('</style>',css+'</style>')
    if scripts:
        source=source.replace('</html>','<script id="rx-expression-js">'+scripts+'</script></html>')
        if source.count('id="rx-expression-js"')!=1: raise ValueError('Expression script missing or duplicated')
    study=read(report/'study.json');unchanged=[s['id'] for s in study['sections'] if s['id'] not in changed]
    for sid in unchanged:
        if section(original,sid)[2]!=section(source,sid)[2]: raise ValueError('Unselected section changed: '+sid)
    # Original resources and existing scripts must survive exact; only wrappers/new scripts are allowed.
    for pattern in [r'<img\b[^>]*>',r'<video\b[^>]*>.*?</video>',r'<script\b[^>]*>.*?</script>']:
        for raw in re.findall(pattern,original,flags=re.S):
            if raw not in source: raise ValueError('Existing media/script changed')
    stage.parent.mkdir(parents=True,exist_ok=True);shutil.copytree(report,stage)
    (stage/'reader/index.html').write_bytes(source.encode('utf-8'));config['base_html_sha256']=hashlib.sha256(source.encode()).hexdigest();write(stage/'reader/navigation.json',config)
    navigation=nav.build(stage);check=workflow.structural_check(stage);after=files(stage)
    if set(after)!=set(baseline['files']): raise ValueError('Unexpected generated files')
    for p,h in baseline['files'].items():
        if p not in OWNED and after[p]!=h: raise ValueError('Protected report file changed: '+p)
    receipt={'kind':'reader_only_expression_build','report':str(report),'stage':str(stage),'inputs':input_identity(run,workspace),'previous_reader':{p:baseline['files'][p] for p in OWNED},'files':{p:after[p] for p in OWNED},'protected_files':len(after)-len(OWNED),'changed_sections':sorted(changed),'unchanged_sections':unchanged,'videos_wrapped':media_count,'navigation':navigation,'structural_check':check,'published':False,'page':'not_yet_reviewed'}
    write(run/'build-receipt.json',receipt);return {'status':'pass','stage':str(stage),'changed_sections':sorted(changed),'protected_files':receipt['protected_files'],'videos_wrapped':media_count,'files':receipt['files']}
def publish(report,run):
    workspace,_,workflow=runtime(report);r=read(run/'build-receipt.json');checked_baseline(report,run)
    if r['published'] or r['inputs']!=input_identity(run,workspace): raise ValueError('Already published or changed build inputs')
    stage=Path(r['stage']);backup=stage.parent/(stage.name+'-publish-backup')
    if backup.exists(): raise ValueError('Existing recovery backup; inspect first')
    pending={p:(report/p).with_name(Path(p).name+'.pipeline-new') for p in OWNED}
    if any(p.exists() for p in pending.values()): raise ValueError('Existing pending output; inspect owner first')
    for p in OWNED:
        if sha(stage/p)!=r['files'][p]: raise ValueError('Candidate drift: '+p)
    for p in OWNED:
        out=backup/p;out.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(report/p,out)
    try:
        for p in OWNED:
            shutil.copyfile(stage/p,pending[p]);pending[p].replace(report/p)
        workflow.structural_check(report)
        baseline=read(run/'baseline.json')['files']
        if any(sha(report/p)!=h for p,h in baseline.items() if p not in OWNED): raise ValueError('Protected file drift during publication')
    except BaseException:
        for p in OWNED: shutil.copyfile(backup/p,report/p)
        raise
    finally:
        for p in pending.values(): p.unlink(missing_ok=True)
    r['published']=True;r['backup']=str(backup);write(run/'build-receipt.json',r);return {'published':True,'files':r['files'],'page':r['page']}
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['capture','build','publish']);p.add_argument('--report',type=Path,required=True);p.add_argument('--run',type=Path,required=True);p.add_argument('--stage',type=Path);a=p.parse_args();report=a.report.resolve();run=a.run.resolve()
    if a.action=='build' and a.stage is None:p.error('build requires --stage')
    run.mkdir(parents=True,exist_ok=True);_,_,workflow=runtime(report)
    with workflow.writer_lock(run),workflow.writer_lock(report.parent,'.'+report.name+'.workflow.lock'):
        start=time.monotonic();started=workflow.now();status='fail'
        try:
            if a.action=='capture':
                if (run/'baseline.json').exists(): raise ValueError('Baseline exists; do not overwrite historical input')
                out={'report':str(report),'files':files(report)};write(run/'baseline.json',out);out={'captured':len(out['files'])}
            else:out=build(report,run,a.stage.resolve()) if a.action=='build' else publish(report,run)
            status='pass';print(json.dumps(out))
        finally:
            event={'started_at':started,'finished_at':workflow.now(),'action':a.action,'seconds':time.monotonic()-start,'status':status,'tokens':'unknown'}
            with (run/'execution-events.jsonl').open('a',encoding='utf-8',newline='\n') as f:f.write(json.dumps(event)+'\n')
if __name__=='__main__': main()
