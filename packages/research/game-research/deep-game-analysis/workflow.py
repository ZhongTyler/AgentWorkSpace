"""Deterministic local study coordinator. Semantic verdicts stay external.

Run with -B. Never fetches sources, calls models, writes Knowledge catalog,
controls a game, changes scheduling, commits or pushes.
"""
from __future__ import annotations
import sys
sys.dont_write_bytecode = True
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from compile_study import HERE, RENDERER, compile_report, digest, dossier, inputs, load_module, local, read, verify_compiled, write_json

GATES = ('content', 'page', 'knowledge')

def now(): return datetime.now(timezone.utc).isoformat()

def snapshot(report):
    files = {}
    for path in sorted(report.rglob('*')):
        if path.is_symlink(): raise ValueError('Report contains a symlink: ' + str(path))
        if path.is_file(): files[path.relative_to(report).as_posix()] = digest(path)
    identity = hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'id': identity, 'files': files}

def tool_identity():
    paths = [Path(__file__), HERE / 'compile_study.py', HERE / 'dossier.py', RENDERER,
             HERE / 'reader-navigation/build.py', HERE / 'reader-navigation/check.py',
             HERE / 'reader-navigation/navigation.css', HERE / 'reader-navigation/navigation.js']
    return {str(p.relative_to(HERE.parents[1])): digest(p) for p in paths}

def prepare_reader_review(report, run):
    """Expose actual reader units to one author edit; never invent a review verdict."""
    study = read(report / 'study.json')
    projection = read(report / 'evidence/unit-projections.json')
    units = {u['section_id']: u for u in projection['units']}
    packet = {'schema_version': 1, 'report_snapshot': snapshot(report)['id'],
              'source_study_sha256': digest(report / 'study.json'),
              'kind': 'author_reader_value_review_input', 'semantic_verdict': 'not_judged',
              'skills': ['humanizer-zh', 'anti-defensive-writing'],
              'questions': ['本节帮助读者理解什么，完整正文和图注是否回答它？',
                            '过程自述、重复免责及无增量段落是否应移回后台或删去？',
                            '精简后，规则、数字、条件、反例和来源是否完整保留？'],
              'instruction': 'Read the actual complete units and relevant figures, edit once before independent audit. This packet is not author approval or a new external gate.',
              'sections': [{'id': s['id'], 'title': s['title'], 'reader_goals': s['reader_goals'],
                            'document': str(local(report, units[s['id']]['path'])),
                            'sha256': digest(local(report, units[s['id']]['path']))} for s in study['sections']]}
    path = run / 'reader-review-input.json'; write_json(path, packet)
    return {'path': str(path), 'sections': len(packet['sections']), 'semantic_verdict': 'not_judged'}

def compare_delivery_tools(repository, revision, current, planned=()):
    import re
    if not re.fullmatch(r'[0-9a-fA-F]{40}', revision): raise ValueError('Use an exact 40-character Git commit SHA')
    current = {p.replace('\\', '/'): h for p, h in current.items()}
    planned = {p.replace('\\', '/') for p in planned}
    if not planned <= current.keys(): raise ValueError('Planned tool is outside the known tool set')
    command = ['git', '-c', 'safe.directory=' + repository.as_posix(), '-C', str(repository)]
    checked = subprocess.run([*command, 'cat-file', '-t', revision], capture_output=True)
    if checked.returncode or checked.stdout.strip() != b'commit': raise ValueError('Cannot read the specified Git commit')
    rows = []
    for path, expected in current.items():
        result = subprocess.run([*command, 'show', revision + ':' + path], capture_output=True)
        actual = hashlib.sha256(result.stdout).hexdigest() if result.returncode == 0 else None
        rows.append({'path': path, 'working_sha256': expected, 'revision_sha256': actual,
                     'status': 'match' if actual == expected else 'planned_change' if path in planned else 'unplanned_change'})
    return {'revision': revision, 'tools': rows,
            'committed_tools_verified': all(r['status'] == 'match' for r in rows),
            'unplanned_changes': [r['path'] for r in rows if r['status'] == 'unplanned_change']}

def delivery_preflight(args):
    boundary = read(args.cost_boundary)
    fields = ('measurement_end', 'bookkeeping_tail', 'token_scope', 'parallel_accounting')
    if boundary.get('schema_version') != 1 or any(not isinstance(boundary.get(k), str) or not boundary[k].strip() for k in fields):
        raise ValueError('Cost boundary needs schema_version=1 and ' + ', '.join(fields))
    result = compare_delivery_tools(HERE.parents[1], args.revision, tool_identity(), args.planned_tool)
    result['cost_boundary'] = {k: boundary[k] for k in fields}
    result['cost_boundary_source_sha256'] = digest(args.cost_boundary)
    result['cost_measurement'] = 'declaration_only; actual phases and finish remain with the existing cost tool'
    write_json(args.run / 'delivery-preflight-inputs.json', result)
    if result['unplanned_changes']:
        raise ValueError('Unplanned tool differences; preserve other owners and resolve before delivery: ' + ', '.join(result['unplanned_changes']))
    return result

