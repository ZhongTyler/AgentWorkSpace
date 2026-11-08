"""Stage, stale-evidence and compiler regressions; synthetic content is not research."""
import argparse
import copy
from pathlib import Path
import tempfile
import unittest
import subprocess

import workflow as w
from compile_study import digest, read, write_json, grouped_toc

class WorkflowTests(unittest.TestCase):
    def test_transaction_publishes_declared_explanation_binding(self):
        from unittest.mock import patch
        self.study['explanation_bindings'] = 'evidence/explanation-bindings.json'
        write_json(self.report / 'study.json', self.study)
        binding = self.report / self.study['explanation_bindings']
        binding.write_text('old binding', encoding='utf-8')
        self.run.mkdir(exist_ok=True)
        def compile_fixture(stage):
            for relative in ['README.md', 'manifest.json', 'reader/index.html', 'reader/navigation.json', 'units/core.md']:
                path = stage / relative
                path.parent.mkdir(exist_ok=True)
                path.write_text('fixture output', encoding='utf-8')
            write_json(stage / 'evidence/unit-projections.json', {'units': [{'path': 'units/core.md'}]})
            (stage / self.study['explanation_bindings']).write_text('new binding', encoding='utf-8')
            return {}
        with patch.object(w, 'inputs'), patch.object(w, 'compile_report', side_effect=compile_fixture), patch.object(w, 'structural_check', return_value={'synthetic': True}):
            w.build_transaction(self.report, self.run)
        self.assertEqual(binding.read_text(encoding='utf-8'), 'new binding')

    def test_domain_guidance_is_available_in_text_master(self):
        self.navigation['guidance_version'] = 1
        route = self.navigation['routes'][0]
        route['intro'] = '沿对象、动作和后态理解这一领域的具体问题。'
        route['steps'][0]['focus'] = '先核对这一节的可见状态，再对应规则条件。'
        write_json(self.report / 'reader/navigation.json', self.navigation)
        self.call('build')
        body = (self.report / 'README.md').read_text(encoding='utf-8')
        self.assertIn(route['intro'], body)
        self.assertIn(route['steps'][0]['focus'], body)
        self.assertIn('#### 玩法', body)

    def test_guide_is_separate_from_sticky_navigation(self):
        self.call('build')
        from lxml import html
        tree = html.fromstring((self.report / 'reader/index.html').read_bytes())
        guide = tree.get_element_by_id('rn-guide-core')
        bar = tree.get_element_by_id('rn-routebar')
        self.assertNotIn(bar, list(guide.iterancestors()))
        self.assertEqual(tree.get_element_by_id('rn-route-progress').tag, 'progress')
        self.assertNotIn('rn-route-detail', tree.xpath('//@id'))

    def test_build_exposes_actual_reader_units_without_approval(self):
        self.call('build'); before = w.snapshot(self.report)
        packet = read(self.run / 'reader-review-input.json')
        self.assertEqual(packet['report_snapshot'], before['id'])
        self.assertEqual(packet['semantic_verdict'], 'not_judged')
        self.assertEqual(len(packet['sections']), 1)
        unit = Path(packet['sections'][0]['document'])
        self.assertEqual(packet['sections'][0]['sha256'], digest(unit))
        self.assertIn('合成测试，不是真实游戏研究。', unit.read_text(encoding='utf-8'))
        self.call('prepare-review')
        self.assertEqual(w.snapshot(self.report), before)
        self.assertEqual(read(self.run / 'state.json')['gates'], {})

    def test_delivery_tools_distinguish_planned_and_unplanned_changes(self):
        repository = self.root / 'git-input'; repository.mkdir()
        def git(*args):
            p = subprocess.run(['git', '-c', 'safe.directory=' + repository.as_posix(),
                '-c', 'core.autocrlf=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                '-C', str(repository), *args], capture_output=True)
            self.assertEqual(p.returncode, 0, p.stderr.decode(errors='replace'))
            return p.stdout.decode().strip()
        git('init', '--quiet', '--object-format=sha1')
        path = repository / 'tool.py'; path.write_bytes(b'original\n')
        git('add', 'tool.py'); git('commit', '--quiet', '-m', 'fixture'); revision = git('rev-parse', 'HEAD')
        self.assertTrue(w.compare_delivery_tools(repository, revision, {'tool.py': digest(path)})['committed_tools_verified'])
        path.write_bytes(b'changed\n'); current = {'tool.py': digest(path)}
        self.assertEqual(w.compare_delivery_tools(repository, revision, current)['unplanned_changes'], ['tool.py'])
        planned = w.compare_delivery_tools(repository, revision, current, ['tool.py'])
        self.assertFalse(planned['committed_tools_verified']); self.assertEqual(planned['unplanned_changes'], [])
        with self.assertRaises(ValueError): w.compare_delivery_tools(repository, revision, current, ['outside.py'])

    def test_missing_cost_boundary_is_not_silently_completed(self):
        path = self.root / 'cost-boundary.json'; write_json(path, {'schema_version': 1, 'measurement_end': 'main delivery'})
        with self.assertRaisesRegex(ValueError, 'bookkeeping_tail'):
            self.call('delivery-preflight', revision='0' * 40, planned_tool=[], cost_boundary=path)
        self.assertEqual(read(path), {'schema_version': 1, 'measurement_end': 'main delivery'})

    def test_native_light_groups_reject_loss_and_reordering(self):
        study = {'sections': [{'id': x, 'title': x} for x in ('start','rule','case','end')],
                 'toc_layout': {'type': 'grouped', 'leading': ['start'], 'groups': [
                     {'id': 'rules', 'title': 'Rules & cases', 'sections': ['rule','case']}], 'trailing': ['end']}}
        page = '<style></style><nav id="contents" aria-label="章节目录">old</nav>'
        built = grouped_toc(study, page)
        self.assertIn('Rules &amp; cases', built)
        self.assertEqual(built.count('href="#'), 4)
        for members in (['rule'], ['case','rule'], ['rule','rule']):
            changed = copy.deepcopy(study); changed['toc_layout']['groups'][0]['sections'] = members
            with self.assertRaisesRegex(ValueError, 'cover each current section once'):
                grouped_toc(changed, page)
        self.assertEqual(grouped_toc({'sections': study['sections']}, page), page)

    def setUp(self):
        test_root = w.HERE.parents[1] / '.tmp'
        test_root.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='workflow-test-', dir=test_root); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.report = self.root / 'report'; self.run = self.root / 'run'
        self.report.mkdir(); (self.report / 'reader').mkdir(); (self.report / 'evidence').mkdir()
        baseline = self.report / 'evidence/baseline.json'
        write_json(baseline, {'names': ['玩法'], 'source_sha256': 'fixture-baseline'})
        self.study = {'schema': 1, 'title': '合成测试', 'subtitle': '仅测试工具', 'edition': 'fixture-v1', 'reader': '检查生成和阶段控制', 'sources': {'S1': {'url': 'https://example.org', 'label': '测试来源'}}, 'sections': [{'id': 'core', 'title': '规则与边界', 'subtitle': '本节回答什么', 'reader_goals': [1], 'references': ['S1'], 'blocks': [{'type': 'p', 'text': '合成测试，不是真实游戏研究。'}, {'type': 'flow', 'items': ['开始', '结束']}]}]}
        self.manifest = {'schema_version': 1, 'dossier_id': 'synthetic-test', 'allowed_root': '.', 'dossier_ref': 'README.md', 'domain_baseline': {'names': ['玩法'], 'sha256': 'fixture-baseline', 'snapshot_ref': 'evidence/baseline.json', 'snapshot_sha256': digest(baseline)}, 'sources': [{'id': 'S1', 'read_status': 'read', 'read_scope': 'synthetic fixture only', 'url': 'https://example.org'}], 'assets': [{'id': 'A1', 'path': 'evidence/baseline.json', 'sha256': digest(baseline), 'source_id': 'S1', 'accepted': True, 'role': 'frozen_projection'}], 'domains': [{'name': '玩法', 'applicability': 'present', 'chapter': 'README.md', 'scope': 'synthetic fixture only', 'evidence': ['C1']}], 'cases': [{'id': 'E1', 'path': 'README.md', 'status': 'answered', 'evidence': ['S1'], 'frames': [], 'evidence_requirements': {'kind': 'documentary', 'required_refs': ['S1']}}], 'claims': [{'id': 'C1', 'chapter': 'README.md', 'evidence': ['E1'], 'version_groups': ['fixture-v1'], 'conditions': ['fixture'], 'limits': ['not research']}], 'documents': ['README.md'], 'document_hashes': {}}
        self.navigation = {'schema_version': 1, 'title': '合成测试', 'report_id': 'synthetic-test', 'routes': [{'id': 'domain-1', 'name': '玩法', 'intro': '仅测试导航', 'steps': [{'target': 'core', 'title': '规则与边界', 'focus': '核对实际段落', 'source': {'file': 'README.md', 'heading': '规则与边界', 'role': 'primary'}}]}]}
        write_json(self.report / 'study.json', self.study); write_json(self.report / 'manifest.json', self.manifest); write_json(self.report / 'reader/navigation.json', self.navigation)

    def call(self, action, **kwargs):
        args = argparse.Namespace(action=action, report=self.report, run=self.run, gate=None, receipt=None, relations=None, retry_reason='')
        for key, value in kwargs.items(): setattr(args, key, value)
        return w.run(args)

    def verdict(self, gate, **overrides):
        evidence = self.root / (gate + '-evidence.md'); evidence.write_text('Synthetic test verdict, not real approval.\n', encoding='utf-8')
        value = {'schema_version': 1, 'gate': gate, 'report_snapshot': w.snapshot(self.report)['id'], 'actor': 'synthetic-test', 'scope': 'synthetic fixture only', 'verdict': 'pass', 'evidence': [{'path': evidence.name, 'sha256': digest(evidence)}]}
        value.update(overrides); path = self.root / (gate + '-verdict.json'); write_json(path, value)
        return path

    def approve(self):
        self.call('record', gate='content', receipt=self.verdict('content'))
        self.call('record', gate='page', receipt=self.verdict('page'))

    def test_complete_local_chain_and_unchanged_reuse(self):
        self.assertEqual(self.call('preflight')['status'], 'pass')
        self.call('build'); original = w.snapshot(self.report)
        self.assertEqual(self.call('build')['reused'], 'build')
        self.assertEqual(self.call('check')['reused'], 'check')
        self.approve(); self.call('freeze')
        relations = self.root / 'relations.json'; write_json(relations, {'manifest_sha256': digest(self.report / 'manifest.json'), 'proposals': []})
        self.call('handoff', relations=relations)
        self.assertTrue(self.call('status')['frozen'])
        self.assertEqual(w.snapshot(self.report), original)
        self.assertEqual(read(self.run / 'handoff.json')['status'], 'pending_owner_acceptance')
        self.assertFalse(self.call('status')['gates']['knowledge'])

    def test_missing_repeated_field_fails_before_output(self):
        self.study['sections'][0].pop('reader_goals'); write_json(self.report / 'study.json', self.study)
        before = w.snapshot(self.report)
        with self.assertRaisesRegex(ValueError, 'reader_goals'): self.call('preflight')
        self.assertEqual(w.snapshot(self.report), before)
        with self.assertRaisesRegex(ValueError, 'Same failed input'): self.call('preflight')
        self.assertFalse((self.run / 'writer.lock').exists())

    def test_failed_staging_preserves_original(self):
        self.manifest['domain_baseline']['names'] = ['错误']; write_json(self.report / 'manifest.json', self.manifest)
        before = w.snapshot(self.report)
        with self.assertRaises(ValueError): self.call('build')
        self.assertEqual(w.snapshot(self.report), before)

    def test_changed_media_not_silently_rehashed(self):
        (self.report / 'evidence/baseline.json').write_text('{}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Asset changed'): self.call('build')
        self.assertFalse((self.report / 'README.md').exists())

    def test_study_change_cannot_pass_check_with_old_outputs(self):
        self.call('build')
        self.study['sections'][0]['blocks'][0]['text'] = 'A new authored conclusion.'
        write_json(self.report / 'study.json', self.study)
        with self.assertRaisesRegex(ValueError, 'generated README differ'): self.call('check')

    def test_undeclared_image_and_source_mismatch_refused(self):
        (self.report / 'unregistered.png').write_bytes(b'synthetic bytes')
        self.study['sections'][0]['blocks'].append({'type': 'image', 'src': 'unregistered.png', 'caption': 'synthetic'})
        write_json(self.report / 'study.json', self.study)
        with self.assertRaisesRegex(ValueError, 'declared accepted asset'): self.call('preflight')
        self.study['sections'][0]['blocks'].pop()
        self.study['sources']['S1']['url'] = 'https://example.net'
        write_json(self.report / 'study.json', self.study)
        with self.assertRaisesRegex(ValueError, 'manifest source'): self.call('preflight')

    def test_publication_failure_rolls_back_original_files(self):
        from unittest.mock import patch
        self.call('build'); before = w.snapshot(self.report)
        self.study['sections'][0]['blocks'][0]['text'] = 'An edited draft.'
        write_json(self.report / 'study.json', self.study)
        expected = w.snapshot(self.report)
        original_copy = w.shutil.copyfile
        def fail_publish(src, dst, *args, **kwargs):
            if Path(dst) == self.report / 'reader/index.html.pipeline-new': raise OSError('synthetic publication failure')
            return original_copy(src, dst, *args, **kwargs)
        with patch.object(w.shutil, 'copyfile', side_effect=fail_publish):
            with self.assertRaisesRegex(OSError, 'publication failure'): self.call('build')
        self.assertEqual(w.snapshot(self.report), expected)

    def test_freeze_cannot_replace_semantic_or_page_verdict(self):
        self.call('build')
        with self.assertRaisesRegex(ValueError, 'content'): self.call('freeze')
        self.call('record', gate='content', receipt=self.verdict('content'))
        with self.assertRaisesRegex(ValueError, 'page'): self.call('freeze')

    def test_report_change_invalidates_all_gates_and_freeze(self):
        self.call('build'); self.approve(); self.call('freeze')
        with (self.report / 'README.md').open('a', encoding='utf-8') as stream: stream.write('Changed.\n')
        status = self.call('status')
        self.assertFalse(status['mechanically_checked']); self.assertFalse(status['frozen'])
        self.assertFalse(any(status['gates'].values()))
        with self.assertRaisesRegex(ValueError, 'mechanical check'): self.call('freeze')

    def test_wrong_version_or_negative_review_rejected(self):
        self.call('build')
        with self.assertRaisesRegex(ValueError, 'another report'): self.call('record', gate='content', receipt=self.verdict('content', report_snapshot='0' * 64))
        with self.assertRaisesRegex(ValueError, 'did not pass'): self.call('record', gate='content', receipt=self.verdict('content', verdict='fail'))

    def test_review_evidence_or_receipt_changes_are_stale(self):
        self.call('build'); self.approve(); self.call('freeze')
        (self.root / 'page-evidence.md').write_text('changed', encoding='utf-8')
        self.assertFalse(self.call('status')['gates']['page'])
        self.assertFalse(self.call('status')['frozen'])
        with self.assertRaisesRegex(ValueError, 'page'): self.call('freeze')

    def test_run_or_media_escape_and_second_writer_refused(self):
        with self.assertRaises(ValueError): self.call('preflight', run=self.report / 'state')
        self.study['sections'][0]['blocks'].append({'type': 'image', 'src': '../outside.png', 'caption': 'test'})
        write_json(self.report / 'study.json', self.study)
        with self.assertRaisesRegex(ValueError, 'escapes report'): self.call('preflight')
        with w.writer_lock(self.report.parent, '.' + self.report.name + '.workflow.lock'):
            with self.assertRaises(FileExistsError): self.call('preflight')

    def test_knowledge_requires_owner_acceptance_and_current_lookup(self):
        self.call('build'); self.approve(); self.call('freeze')
        acceptance = self.root / 'accepted.json'; lookup = self.root / 'lookup.json'; h = digest(self.report / 'manifest.json')
        write_json(acceptance, {'status': 'accepted_local', 'manifest_sha256': h})
        write_json(lookup, {'status': 'passed', 'manifest_sha256': '0' * 64})
        evidence = [{'path': p.name, 'sha256': digest(p)} for p in [acceptance, lookup]]
        with self.assertRaisesRegex(ValueError, 'current-manifest lookup'): self.call('record', gate='knowledge', receipt=self.verdict('knowledge', evidence=evidence))
        write_json(lookup, {'status': 'passed', 'version_rebind': {'current_manifest_sha256': h}})
        evidence = [{'path': p.name, 'sha256': digest(p)} for p in [acceptance, lookup]]
        self.call('record', gate='knowledge', receipt=self.verdict('knowledge', evidence=evidence))
        self.assertTrue(self.call('status')['gates']['knowledge'])

if __name__ == '__main__': unittest.main()
