"""Current independent modules and actual preceding-release migration."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import workspace as w
import federation as f
import module_manager
import module_docs
from release_history import published_bundle


class IndependentRelease(unittest.TestCase):
    def command(self, *args, cwd=None, ok=True):
        result = subprocess.run(list(map(str, args)), cwd=cwd, capture_output=True, text=True, encoding='utf8', errors='replace', timeout=300)
        if ok:
            self.assertEqual(0, result.returncode, (result.stdout + result.stderr)[-4000:])
        else:
            self.assertNotEqual(0, result.returncode)
        return result.stdout

    def test_all_twelve_independent_inventories_and_fixed_references(self):
        incoming = w.catalog(ROOT)
        self.assertEqual(2, incoming['schema_version'])
        self.assertEqual('2.1.0', incoming['version'])
        self.assertEqual(12, len(incoming['components']))
        for name, row in incoming['components'].items():
            with self.subTest(name=name):
                self.assertEqual([], row['required'])
                self.assertTrue(f.verify_module(ROOT, row, name)['verified'])
                module = ROOT / row['module_source']
                metadata = module_manager.manifest(module)
                for file, expected in metadata['manager']['files'].items():
                    self.assertEqual(expected, w.digest((module / '.module' / file).read_bytes()))
                for filename in ('README.md', 'README.en.md'):
                    module_docs.replace(module / filename, module_docs.block({name: metadata}, name), check=True)
        self.assertTrue(all('AWS-' in row['repository'] for row in incoming['components'].values()))

    def test_each_module_installs_without_other_modules_or_meta(self):
        incoming = w.catalog(ROOT)
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            for name in incoming['components']:
                with self.subTest(name=name):
                    target = base / name
                    target.mkdir()
                    authority = target / 'AGENTS.md'
                    authority.write_bytes(b'EXISTING HOST AUTHORITY')
                    result = w.install(ROOT, target, 'init', [name], apply=True, mode='compatible')
                    self.assertTrue(result['applied'])
                    self.assertEqual({name: incoming['components'][name]['version']}, w.state(target)['components'])
                    self.assertEqual(b'EXISTING HOST AUTHORITY', authority.read_bytes())
                    self.assertFalse((target / 'modules/meta').exists() if name != 'meta' else False)
                    if name != 'meta':
                        module_manager.verify(target / 'modules' / name)

    def test_travel_runs_from_its_own_repository_with_external_trip(self):
        module = ROOT / 'packages/travel'
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory) / 'trip'
            self.command('node', module / 'scripts/make-demo.mjs', '--project', project)
            self.command('node', module / 'scripts/travel.mjs', 'build', '--project', project)
            self.command('node', module / 'scripts/travel.mjs', 'validate', '--project', project)
            self.assertTrue((project / 'build/index.html').is_file())
            self.assertFalse((project / 'modules/meta').exists())

    def test_skills_selects_both_clients_on_a_plain_host(self):
        module = ROOT / 'packages/skills'
        with tempfile.TemporaryDirectory() as directory:
            host = Path(directory)
            for platform in ('codex', 'codebuddy'):
                output = self.command(sys.executable, '-B', module / 'scripts/skills.py', 'install', '--target', host,
                                      '--platform', platform, '--names', 'task-tooling', 'research-collection', '--apply')
                self.assertTrue(json.loads(output)['applied'])
                prefix = '.agents' if platform == 'codex' else '.codebuddy'
                self.assertTrue((host / prefix / 'skills/task-tooling/SKILL.md').is_file())
            self.assertFalse((host / '.agent-workspace/state.json').exists())

    def test_game_project_creator_runs_from_its_own_repository(self):
        module = ROOT / 'packages/game-project'
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'game'
            self.command(sys.executable, '-B', module / 'scripts/create-project.py', '--target', target,
                         '--name', 'Independent Fixture', '--id', 'independent-fixture', '--apply')
            self.assertTrue((target / 'AGENTS.md').is_file())
            config = json.loads((target / 'maintenance/project-config.json').read_text('utf8'))
            self.assertEqual('independent-fixture', config['project']['id'])
            self.assertEqual('0.2.21', config['template']['version'])
            self.assertTrue((target / 'assets/index.html').is_file())
            self.assertFalse((target / 'modules/meta').exists())

    def test_real_previous_full_and_compatible_upgrade_conflict_client_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            previous = published_bundle(ROOT, '2.0.0', base / 'previous')
            self.assertEqual('2.0.0', w.catalog(previous)['version'])
            all_modules = [name for name in w.catalog(ROOT)['components'] if name != 'meta']
            for mode in ('full', 'compatible'):
                with self.subTest(mode=mode):
                    host = base / mode
                    host.mkdir()
                    if mode == 'compatible':
                        (host / 'AGENTS.md').write_bytes(b'EXISTING HOST')
                    packages = all_modules + (['meta'] if mode == 'compatible' else [])
                    initial = w.install(previous, host, 'init', packages, apply=True, mode=mode)
                    self.assertTrue(initial['applied'])
                    authority = (host / 'AGENTS.md').read_bytes()
                    private = host / 'private/trip.txt'
                    private.parent.mkdir()
                    private.write_bytes(b'PRIVATE TRIP FACTS')
                    project = host / 'projects/old-game/keep.txt'
                    project.parent.mkdir(parents=True)
                    project.write_bytes(b'INDEPENDENT PROJECT')
                    for platform in ('codex', 'codebuddy'):
                        self.command(sys.executable, '-B', host / 'modules/skills/scripts/skills.py', 'install', '--target', host,
                                     '--platform', platform, '--names', 'human-research-expression', '--apply')
                    edited = host / 'modules/skills/README.md'
                    original = edited.read_bytes()
                    edited.write_bytes(original + b'\nOWNER EDIT')
                    denied = w.install(ROOT, host, 'upgrade', [], apply=True)
                    self.assertTrue(denied['conflicts'])
                    self.assertEqual(original + b'\nOWNER EDIT', edited.read_bytes())
                    edited.write_bytes(original)
                    upgraded = w.install(ROOT, host, 'upgrade', [], apply=True)
                    self.assertTrue(upgraded['applied'])
                    self.assertEqual('2.1.0', w.state(host)['version'])
                    if mode == 'compatible':
                        self.assertEqual(authority, (host / 'AGENTS.md').read_bytes())
                    client_transactions = []
                    for platform in ('codex', 'codebuddy'):
                        output = self.command(sys.executable, '-B', host / 'modules/skills/scripts/skills.py', 'upgrade', '--target', host,
                                              '--platform', platform, '--apply')
                        item = json.loads(output)
                        self.assertTrue(item['applied'])
                        client_transactions.append((platform, item['transaction']))
                    for platform, transaction in reversed(client_transactions):
                        self.command(sys.executable, '-B', host / 'modules/skills/scripts/skills.py', 'rollback', '--target', host,
                                     '--platform', platform, '--transaction', transaction, '--apply')
                    self.assertTrue(w.rollback(host, upgraded['transaction'], apply=True)['applied'])
                    self.assertEqual('2.0.0', w.state(host)['version'])
                    self.assertEqual(authority, (host / 'AGENTS.md').read_bytes())
                    self.assertEqual(b'PRIVATE TRIP FACTS', private.read_bytes())
                    self.assertEqual(b'INDEPENDENT PROJECT', project.read_bytes())


if __name__ == '__main__':
    unittest.main()