@contextmanager
def writer_lock(run, filename='writer.lock'):
    lock = run / filename
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump({'pid': os.getpid(), 'started_at': now()}, stream)
        yield
    finally:
        lock.unlink()

def save_state(run, state):
    temporary = run / 'state.json.new'
    write_json(temporary, state)
    temporary.replace(run / 'state.json')

def state_for(run, report):
    path = run / 'state.json'
    state = read(path) if path.exists() else {'schema_version': 1, 'report': str(report), 'steps': {}, 'gates': {}}
    if state.get('schema_version') != 1 or state.get('report') != str(report):
        raise ValueError('Run belongs to a different report or schema')
    return state

def fresh_step(state, name, current):
    step = state['steps'].get(name, {})
    return step.get('status') == 'pass' and step.get('snapshot') == current['id'] and step.get('tools') == tool_identity()

def receipt_valid(record, current):
    try:
        if record['snapshot'] != current['id']: return False
        path = Path(record['receipt'])
        if digest(path) != record['receipt_sha256']: return False
        return all(digest(Path(p)) == h for p, h in record['evidence'].items())
    except (KeyError, OSError, ValueError): return False

def require_check(state, current):
    if not fresh_step(state, 'check', current):
        raise ValueError('Current report has no successful mechanical check; run check first')

def require_gate(state, gate, current):
    if not receipt_valid(state['gates'].get(gate, {}), current):
        raise ValueError('Missing or stale external ' + gate + ' verdict')

def structural_check(report):
    study, _, _, assets = inputs(report)
    verify_compiled(report, study, assets)
    checked = dossier.checks(read(report / 'manifest.json'), report)
    if checked['status'] != 'pass': raise ValueError('; '.join(checked['errors']))
    # Reuse the existing checker, including its existing large-report option.
    # Do not modify that independently owned script or silently lower its checks.
    navdir = str(HERE / 'reader-navigation')
    sys.path.insert(0, navdir)
    try:
        module = load_module('study_navigation_check', HERE / 'reader-navigation/check.py')
        import inspect
        kwargs = {'trusted_large_report': True} if 'trusted_large_report' in inspect.signature(module.check).parameters else {}
        if not kwargs:
            # Older checker versions use lxml's small default text limit. Adapt
            # only this loaded module for generated local embedded resources;
            # preserve every existing integrity assertion and disable networking.
            original_html = module.html
            class GeneratedLocalHtml:
                def __getattr__(self, name): return getattr(original_html, name)
                def fromstring(self, data, *args, **options):
                    options['parser'] = original_html.HTMLParser(huge_tree=True, no_network=True)
                    return original_html.fromstring(data, *args, **options)
            module.html = GeneratedLocalHtml()
        nav = module.check(report, **kwargs)
    finally:
        sys.path.remove(navdir)
    if not nav['pass']: raise ValueError('Navigation checks failed: ' + json.dumps(nav['checks']))
    return {'dossier': checked, 'navigation_checks': nav['checks'], 'browser': 'external_verdict_required'}

def build_transaction(report, run):
    # Validate before copying or writing. Preserve any failed draft for recovery.
    inputs(report)
    stage = Path(tempfile.mkdtemp(prefix='build-', dir=run)) / 'report'
    shutil.copytree(report, stage)
    try:
        result = compile_report(stage)
        result['checks'] = structural_check(stage)
    except Exception:
        raise ValueError('Build failed; original report unchanged. Inspect ' + str(stage))
    # All checking finished in isolation. Publish only compiler-owned outputs.
    products = ['README.md', 'manifest.json', 'reader/index.html', 'reader/navigation.json', 'evidence/unit-projections.json']
    products += [u['path'] for u in read(stage / 'evidence/unit-projections.json')['units']]
    binding = read(stage / 'study.json').get('explanation_bindings')
    if binding and binding not in products:
        products.append(binding)
    backups = {}
    for relative in products:
        destination = local(report, relative)
        if destination.with_name(destination.name + '.pipeline-new').exists():
            raise ValueError('Preserve unexpected pending output: ' + relative)
        backups[relative] = destination.read_bytes() if destination.exists() else None
    try:
        for relative in products:
            destination = local(report, relative); destination.parent.mkdir(parents=True, exist_ok=True)
            pending = destination.with_name(destination.name + '.pipeline-new')
            shutil.copyfile(local(stage, relative), pending); pending.replace(destination)
        if snapshot(report)['id'] != snapshot(stage)['id']:
            raise ValueError('Published report differs from the checked stage')
    except Exception:
        for relative, previous in backups.items():
            destination = local(report, relative)
            if previous is None:
                if destination.exists(): destination.unlink()
            else: destination.write_bytes(previous)
            pending = destination.with_name(destination.name + '.pipeline-new')
            if pending.exists(): pending.unlink()
        raise
    # Clean only the exact task-owned stage after successful publication.
    assert stage.parent.resolve().is_relative_to(run.resolve())
    shutil.rmtree(stage.parent)
    return result

