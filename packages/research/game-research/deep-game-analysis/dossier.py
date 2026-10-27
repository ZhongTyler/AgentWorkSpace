"""Research-owned dossier contract checks, scoped returns and portable handoff.

No crawler, game interpreter, model, semantic reviewer or Knowledge writer.
Paths are relative to the manifest, with an explicit allowed_root boundary.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
from urllib.parse import unquote, urlsplit

LINK = re.compile(r'!?\[[^\]]*\]\((<[^>]+>|[^)]+)\)')

def evidence_graph(manifest, errors):
    """Use the same dependency traversal for domains, claims, cases and assets."""
    nodes={}
    for key,kind in [('sources','source'),('assets','asset'),('cases','case'),('claims','claim')]:
        for row in manifest[key]:
            if row['id'] in nodes:errors.append('duplicate evidence ID: '+row['id'])
            nodes[row['id']]=(kind,row)
    def children(kind,row):
        refs=list(row.get('evidence',[]))
        if kind=='asset':refs.append(row.get('source_id'))
        if kind=='case':
            refs+=row.get('frames',[])+row.get('segments',[])
            if row.get('continuous_segment_asset'):refs.append(row['continuous_segment_asset'])
        return refs
    completed=set()
    def visit(ref,stack):
        if ref not in nodes:errors.append('unknown evidence reference: '+str(ref));return
        if ref in stack:errors.append('evidence dependency cycle: '+' -> '.join([*stack,ref]));return
        if ref in completed:return
        kind,row=nodes[ref]
        if kind=='asset' and row.get('accepted') is not True:errors.append('rejected asset used as support: '+ref)
        if kind=='source':
            reading=row.get('read_status','unread')
            scope=row.get('read_scope')
            if reading not in ('read','partial_read','cached_read') or not isinstance(scope,str) or not scope.strip() or (row.get('role')=='unavailable' and row.get('availability')!='online_unavailable'):
                errors.append('unread/unavailable source used as support: '+ref)
            # Availability is not reading: an already-read preserved source can work offline.
            if row.get('availability')=='online_unavailable':
                archive=[nodes.get(x) for x in row.get('archive_refs',[])]
                if not archive or not all(x and x[0]=='asset' and x[1].get('accepted') and x[1].get('source_id')==ref for x in archive):
                    errors.append('offline source lacks preserved archive: '+ref)
        for child in children(kind,row):visit(child,[*stack,ref])
        completed.add(ref)
    for domain in manifest['domains']:
        for ref in domain.get('evidence',[]):visit(ref,['domain:'+domain['name']])
    for key in ('claims','cases'):
        for row in manifest[key]:visit(row['id'],[])
    return nodes,children

def check_domain_baseline(manifest,base,allowed,errors):
    baseline=manifest['domain_baseline']
    snapshot=baseline.get('snapshot_ref')
    if not snapshot:
        errors.append('fixed domain baseline snapshot missing');return
    try:
        path=bounded(base,snapshot,allowed)
        if sha(path)!=baseline.get('snapshot_sha256'):errors.append('domain baseline snapshot hash mismatch');return
        fixed=load(path)
        if fixed.get('names')!=baseline['names'] or fixed.get('source_sha256')!=baseline['sha256']:
            errors.append('domain baseline differs from frozen snapshot')
    except (OSError,ValueError,KeyError) as e:errors.append('domain baseline snapshot invalid: '+str(e))

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))

def bounded(base, relative, allowed):
    if Path(relative).is_absolute():
        raise ValueError('Absolute paths are not portable contract paths')
    result=(base/relative).resolve()
    if not result.is_relative_to(allowed.resolve()):
        raise ValueError('Path escapes declared research scope: '+relative)
    return result

def checks(manifest, base):
    errors=[]
    allowed=(base/manifest['allowed_root']).resolve()
    sources={x['id']:x for x in manifest['sources']}
    assets={x['id']:x for x in manifest['assets']}
    cases={x['id']:x for x in manifest['cases']}
    claims={x['id']:x for x in manifest['claims']}
    for rows,label in [(manifest['sources'],'source'),(manifest['assets'],'asset'),(manifest['cases'],'case'),(manifest['claims'],'claim')]:
        if len({x['id'] for x in rows})!=len(rows):errors.append('duplicate '+label+' ID')
    baseline=manifest['domain_baseline']['names']
    check_domain_baseline(manifest,base,allowed,errors)
    covered=[x['name'] for x in manifest['domains']]
    if len(set(baseline))!=len(baseline) or set(covered)!=set(baseline) or len(covered)!=len(baseline):
        errors.append('domain baseline mismatch')
    for d in manifest['domains']:
        if d['applicability']=='present' and (not d.get('chapter') or not d.get('evidence') or not d.get('scope')):
            errors.append('substantive domain references missing: '+d['name'])
        if d['applicability']=='not_applicable' and not d.get('reason'):
            errors.append('N/A requires evidence/reason: '+d['name'])
        if d['applicability'] not in ('present','not_applicable','unknown'):
            errors.append('unknown applicability label')
    for a in manifest['assets']:
        try:
            path=bounded(base,a['path'],allowed)
            if not path.is_file(): errors.append('missing asset: '+a['id'])
            elif sha(path)!=a['sha256']:errors.append('asset hash mismatch: '+a['id'])
        except ValueError as e:errors.append(str(e))
        if a.get('accepted') and a.get('role')=='video_frame' and not a.get('decoded_frame_verified'):
            errors.append('unverified/thumbnail frame cannot be accepted: '+a['id'])
        if a.get('source_id') not in sources:errors.append('asset unknown source: '+a['id'])
    for c in manifest['claims']:
        if not c.get('version_groups') or not c.get('conditions') or not c.get('limits'):
            errors.append('claim conditions/version/limits absent: '+c['id'])
        if not c.get('evidence'):
            errors.append('unknown/absent claim evidence: '+c['id'])
    evidence_graph(manifest,errors)
    if manifest.get('dossier_ref'):
        docroot=bounded(base,manifest['dossier_ref'],allowed).parent
        for row in [*manifest['domains'],*manifest['claims'],*manifest['cases']]:
            rel=row.get('chapter') or row.get('path')
            if rel and not bounded(docroot,rel,allowed).is_file():errors.append('missing chapter/case: '+rel)
    for c in manifest['cases']:
        if any(x not in assets or not assets[x].get('accepted') for x in c.get('frames',[])):
            errors.append('case uses missing/rejected media: '+c['id'])
        requirements=c.get('evidence_requirements',{})
        kind=requirements.get('kind')
        provided=set(c.get('evidence',[])+c.get('frames',[])+c.get('segments',[]))
        if c.get('continuous_segment_asset'):provided.add(c['continuous_segment_asset'])
        if not requirements:errors.append('case evidence requirements missing: '+c['id'])
        if any(x not in provided for x in requirements.get('required_refs',[])):
            errors.append('case required evidence missing: '+c['id'])
        minimum=requirements.get('min_frames',0)
        if kind in ('visual_sequence','visual_fragment','static_visual'):
            minimum=max(1,minimum)
        if len(c.get('frames',[]))<minimum:errors.append('case required frames missing: '+c['id'])
        if kind=='documentary' and not c.get('evidence'):errors.append('documentary case lacks source: '+c['id'])
        if kind=='visual_sequence' and c.get('status')=='answered':
            states=c.get('state_evidence',{})
            for state in ('before','action','feedback','after'):
                refs=states.get(state,[])
                if not refs or any(x not in provided or x not in assets or assets[x].get('role') not in ('video_frame','video_segment','official_image') for x in refs):
                    errors.append('visual case lacks observed '+state+': '+c['id'])
        if c.get('continuity')=='continuous':
            segment=assets.get(c.get('continuous_segment_asset'),{})
            if segment.get('role')!='video_segment' or not segment.get('segment_coverage_verified'):
                errors.append('continuous case lacks continuous media: '+c['id'])
    link_count=0
    for rel in manifest['documents']:
        try:
            path=bounded(base,rel,allowed)
            if not path.is_file():errors.append('missing document: '+rel);continue
            expected=manifest.get('document_hashes',{}).get(rel)
            if not expected or sha(path)!=expected:errors.append('document hash mismatch: '+rel)
            for match in LINK.finditer(path.read_text(encoding='utf-8-sig')):
                target=match.group(1).strip('<>')
                if urlsplit(target).scheme or target.startswith('#'):continue
                target=unquote(target.split('#',1)[0])
                if not target:continue
                link_count+=1
                if not (path.parent/target).resolve().exists():errors.append('broken link: '+rel+' -> '+target)
        except (ValueError,OSError) as e:errors.append(str(e))
    return {'status':'pass' if not errors else 'fail','errors':errors,'counts':{'domains':len(covered),'claims':len(claims),'cases':len(cases),'assets':len(assets),'local_links':link_count},'boundary':'Mechanical provenance, coverage references and links only; substantive reading/reasoning require the editorial review.'}

def return_packet(manifest, base, request, manifest_path=None):
    result=checks(manifest,base)
    if result['status']!='pass':raise ValueError('Dossier contract failed: '+str(result['errors']))
    if request['game_id']!=manifest['game_id']:raise ValueError('Game identity mismatch')
    selected=[]
    for cid in request['claim_ids']:
        claim=next((x for x in manifest['claims'] if x['id']==cid),None)
        if claim is None:raise ValueError('Unknown claim: '+cid)
        if request.get('allowed_version_groups') and not set(claim['version_groups']).issubset(request['allowed_version_groups']):
            raise ValueError('Claim version not allowed by caller: '+cid)
        selected.append(claim)
    if not selected:raise ValueError('No claim requested')
    nodes,children=evidence_graph(manifest,[]);used=set()
    def collect(ref):
        if ref in used:return
        used.add(ref)
        kind,row=nodes[ref]
        for child in children(kind,row):collect(child)
    for claim in selected:collect(claim['id'])
    used_cases=[x for x in manifest['cases'] if x['id'] in used]
    used_claims=[x for x in manifest['claims'] if x['id'] in used]
    if request.get('allowed_version_groups') and any(not set(x['version_groups']).issubset(request['allowed_version_groups']) for x in used_claims):
        raise ValueError('Dependency claim version not allowed by caller')
    answered=all(x['support_status']=='supported_with_conditions' for x in used_claims) and all(x['status']=='answered' for x in used_cases)
    return {'schema_version':1,'dossier_id':manifest['dossier_id'],'game_id':manifest['game_id'],'study_mode':'focused_extension','caller_ref':request['caller_ref'],'question':request['question'],'status':'answered' if answered else 'partial','report_ref':manifest.get('dossier_ref'),'report_sha256':manifest['document_hashes'][manifest['dossier_ref']],'dossier_coverage_status':manifest['coverage_status'],'claims':selected,'case_refs':used_cases,'evidence_closure':sorted(used),'unresolved':manifest['unresolved'],'knowledge_disposition':manifest.get('knowledge_disposition','not_requested; follow current owner policy'),'topic_integration':manifest.get('topic_integration','not_requested'),'adoption':'returned; caller must record actual use separately','source_manifest_sha256':sha(manifest_path or base/'manifest.json')}

def export(manifest_path, output):
    manifest=load(manifest_path);base=manifest_path.parent
    result=checks(manifest,base)
    if result['status']!='pass':raise ValueError(str(result['errors']))
    if output.exists():raise ValueError('Output exists; preserve it and choose a new directory')
    allowed=(base/manifest['allowed_root']).resolve()
    mappings=[(bounded(base,x['source'],allowed),Path(x['destination'])) for x in manifest['export_roots']]
    if not mappings:raise ValueError('Portable exports require the canonical export roots')
    for _, dest in mappings:
        if dest.is_absolute() or '..' in dest.parts:raise ValueError('Unsafe export destination')
    if any(output==src or src.is_dir() and output.is_relative_to(src) for src,_ in mappings):
        raise ValueError('Output cannot be inside an exported source')
    output.mkdir(parents=True)
    copied=[]
    # Explicit roots only: no workspace scan, runtime, caches, .git, account files or Knowledge bodies.
    for source,dest in mappings:
        candidates=[source] if source.is_file() else sorted(source.rglob('*'))
        for file in candidates:
            if not file.is_file() or any(x in ('runtime','.git','__pycache__') for x in file.parts):continue
            if file.parent==base/'receipts' and file.name.startswith('portable-'):continue
            if not file.resolve().is_relative_to(allowed):raise ValueError('Export file escapes source boundary')
            target=output/dest if source.is_file() else output/dest/file.relative_to(source)
            target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,target)
            copied.append((file,target))
    # Registered evidence retains exact bytes, including Markdown notes outside
    # the original sources directory. Only editorial documents get link rewrites.
    registered_evidence={bounded(base,a['path'],allowed) for a in manifest['assets']}
    omitted=[]
    for original,target in copied:
        rel=target.relative_to(output).as_posix()
        if original.resolve() in registered_evidence or target.suffix.lower()!='.md' or rel.startswith(('evidence/sources/','legacy-evidence/upstream/')):continue
        def rewrite(match):
            raw=match.group(1).strip('<>')
            if urlsplit(raw).scheme or raw.startswith('#'):return match.group(0)
            path,sep,anchor=raw.partition('#');absolute=(original.parent/unquote(path)).resolve()
            for src,dest in mappings:
                if absolute==src or src.is_dir() and absolute.is_relative_to(src):
                    mapped=output/dest if src.is_file() else output/dest/absolute.relative_to(src)
                    relative=Path(os.path.relpath(mapped,target.parent)).as_posix()
                    return match.group(0).replace(match.group(1),relative+(sep+anchor if sep else ''))
            omitted.append({'file':target.relative_to(output).as_posix(),'host_reference':path})
            label=re.search(r'\[([^\]]*)\]',match.group(0)).group(1)
            return label+'（宿主参考，未随包）'
        target.write_text(LINK.sub(rewrite,target.read_text(encoding='utf-8-sig')),encoding='utf8')
    portable_model=json.loads(json.dumps(manifest))
    def portable_reference(relative):
        absolute=bounded(base,relative,allowed)
        for src,dest in mappings:
            if absolute==src or src.is_dir() and absolute.is_relative_to(src):
                mapped=output/dest if src.is_file() else output/dest/absolute.relative_to(src)
                return Path(os.path.relpath(mapped,output/'evidence')).as_posix()
        raise ValueError('Contract reference is outside explicit export roots: '+relative)
    for asset in portable_model['assets']:
        asset['path']=portable_reference(asset['path'])
    portable_model['domain_baseline']['snapshot_ref']=portable_reference(manifest['domain_baseline']['snapshot_ref'])
    if manifest.get('audit_revision_ref'):
        portable_model['audit_revision_ref']=portable_reference(manifest['audit_revision_ref'])
    portable_model.update(allowed_root='..',dossier_ref=portable_reference(manifest['dossier_ref']),export_roots=[],manifest_kind='portable_view')
    portable_model['documents']=[portable_reference(x) for x in manifest['documents']]
    portable_model['document_hashes']={x:sha(output/'evidence'/x) for x in portable_model['documents']}
    (output/'evidence').mkdir(parents=True,exist_ok=True)
    (output/'evidence/manifest.portable.json').write_text(json.dumps(portable_model,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    report=Path(os.path.relpath((output/'evidence'/portable_model['dossier_ref']).resolve(),output)).as_posix()
    entry=(f"# {manifest.get('game_title',manifest['game_id'])} · 游戏研究交付\n\n"
           f"从[研究档案]({report})开始。明确导出的原件保持字节，正文链接已转换；未随包的宿主引用有显式记录。\n\n"
           "使用接收者已有的dossier.py执行check-bundle --manifest <本目录>/portable-manifest.json；"
           "条件返回使用evidence/manifest.portable.json及接收者显式选择的request，不要求捆绑工作流目录。\n\n"
           "实际观察、版本、覆盖与体验限制见原报告；文件完整不替代研究充分性。"
           "研究档案供直接查阅，原Knowledge/专题边界不变。本包供私人研究交付，"
           "第三方版权归原作者，不构成公开发布授权。\n")
    (output/'README.md').write_text(entry,encoding='utf8')
    # Canonical manifest remains a historical receipt, never rewritten into fake canonical hashes.
    portable=[]
    for f in sorted(output.rglob('*')):
        if f.is_file():portable.append({'path':f.relative_to(output).as_posix(),'sha256':sha(f),'bytes':f.stat().st_size})
    record={'kind':'portable_dossier_handoff','canonical_manifest_sha256':sha(manifest_path),'files':portable,'host_references_not_included':omitted,'artifact_verification_receipts':'portable-* receipts remain at canonical host to avoid recursive handoff validation; final delivery receipt is separate','published':False,'rights':'Private research copy; upstream material rights remain with authors. No public redistribution approval.'}
    (output/'portable-manifest.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    return {'status':'exported','files':len(portable),'host_references':len(omitted),'output':str(output)}

def check_bundle(manifest_path):
    record=load(manifest_path);root=manifest_path.parent;errors=[]
    expected={x['path'] for x in record['files']}
    actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p!=manifest_path}
    if actual!=expected:errors.append('bundle file set changed')
    for row in record['files']:
        try:
            p=bounded(root,row['path'],root)
            if not p.is_file() or sha(p)!=row['sha256']:errors.append('bundle hash mismatch: '+row['path'])
        except ValueError as e:errors.append(str(e))
    for p in root.rglob('*.md'):
        rel=p.relative_to(root).as_posix()
        if rel.startswith(('evidence/sources/','legacy-evidence/upstream/')):continue
        for match in LINK.finditer(p.read_text(encoding='utf-8-sig')):
            raw=match.group(1).strip('<>')
            if urlsplit(raw).scheme or raw.startswith('#'):continue
            target=unquote(raw.split('#',1)[0])
            if target and not (p.parent/target).resolve().is_file() and not (p.parent/target).resolve().is_dir():errors.append('bundle broken link: '+rel+' -> '+target)
    return {'status':'pass' if not errors else 'fail','files':len(expected),'errors':errors,'original_archive_links_not_interpreted':True,'boundary':'Byte integrity and editorial local links; no gameplay/semantic acceptance inference.'}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['check','return','export','check-bundle']);p.add_argument('--manifest',type=Path,required=True);p.add_argument('--request',type=Path);p.add_argument('--output',type=Path)
    a=p.parse_args()
    if a.action in ('return','export') and not a.output:p.error('--output is required for return/export')
    if a.action=='return' and not a.request:p.error('--request is required for return')
    mp=a.manifest.resolve();manifest=load(mp)
    try:
        if a.action=='check-bundle':result=check_bundle(mp)
        elif a.action=='export':result=export(mp,a.output.resolve())
        elif a.action=='return':result=return_packet(manifest,mp.parent,load(a.request),mp)
        else:result=checks(manifest,mp.parent)
        if a.output and a.action!='export':a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        print(json.dumps(result,ensure_ascii=False))
        return 1 if result.get('status')=='fail' else 0
    except (ValueError,KeyError,OSError) as e:
        print(json.dumps({'status':'fail','error':str(e)},ensure_ascii=False));return 1

if __name__=='__main__':raise SystemExit(main())
