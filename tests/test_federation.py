"""Selective source retrieval, old transaction compatibility and existing module reuse."""
import copy
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import workspace as w
import federation as f
import module_manager
from test_module_manager import fixture, commit_fixture, seal


class Federation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.mirror = self.base / 'mirror'
        self.bundle = self.base / 'bundle'
        self.bundle.mkdir()
        original = json.loads((ROOT / 'compatibility.json').read_text('utf8'))
        definitions = copy.deepcopy(original)
        definitions['components'] = {name: definitions['components'][name] for name in ['meta', 'travel', 'research']}
        for value in definitions['components'].values():
            value['requires'] = []
        self.catalog = {'schema_version': 2, 'version': '2.0.0', 'previous_version': '1.30.0',
                        'compatibility': definitions, 'components': {}}
        for name in definitions['components']:
            source = fixture(self.mirror / name, name)
            if name == 'meta':
                (source / 'workspace').mkdir()
                (source / 'workspace/AGENTS.md').write_bytes(b'META AUTHORITY\n')
                (source / 'workspace/README.md').write_bytes(b'META README\n')
                seal(source, name)
            commit_fixture(source)
            prefix = 'meta' if name == 'meta' else 'packages/' + name
            payload = prefix + '/workspace' if name == 'meta' else prefix
            value = module_manager.manifest(source)
            row = {'version': '2.0.0', 'module_source': prefix, 'source': payload,
                   'destination': '' if name == 'meta' else 'modules/' + name,
                   'repository': value['repository'], 'revision': f.git(source, 'rev-parse', 'HEAD'),
                   'module_manifest_sha256': w.digest((source / 'module.json').read_bytes()),
                   'module_inventory_sha256': w.digest((source / 'module-files.json').read_bytes()),
                   'files': f.payload_inventory(source / 'workspace' if name == 'meta' else source),
                   'provides': definitions['components'][name]['provides'], 'required': [], 'optional': []}
            self.catalog['components'][name] = row
        (self.bundle / 'compatibility.json').write_bytes(w.encoded(definitions))
        (self.bundle / 'catalog.json').write_bytes(w.encoded(self.catalog))

    def retrieve(self, *names):
        return f.prepare(self.bundle, self.catalog, names, apply=True, source_root=self.mirror)

    def test_metadata_audit_and_preview_work_without_payloads(self):
        incoming = w.catalog(self.bundle)
        self.assertEqual('2.0.0', incoming['version'])
        target = self.base / 'workspace'
        preview = w.install(self.bundle, target, 'init', ['travel'], mode='compatible')
        self.assertEqual(['travel'], preview['download'])
        self.assertFalse(target.exists())
        from compatibility import audit
        result = audit(incoming, target, ['travel'])
        self.assertTrue(result['ready'])
        self.assertTrue(result['package_review'])
        self.assertFalse((self.bundle / 'packages').exists())

    def test_selective_retrieval_independent_install_and_reverse(self):
        self.retrieve('travel')
        self.assertTrue((self.bundle / 'packages/travel/module.json').is_file())
        self.assertFalse((self.bundle / 'packages/research').exists())
        self.assertFalse((self.bundle / 'meta').exists())
        target = self.base / 'workspace'
        target.mkdir()
        (target / 'AGENTS.md').write_bytes(b'OWNED HOST')
        result = w.install(self.bundle, target, 'init', ['travel'], apply=True, mode='compatible')
        self.assertTrue(result['applied'])
        self.assertEqual(b'OWNED HOST', (target / 'AGENTS.md').read_bytes())
        self.assertEqual({'travel': '2.0.0'}, w.state(target)['components'])
        module_manager.verify(target / 'modules/travel')
        canary = target / 'private-trip.txt'
        canary.write_bytes(b'PRIVATE')
        self.assertTrue(w.rollback(target, result['transaction'], apply=True)['applied'])
        self.assertIsNone(w.state(target))
        self.assertEqual(b'PRIVATE', canary.read_bytes())

    def test_all_is_explicit_and_full_meta_uses_existing_transaction_engine(self):
        self.retrieve(*self.catalog['components'])
        target = self.base / 'workspace'
        result = w.install(self.bundle, target, 'init', ['travel', 'research'], apply=True)
        self.assertTrue(result['applied'])
        self.assertEqual(b'META AUTHORITY\n', (target / 'AGENTS.md').read_bytes())
        self.assertEqual(set(self.catalog['components']), set(w.state(target)['components']))
        modified = target / 'modules/travel/README.md'
        modified.write_bytes(b'OWNER EDIT')
        self.assertIn('modules/travel/README.md', w.rollback(target, result['transaction'])['conflicts'])
        self.assertEqual(b'OWNER EDIT', modified.read_bytes())

    def test_existing_standalone_module_is_reused_without_copy_or_takeover(self):
        self.retrieve('travel')
        target = self.base / 'workspace'
        existing = target / 'my-travel'
        target.mkdir()
        f.git(target, 'clone', '--', str(self.mirror / 'travel'), str(existing))
        before = f.git(existing, 'rev-parse', 'HEAD')
        result = w.install(self.bundle, target, 'init', ['travel'], apply=True, mode='compatible')
        self.assertTrue(result['applied'])
        state = w.state(target)
        self.assertEqual('my-travel', state['external_modules']['travel']['path'])
        self.assertFalse((target / 'modules/travel').exists())
        self.assertFalse(any(n.startswith('my-travel/') for n in state['files']))
        self.assertIn('my-travel/README.md', (target / 'agent-workspace-compatibility.md').read_text('utf8'))
        self.assertTrue(w.rollback(target, result['transaction'], apply=True)['applied'])
        self.assertEqual(before, f.git(existing, 'rev-parse', 'HEAD'))
        module_manager.verify(existing)

    def test_existing_modified_module_and_tampered_source_are_refused(self):
        self.retrieve('travel')
        target = self.base / 'workspace'
        target.mkdir()
        f.git(target, 'clone', '--', str(self.mirror / 'travel'), str(target / 'travel'))
        (target / 'travel/README.md').write_bytes(b'USER')
        result = w.install(self.bundle, target, 'init', ['travel'], apply=True, mode='compatible')
        self.assertTrue(result['conflicts'])
        self.assertEqual(b'USER', (target / 'travel/README.md').read_bytes())
        self.assertFalse((target / w.STATE).exists())
        (self.bundle / 'packages/travel/README.md').write_bytes(b'TAMPER')
        with self.assertRaises(w.ContractError):
            f.verify_module(self.bundle, self.catalog['components']['travel'], 'travel')

    def test_manifest_path_and_commit_lock_refuse_substitution(self):
        self.retrieve('travel')
        row = self.catalog['components']['travel']
        broken = copy.deepcopy(row)
        broken['revision'] = '0' * 40
        with self.assertRaises(w.ContractError):
            f.verify_module(self.bundle, broken, 'travel')
        self.catalog['components']['travel']['source'] = '../escape'
        (self.bundle / 'catalog.json').write_bytes(w.encoded(self.catalog))
        with self.assertRaises(w.ContractError):
            w.catalog(self.bundle)

    def test_failed_transaction_recovers_all_owned_files(self):
        self.retrieve('travel')
        target = self.base / 'workspace'
        target.mkdir()
        (target / 'private.txt').write_bytes(b'PRIVATE')
        with self.assertRaises(OSError):
            w.install(self.bundle, target, 'init', ['travel'], apply=True, mode='compatible', fail_after=2)
        self.assertFalse((target / w.STATE).exists())
        self.assertEqual(b'PRIVATE', (target / 'private.txt').read_bytes())
        self.assertFalse((target / '.agent-workspace/install.lock').exists())

    def test_one_module_can_upgrade_without_advancing_the_aggregate_version(self):
        self.retrieve('travel')
        target = self.base / 'workspace'
        initial = w.install(self.bundle, target, 'init', ['travel'], apply=True, mode='compatible')
        self.assertTrue(initial['applied'])
        (target / 'modules/travel/README.md').write_bytes(b'OWNER EDIT')
        source = self.bundle / 'packages/travel'
        metadata = module_manager.manifest(source)
        metadata['version'] = '2.0.1'
        (source / 'module.json').write_bytes(w.encoded(metadata))
        record = {'schema_version': 1, 'id': 'travel', 'version': '2.0.1', 'files': module_manager.inventory(source)}
        (source / 'module-files.json').write_bytes(w.encoded(record))
        f.git(source, 'add', '--', 'module.json', 'module-files.json')
        f.git(source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'patch fixture')
        row = self.catalog['components']['travel']
        row.update(version='2.0.1', revision=f.git(source, 'rev-parse', 'HEAD'),
                   module_manifest_sha256=w.digest((source / 'module.json').read_bytes()),
                   module_inventory_sha256=w.digest((source / 'module-files.json').read_bytes()),
                   files=f.payload_inventory(source))
        (self.bundle / 'catalog.json').write_bytes(w.encoded(self.catalog))
        result = w.install(self.bundle, target, 'upgrade', [], apply=True)
        self.assertTrue(result['applied'])
        self.assertEqual('2.0.0', w.state(target)['version'])
        self.assertEqual({'travel': '2.0.1'}, w.state(target)['components'])
        self.assertEqual(b'OWNER EDIT', (target / 'modules/travel/README.md').read_bytes())
        self.assertFalse((self.bundle / 'meta').exists())
        metadata['name'] = 'Changed without version bump'
        (source / 'module.json').write_bytes(w.encoded(metadata))
        record['files'] = module_manager.inventory(source)
        (source / 'module-files.json').write_bytes(w.encoded(record))
        f.git(source, 'add', '--', 'module.json', 'module-files.json')
        f.git(source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'mutation fixture')
        row.update(revision=f.git(source, 'rev-parse', 'HEAD'),
                   module_manifest_sha256=w.digest((source / 'module.json').read_bytes()),
                   module_inventory_sha256=w.digest((source / 'module-files.json').read_bytes()), files=f.payload_inventory(source))
        (self.bundle / 'catalog.json').write_bytes(w.encoded(self.catalog))
        with self.assertRaisesRegex(w.ContractError, 'changed in place'):
            w.install(self.bundle, target, 'upgrade', [], apply=True)

    def test_explicit_verify_of_an_absent_module_is_not_a_payload_pass(self):
        result = subprocess.run([sys.executable, '-B', ROOT / 'scripts/workspace.py', 'verify', '--bundle', self.bundle,
                                 '--packages', 'travel'], capture_output=True, text=True, encoding='utf8')
        self.assertEqual(2, result.returncode, result.stderr)
        report = json.loads(result.stdout)
        self.assertTrue(report['metadata_verified'])
        self.assertFalse(report['verified'])
        self.assertEqual(['travel'], report['not_downloaded'])
        self.assertFalse(f.prepare(self.bundle, self.catalog, [], apply=True)['applied'])
        self.assertFalse((self.bundle / '.module-manager').exists())


if __name__ == '__main__':
    unittest.main()