def record_verdict(args, state, current):
    require_check(state, current)
    verdict = read(args.receipt.resolve())
    gate = args.gate
    if gate == 'knowledge':
        require_gate(state, 'content', current); require_gate(state, 'page', current)
        if state.get('frozen_snapshot') != current['id']: raise ValueError('Freeze before Knowledge acceptance')
    for key in ('actor', 'scope', 'evidence'):
        if not verdict.get(key): raise ValueError('External verdict requires ' + key)
    if verdict.get('schema_version') != 1 or verdict.get('gate') != gate:
        raise ValueError('Wrong external verdict schema/gate')
    if verdict.get('report_snapshot') != current['id']:
        raise ValueError('Verdict concerns another report version')
    if verdict.get('verdict') not in ('pass', 'pass_with_limits'):
        raise ValueError('External verdict did not pass; retain its original evidence and repair the report')
    if verdict['verdict'] == 'pass_with_limits' and not verdict.get('limits'):
        raise ValueError('Limited verdict must retain its limits')
    evidence = {}
    for item in verdict['evidence']:
        path = (args.receipt.resolve().parent / item['path']).resolve()
        if digest(path) != item['sha256']: raise ValueError('External evidence changed: ' + str(path))
        evidence[str(path)] = item['sha256']
    if gate == 'knowledge':
        accepted = [read(Path(p)) for p in evidence if Path(p).suffix == '.json']
        manifest_hash = digest(args.report / 'manifest.json')
        if not any(x.get('status') == 'accepted_local' and x.get('manifest_sha256') == manifest_hash for x in accepted):
            raise ValueError('Knowledge owner exact-manifest acceptance is required')
        if not any(x.get('status') == 'passed' and (x.get('manifest_sha256') == manifest_hash or x.get('version_rebind', {}).get('current_manifest_sha256') == manifest_hash) for x in accepted):
            raise ValueError('Knowledge owner current-manifest lookup receipt is required')
    state['gates'][gate] = {'snapshot': current['id'], 'receipt': str(args.receipt.resolve()), 'receipt_sha256': digest(args.receipt), 'evidence': evidence, 'actor': verdict['actor'], 'scope': verdict['scope'], 'limits': verdict.get('limits', [])}
    return {'recorded': gate, 'semantic_verdict_created_by_script': False}

def execute(args, state, current):
    if args.action == 'preflight':
        study, manifest, routes, _ = inputs(args.report)
        return {'sections': len(study['sections']), 'domains': len(manifest['domains']), 'routes': len(routes['routes']), 'content_quality': 'not_judged'}
    if args.action == 'build': return build_transaction(args.report, args.run)
    if args.action == 'check': return structural_check(args.report)
    if args.action == 'prepare-review':
        require_check(state, current)
        return prepare_reader_review(args.report, args.run)
    if args.action == 'delivery-preflight': return delivery_preflight(args)
    if args.action == 'record': return record_verdict(args, state, current)
    if args.action in ('freeze', 'handoff'):
        require_check(state, current)
        require_gate(state, 'content', current); require_gate(state, 'page', current)
        if args.action == 'freeze':
            state['frozen_snapshot'] = current['id']
            write_json(args.run / 'frozen.json', current)
            return {'frozen_snapshot': current['id'], 'report_files_modified': False}
        if state.get('frozen_snapshot') != current['id']: raise ValueError('Freeze current report first')
        relations = read(args.relations)
        if relations.get('manifest_sha256') != digest(args.report / 'manifest.json'):
            raise ValueError('Relation proposal is not bound to the frozen manifest')
        packet = {'schema_version': 1, 'report_snapshot': current['id'], 'manifest_sha256': digest(args.report / 'manifest.json'), 'report': str(args.report), 'relations': str(args.relations.resolve()), 'relations_sha256': digest(args.relations), 'knowledge_owner_action': 'review_and_maintain_catalog_wiki_group_and_verify_three_routes', 'status': 'pending_owner_acceptance'}
        write_json(args.run / 'handoff.json', packet)
        return packet
    raise ValueError('Unknown action')

