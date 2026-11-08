"""Standalone retrieval and ownership guards, with local Git fixtures."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import module_manager as manager
import module_docs


def descriptor(name):
    return {'schema_version': 1, 'id': name, 'name': name.title(), 'version': '2.0.0',
            'repository': 'https://github.com/example/AWS-' + name.title() + '.git'}


def fixture(root, name, related=()):
    root.mkdir(parents=True)
    value = {**descriptor(name), 'related': [descriptor(peer) for peer in related]}
    (root / 'module.json').write_bytes(manager.encoded(value))
    (root / 'README.md').write_bytes(b'# Fixture\n')
    seal(root, name)
    return root


def seal(root, name):
    record = {'schema_version': 1, 'id': name, 'version': '2.0.0', 'files': manager.inventory(root)}
    (root / 'module-files.json').write_bytes(manager.encoded(record))


def commit_fixture(root):
    for args in [('init', '-b', 'main'), ('add', '.'),
                 ('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture'),
                 ('tag', 'v2.0.0')]:
        process = subprocess.run(['git', '-c', 'safe.directory=' + str(root), '-C', str(root), *args], capture_output=True)
        if process.returncode:
            raise AssertionError(process.stderr.decode('utf8', 'replace'))


class ModuleManager(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = fixture(self.base / 'travel', 'travel', ['research'])

    def test_inventory_rejects_changed_missing_extra_and_mismatched_identity(self):
        manager.verify(self.root)
        readme = self.root / 'README.md'
        original = readme.read_bytes()
        for mutate in [lambda: readme.write_bytes(b'edit'), lambda: readme.unlink(),
                       lambda: (self.root / 'extra.txt').write_bytes(b'extra')]:
            mutate()
            with self.assertRaises(manager.ModuleError):
                manager.verify(self.root)
            readme.write_bytes(original)
            (self.root / 'extra.txt').unlink(missing_ok=True)
        value = json.loads((self.root / 'module-files.json').read_text('utf8'))
        value['id'] = 'other'
        (self.root / 'module-files.json').write_bytes(manager.encoded(value))
        with self.assertRaises(manager.ModuleError):
            manager.verify(self.root)

    def test_preview_is_read_only_and_existing_directory_is_preserved(self):
        target = self.base / 'workspace'
        report = manager.fetch(self.root, target, ['research'])
        self.assertFalse(target.exists())
        self.assertFalse(report['applied'])
        existing = target / 'modules/research'
        existing.mkdir(parents=True)
        canary = existing / 'user.txt'
        canary.write_bytes(b'owned')
        report = manager.fetch(self.root, target, ['research'], apply=True)
        self.assertTrue(report['conflicts'])
        self.assertEqual(b'owned', canary.read_bytes())
        self.assertFalse((target / '.module-manager').exists())

    def test_standalone_peer_fetch_and_verified_reuse_without_aws_or_meta(self):
        mirror = self.base / 'mirror'
        research = fixture(mirror / 'research', 'research')
        commit_fixture(research)
        target = self.base / 'workspace'
        result = manager.fetch(self.root, target, ['research'], apply=True, source_root=mirror)
        self.assertTrue(result['applied'])
        installed = target / 'modules/research'
        self.assertTrue((installed / '.git').exists())
        self.assertEqual('research', manager.verify(installed)['id'])
        receipt = json.loads((target / '.module-manager/transactions' / (result['transaction'] + '.json')).read_text('utf8'))
        self.assertEqual('complete', receipt['status'])
        again = manager.fetch(self.root, target, ['research'], apply=True)
        self.assertEqual([], again['fetch'])
        self.assertEqual('verified-module-baseline', again['reuse'][0]['assurance'])
        (installed / 'README.md').write_bytes(b'owner edit')
        conflict = manager.fetch(self.root, target, ['research'], apply=True)
        self.assertTrue(conflict['conflicts'])
        self.assertEqual(b'owner edit', (installed / 'README.md').read_bytes())

    def test_unknown_peer_invalid_paths_and_concurrent_owner_are_refused(self):
        for value in ['../escape', '/absolute', 'C:/escape', 'a\\b', 'CON', 'a//b']:
            with self.assertRaises(manager.ModuleError):
                manager.safe(self.base, value)
        with self.assertRaises(manager.ModuleError):
            manager.plan(self.root, self.base / 'workspace', ['other'])
        target = self.base / 'workspace'
        with manager.lock(target):
            with self.assertRaises(manager.ModuleError):
                manager.fetch(self.root, target, ['research'], apply=True)
        self.assertFalse((target / '.module-manager/install.lock').exists())

    def test_failed_retrieval_preserves_receipt_and_leaves_destination_absent(self):
        target = self.base / 'workspace'
        with self.assertRaises(manager.ModuleError):
            manager.fetch(self.root, target, ['research'], apply=True, source_root=self.base / 'missing')
        receipts = list((target / '.module-manager/transactions').glob('*.json'))
        self.assertEqual(1, len(receipts))
        self.assertEqual('failed-with-preserved-state', json.loads(receipts[0].read_text('utf8'))['status'])
        self.assertFalse((target / 'modules/research').exists())

    def test_panorama_generation_and_staleness_check(self):
        value = manager.manifest(self.root)
        rendered = module_docs.block({'travel': value}, 'travel')
        self.assertIn('travel -.-> research', rendered)
        path = self.base / 'README.md'
        path.write_text('Header\n' + module_docs.START + '\n' + module_docs.END + '\nFooter\n', encoding='utf8')
        module_docs.replace(path, rendered)
        module_docs.replace(path, rendered, check=True)
        self.assertIn('Footer', path.read_text('utf8'))
        with self.assertRaises(ValueError):
            module_docs.replace(path, rendered.replace('Research', 'Changed'), check=True)

    def test_author_seal_requires_explicitly_tracked_files(self):
        commit_fixture(self.root)
        (self.root / 'README.md').write_bytes(b'REVIEWED EDIT\n')
        before = (self.root / 'module-files.json').read_bytes()
        self.assertFalse(manager.seal(self.root)['applied'])
        self.assertEqual(before, (self.root / 'module-files.json').read_bytes())
        self.assertTrue(manager.seal(self.root, apply=True)['applied'])
        manager.verify(self.root)
        (self.root / 'private.txt').write_bytes(b'NOT STAGED')
        with self.assertRaises(manager.ModuleError):
            manager.seal(self.root, apply=True)
        self.assertEqual(b'NOT STAGED', (self.root / 'private.txt').read_bytes())


if __name__ == '__main__':
    unittest.main()
