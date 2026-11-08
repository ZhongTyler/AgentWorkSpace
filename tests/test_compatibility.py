import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from test_workspace import fixture
import compatibility as c
import workspace as w
from publish import inventory

ROOT = Path(__file__).resolve().parents[1]


class CompatibleWorkspace(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='compatible-workspace-')
        self.base = Path(self.temp.name)
        self.bundle, self.target = self.base / 'bundle', self.base / 'host'
        fixture(self.bundle, '1.2.0', '1.1.0')
        self.contract = json.loads((ROOT / 'tests/fixtures/compatibility-1.30.0.json').read_text(encoding='utf-8'))
        self.seal(self.bundle)
        self.target.mkdir()
        (self.target / 'AGENTS.md').write_bytes(b'Existing host rules. Keep ownership, facts and recovery.\n')
        (self.target / 'README.md').write_bytes(b'Existing workspace home\n')
        self.profile = {'schema_version': 1, 'providers': [{'id': 'existing-host', 'capabilities': ['host-governance'], 'assurance': 'reviewed', 'reason': 'Synthetic reviewed host contract', 'checks': {'host-governance': self.contract['capabilities']['host-governance']['criteria']}, 'evidence': [{'path': 'AGENTS.md', 'sha256': w.digest((self.target / 'AGENTS.md').read_bytes())}]}]}

    def tearDown(self):
        self.temp.cleanup()

    def seal(self, folder):
        catalog = json.loads((folder / 'catalog.json').read_text(encoding='utf-8'))
        definition = json.loads(json.dumps(self.contract))
        definition['components'] = {name: item for name, item in definition['components'].items() if name in catalog['components']}
        catalog['compatibility'] = definition
        (folder / 'compatibility.json').write_bytes(w.encoded(definition))
        (folder / 'catalog.json').write_bytes(w.encoded(catalog))

    def install(self, packages, apply=True, **kwargs):
        return w.install(self.bundle, self.target, 'init', packages, apply, mode='compatible', **kwargs)

    def test_audit_is_readonly_and_names_are_not_equivalence(self):
        before = inventory(self.target)
        report = c.audit(w.catalog(self.bundle), self.target, ['brainstorm'], ['brainstorm'])
        self.assertEqual(before, inventory(self.target))
        self.assertEqual(0, report['writes'])
        self.assertTrue(report['candidates'])
        self.assertEqual('host-governance', report['required'][0]['capability'])
        self.assertEqual(['meta'], report['required'][0]['install_options'])
        report = c.audit(w.catalog(self.bundle), self.target, [], ['brainstorm'])
        self.assertFalse(report['required'], 'Unselected recommendations are never mandatory')
        self.assertEqual('brainstorm', report['recommended'][0]['component'])
        self.assertEqual(['host-governance'], report['recommended'][0]['missing_if_selected'])

    def test_package_review_discovers_custom_workflows_without_claiming_compatibility(self):
        workflow = self.target / 'CustomDesign'
        workflow.mkdir()
        (workflow / 'README.md').write_text('Existing ideation workflow with its own decisions', encoding='utf-8')
        private = workflow / 'sessions'
        private.mkdir()
        (private / 'README.md').write_text('Private session, outside bounded discovery', encoding='utf-8')
        skill = self.target / '.agents/skills/custom-method'
        skill.mkdir(parents=True)
        (skill / 'SKILL.md').write_text('Existing user method', encoding='utf-8')
        before = inventory(self.target)
        report = c.audit(w.catalog(self.bundle), self.target, [], ['brainstorm'])
        self.assertEqual(before, inventory(self.target))
        paths = {item['path'] for item in report['candidates']}
        self.assertIn('CustomDesign/README.md', paths)
        self.assertIn('.agents/skills/custom-method/SKILL.md', paths)
        self.assertNotIn('CustomDesign/sessions/README.md', paths)
        review = report['package_review'][0]
        self.assertEqual(('brainstorm', 'recommended', 'needs-agent-review'),
                         (review['component'], review['selection'], review['assurance']))
        self.assertEqual([], review['existing_providers'], 'Discovery cannot certify a substitute')
        self.assertFalse(report['required'], 'A review reminder is not a required package')

    def test_dependency_ready_does_not_certify_selected_package_interoperability(self):
        (self.target / 'existing-knowledge.md').write_bytes(b'Reviewed query and approved ingestion protocol')
        provider = {'id': 'my-knowledge', 'capabilities': ['knowledge'], 'assurance': 'reviewed',
                    'reason': 'Synthetic capability review, not a package integration decision',
                    'checks': {'knowledge': self.contract['capabilities']['knowledge']['criteria']},
                    'evidence': [{'path': 'existing-knowledge.md', 'sha256': w.digest((self.target / 'existing-knowledge.md').read_bytes())}]}
        self.profile['providers'].append(provider)
        preview = self.install(['knowledge'], False, profile=self.profile)
        self.assertTrue(preview['ready'])
        review = preview['audit']['package_review'][0]
        self.assertEqual('needs-agent-review', review['assurance'])
        self.assertEqual('my-knowledge', review['existing_providers'][0]['provider'])
        self.assertFalse((self.target / w.STATE).exists())
        self.install(['brainstorm'], profile=self.profile)
        added = w.install(self.bundle, self.target, 'add', ['knowledge'], False)
        reviews = {item['component']: item for item in added['audit']['package_review']}
        self.assertTrue(reviews['brainstorm']['installed_baseline'])
        self.assertFalse(reviews['knowledge']['installed_baseline'])
        self.assertEqual('needs-agent-review', reviews['knowledge']['assurance'])

    def test_all_released_business_packages_have_review_prompts(self):
        incoming = w.catalog(ROOT)
        report = c.audit(incoming, self.target, list(incoming['components']))
        self.assertEqual(set(incoming['components']) - {'meta'},
                         {item['component'] for item in report['package_review']})
        self.assertTrue(report['ready'])
        self.assertTrue(all(item['assurance'] == 'needs-agent-review' for item in report['package_review']))

    def test_missing_dependencies_block_all_writes_and_no_implicit_packages(self):
        before = inventory(self.target)
        report = self.install(['brainstorm'])
        self.assertFalse(report['applied'])
        self.assertFalse(report['ready'])
        self.assertEqual(before, inventory(self.target))
        report = self.install([])
        self.assertFalse(report['changes'])
        self.assertEqual(before, inventory(self.target))

    def test_substitute_removes_required_meta_and_preserves_host(self):
        before = {name: (self.target / name).read_bytes() for name in ('AGENTS.md', 'README.md')}
        preview = self.install(['brainstorm'], False, profile=self.profile)
        self.assertTrue(preview['ready'])
        self.assertFalse((self.target / w.STATE).exists())
        report = self.install(['brainstorm'], profile=self.profile)
        self.assertTrue(report['applied'])
        self.assertEqual({'brainstorm'}, set(w.state(self.target)['components']))
        self.assertFalse((self.target / 'modules/meta').exists())
        for name, content in before.items():
            self.assertEqual(content, (self.target / name).read_bytes())
        self.assertIn('existing-host', (self.target / c.BRIDGE).read_text(encoding='utf-8'))
        self.assertFalse(w.install(self.bundle, self.target, 'add', [], True)['changes'])
        report = w.install(self.bundle, self.target, 'add', ['knowledge'], True)
        self.assertTrue(report['applied'])
        self.assertEqual({'brainstorm', 'knowledge'}, set(w.state(self.target)['components']))

    def test_complete_meta_is_scoped_and_optional_packages_stay_optional(self):
        report = self.install(['meta', 'brainstorm'])
        self.assertTrue(report['applied'])
        self.assertEqual(b'Existing workspace home\n', (self.target / 'README.md').read_bytes())
        self.assertEqual(b'meta initial\n', (self.target / 'modules/meta/README.md').read_bytes())
        self.assertFalse((self.target / 'modules/knowledge').exists())
        self.assertFalse((self.target / 'modules/fromdemotospec').exists())
        self.assertTrue(w.rollback(self.target, report['transaction'], True)['applied'])
        self.assertFalse((self.target / w.STATE).exists())

    def test_stale_incomplete_or_escaping_provider_is_rejected(self):
        for mutation in ('stale', 'missing-review', 'incomplete', 'escape'):
            profile = json.loads(json.dumps(self.profile))
            item = profile['providers'][0]
            if mutation == 'stale': item['evidence'][0]['sha256'] = '0' * 64
            if mutation == 'missing-review': item['assurance'] = 'candidate-only'
            if mutation == 'incomplete': item['checks']['host-governance'] = ['scope-and-data']
            if mutation == 'escape': item['evidence'][0]['path'] = '../outside.md'
            before = inventory(self.target)
            with self.subTest(mutation=mutation), self.assertRaises(w.ContractError):
                self.install(['brainstorm'], profile=profile)
            self.assertEqual(before, inventory(self.target))

    def test_existing_business_provider_is_recommended_for_reuse(self):
        (self.target / 'existing-knowledge.md').write_bytes(b'Reviewed query and approved ingestion protocol')
        provider = {'id': 'my-knowledge', 'capabilities': ['knowledge'], 'assurance': 'reviewed', 'reason': 'Synthetic compatible query/ingest review', 'checks': {'knowledge': self.contract['capabilities']['knowledge']['criteria']}, 'evidence': [{'path': 'existing-knowledge.md', 'sha256': w.digest((self.target / 'existing-knowledge.md').read_bytes())}]}
        self.profile['providers'].append(provider)
        report = c.audit(w.catalog(self.bundle), self.target, [], ['knowledge'], self.profile)
        self.assertFalse(report['recommended'])
        self.assertEqual('my-knowledge', report['reuse'][0]['providers'][0]['provider'])

    def test_upgrade_persists_mode_and_provider_and_preserves_local_data(self):
        self.install(['brainstorm'], profile=self.profile)
        next_bundle = self.base / 'next'
        fixture(next_bundle, '1.3.0', '1.2.0')
        self.seal(next_bundle)
        (self.target / 'modules/brainstorm/user.txt').write_bytes(b'user session')
        report = w.install(next_bundle, self.target, 'upgrade', [], True)
        self.assertTrue(report['applied'])
        self.assertEqual('compatible', w.state(self.target)['mode'])
        self.assertEqual(b'user session', (self.target / 'modules/brainstorm/user.txt').read_bytes())
        self.assertTrue(w.rollback(self.target, report['transaction'], True)['applied'])
        self.assertEqual('1.2.0', w.state(self.target)['version'])
        (self.target / 'AGENTS.md').write_bytes(b'Changed host rules need re-review')
        before = inventory(self.target)
        with self.assertRaises(w.ContractError):
            w.install(next_bundle, self.target, 'upgrade', [], True)
        self.assertEqual(before, inventory(self.target))

    def test_conflict_and_failure_leave_existing_host_intact(self):
        (self.target / c.BRIDGE).write_bytes(b'Existing unrelated file')
        before = inventory(self.target)
        report = self.install(['meta'])
        self.assertIn(c.BRIDGE, report['conflicts'])
        self.assertEqual(before, inventory(self.target))
        (self.target / c.BRIDGE).unlink()
        with self.assertRaises(OSError):
            self.install(['meta'], fail_after=1)
        self.assertFalse((self.target / w.STATE).exists())
        self.assertEqual(b'Existing workspace home\n', (self.target / 'README.md').read_bytes())

    def test_mode_switch_and_legacy_adoption_are_rejected(self):
        self.install(['meta'])
        with self.assertRaises(w.ContractError):
            w.install(self.bundle, self.target, 'add', [], True, mode='full')
        with self.assertRaises(w.ContractError):
            w.adopt(self.bundle, self.target, ['knowledge'], True)

    def test_changed_dependency_contract_is_rejected(self):
        (self.bundle / 'compatibility.json').write_bytes(w.encoded({'schema_version': 1}))
        with self.assertRaises(w.ContractError):
            self.install(['meta'])

    def test_distribution_inside_host_is_allowed_only_without_destination_overlap(self):
        import shutil
        nested = self.target / 'tools/distribution'
        shutil.copytree(self.bundle, nested)
        before = inventory(nested)
        report = w.install(nested, self.target, 'init', ['brainstorm'], True, mode='compatible', profile=self.profile)
        self.assertTrue(report['applied'])
        self.assertEqual(before, inventory(nested))
        self.assertTrue(w.rollback(self.target, report['transaction'], True)['applied'])
        overlap = self.target / 'modules/meta/distribution'
        shutil.copytree(self.bundle, overlap)
        before = inventory(self.target)
        with self.assertRaises(w.ContractError):
            w.install(overlap, self.target, 'init', ['meta'], True, mode='compatible')
        self.assertEqual(before, inventory(self.target))

    def test_cli_audit_exit_codes_and_profile(self):
        profile = self.base / 'profile.json'
        profile.write_bytes(w.encoded(self.profile))
        command = [sys.executable, '-B', ROOT / 'scripts/workspace.py', 'audit', '--bundle', self.bundle, '--target', self.target, '--packages', 'brainstorm']
        blocked = subprocess.run(command, capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(2, blocked.returncode, blocked.stderr)
        valid = subprocess.run(command + ['--profile', profile], capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(0, valid.returncode, valid.stderr)
        self.assertEqual([], json.loads(valid.stdout)['required'])
        readonly = subprocess.run(command + ['--apply'], capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(3, readonly.returncode)


if __name__ == '__main__':
    unittest.main(verbosity=2)