def run(args):
    args.report = args.report.resolve(); args.run = args.run.resolve()
    if args.run.is_relative_to(args.report): raise ValueError('Keep workflow state outside the formal report')
    args.run.mkdir(parents=True, exist_ok=True)
    with writer_lock(args.run), writer_lock(args.report.parent, '.' + args.report.name + '.workflow.lock'):
        state = state_for(args.run, args.report); current = snapshot(args.report)
        if args.action == 'status':
            gates = {g: receipt_valid(state['gates'].get(g, {}), current) for g in GATES}
            checked = fresh_step(state, 'check', current)
            return {'report_snapshot': current['id'], 'mechanically_checked': checked, 'gates': gates, 'frozen': state.get('frozen_snapshot') == current['id'] and checked and gates['content'] and gates['page'], 'automatic_model_or_billing_tokens': 'unknown'}
        if args.action in ('preflight', 'build', 'check'):
            if fresh_step(state, args.action, current):
                result = {'reused': args.action, 'report_snapshot': current['id']}
                if args.action == 'build': result['reader_review_input'] = prepare_reader_review(args.report, args.run)
                return result
            failure = state.get('last_failure', {})
            if failure.get('action') == args.action and failure.get('snapshot') == current['id'] and failure.get('tools') == tool_identity() and not args.retry_reason:
                raise ValueError('Same failed input already recorded; change the input/tool or provide --retry-reason')
        started = now(); clock = time.monotonic(); before = current['id']
        try:
            result = execute(args, state, current)
            if args.action == 'build': result['reader_review_input'] = prepare_reader_review(args.report, args.run)
            after = snapshot(args.report)
            if args.action in ('preflight', 'build', 'check'):
                state['steps'][args.action] = {'status': 'pass', 'snapshot': after['id'], 'tools': tool_identity()}
            if args.action == 'build':
                state['steps']['check'] = {'status': 'pass', 'snapshot': after['id'], 'tools': tool_identity()}
            state.pop('last_failure', None)
            write_json(args.run / (args.action + '-result.json'), result)
            write_json(args.run / 'current-snapshot.json', after)
            summary = {'action': args.action, 'status': 'pass', 'report_snapshot': after['id'], 'result_file': str(args.run / (args.action + '-result.json'))}
            if args.action == 'build': summary['reader_review_input'] = result['reader_review_input']
            if args.action == 'delivery-preflight': summary['committed_tools_verified'] = result['committed_tools_verified']
            return summary
        except Exception as error:
            state['last_failure'] = {'action': args.action, 'snapshot': before, 'tools': tool_identity(), 'error': str(error)}
            raise
        finally:
            event = {'started_at': started, 'finished_at': now(), 'action': args.action, 'seconds': time.monotonic() - clock, 'status': 'fail' if 'last_failure' in state else 'pass', 'snapshot_before': before, 'retry_reason': args.retry_reason, 'tokens': 'unknown'}
            with (args.run / 'events.jsonl').open('a', encoding='utf-8', newline='\n') as stream:
                stream.write(json.dumps(event, ensure_ascii=False) + '\n')
            save_state(args.run, state)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['preflight', 'build', 'check', 'prepare-review', 'delivery-preflight', 'record', 'freeze', 'handoff', 'status'])
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--run', type=Path, required=True)
    parser.add_argument('--gate', choices=GATES)
    parser.add_argument('--receipt', type=Path)
    parser.add_argument('--relations', type=Path)
    parser.add_argument('--retry-reason', default='')
    parser.add_argument('--revision', help='Exact Git commit to compare, never fetched or checked out')
    parser.add_argument('--planned-tool', action='append', default=[], help='Owned tool path expected to differ before its commit')
    parser.add_argument('--cost-boundary', type=Path, help='Original batch cost boundary declaration, schema_version=1')
    args = parser.parse_args()
    if args.action == 'record' and (not args.gate or not args.receipt): parser.error('record requires --gate and --receipt')
    if args.action == 'handoff' and not args.relations: parser.error('handoff requires --relations')
    if args.action == 'delivery-preflight' and (not args.revision or not args.cost_boundary): parser.error('delivery-preflight requires --revision and --cost-boundary')
    try: print(json.dumps(run(args), ensure_ascii=False))
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(json.dumps({'status': 'fail', 'error': str(error)}, ensure_ascii=False)); return 1
    return 0

if __name__ == '__main__': raise SystemExit(main())
