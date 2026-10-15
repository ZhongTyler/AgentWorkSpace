"""GameProject independent use, semantic reuse, publication guards and real recovery."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import workspace as w
import compatibility as c
from publish import stage
from release_history import published_bundle


def creator(package):
    spec = importlib.util.spec_from_file_location('public_project_creator', package / 'scripts/create-project.py')
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class GameProjectRelease(unittest.TestCase):
    def test_independent_install_and_existing_equivalent_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            host = Path(tmp) / 'host'
            host.mkdir()
            rules = host / 'AGENTS.md'
            rules.write_bytes(b'EXISTING HOST AUTHORITY')
            existing = host / 'MyGame/README.md'
            existing.parent.mkdir()
            existing.write_bytes(b'EXISTING PROJECT WORKFLOW')
            cat = w.catalog(ROOT)
            audit = c.audit(cat, host, [], ['game-project'])
            self.assertEqual(['game-project'], [r['component'] for r in audit['recommended']])
            review = audit['package_review'][0]
            self.assertEqual('needs-agent-review', review['assurance'])
            self.assertIn('MyGame/README.md', [p['path'] for p in audit['candidates']])
            capability = 'game-project-workspace'
            profile = {'schema_version': 1, 'providers': [{'id': 'existing-project-workflow', 'capabilities': [capability],
                'assurance': 'reviewed', 'reason': 'Synthetic reviewed-provider fixture, not a real project acceptance',
                'checks': {capability: cat['compatibility']['capabilities'][capability]['criteria']},
                'evidence': [{'path': 'AGENTS.md', 'sha256': w.digest(rules.read_bytes())}]}]}
            self.assertEqual([], c.audit(cat, host, [], ['game-project'], profile)['recommended'])
            result = w.install(ROOT, host, 'init', ['game-project'], True, mode='compatible')
            self.assertTrue(result['applied'])
            self.assertEqual({'game-project'}, set(w.state(host)['components']))
            self.assertEqual(b'EXISTING HOST AUTHORITY', rules.read_bytes())
            self.assertEqual(b'EXISTING PROJECT WORKFLOW', existing.read_bytes())
            self.assertFalse((host / '.codex').exists())

    def test_pinned_inventory_and_no_game_or_private_source(self):
        package = ROOT / 'packages/game-project'
        inventory = json.loads((package / 'template-inventory.json').read_text(encoding='utf-8'))
        for name, sha in inventory['files'].items():
            self.assertEqual(sha, w.digest((package / 'template' / name).read_bytes()))
            self.assertFalse({'plans', '.git', '.godot', 'private', 'demo'} & set(Path(name).parts))
        self.assertFalse((package / 'plans').exists())
        self.assertFalse(list(package.rglob('project.godot')))
        config = json.loads((package / 'template/maintenance/project-config.json').read_text(encoding='utf-8'))
        self.assertEqual('0.2.5', config['template']['version'])
        self.assertEqual('not_initialized', config['engine']['state'])
        for path in package.rglob('*.md'):
            text = path.read_text(encoding='utf-8')
            self.assertNotIn('F2S', text)
            self.assertNotIn('E:/TylerWorkSpace', text)

    def test_publisher_rejects_private_inputs_and_changed_public_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'source'
            (source / 'release-input/curated').mkdir(parents=True)
            output = Path(tmp) / 'output'
            output.mkdir()
            manifest = {'release_schema': 1, 'component_id': 'game-project', 'output_path': 'packages/game-project',
                'expected_file_count_without_marker': 1,
                'copy_files': [{'source': 'plans/private.md', 'target': 'template/README.md', 'sha256': '0' * 64}]}
            path = source / 'release-input/manifest.json'
            path.write_text(json.dumps(manifest))
            with patch('publish.git') as git:
                with self.assertRaises(w.ContractError):
                    stage(source, output)
                git.assert_not_called()
            manifest['copy_files'][0].update(source='release-input/curated/README.md', target='README.md')
            path.write_text(json.dumps(manifest))
            (source / 'release-input/curated/README.md').write_bytes(b'CHANGED')
            with patch('publish.git') as git:
                with self.assertRaises(w.ContractError):
                    stage(source, output)
                git.assert_not_called()

    def test_actual_predecessor_add_conflict_and_reverse_keep_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            previous = w.catalog(ROOT)['previous_version']
            old = published_bundle(ROOT, previous, base / 'previous')
            for mode in ('full', 'compatible'):
                host = base / mode
                host.mkdir()
                if mode == 'compatible':
                    (host / 'AGENTS.md').write_bytes(b'OWN HOST RULES')
                args = [sys.executable, '-X', 'utf8', '-B', str(old / 'scripts/workspace.py'), 'init', '--target', str(host), '--packages', 'skills', '--apply']
                if mode == 'compatible':
                    args += ['--mode', mode]
                result = subprocess.run(args, capture_output=True)
                self.assertEqual(0, result.returncode, result.stderr)
                protected = {host / 'AGENTS.md': (host / 'AGENTS.md').read_bytes(),
                    host / 'notes/private.md': b'PRIVATE NOTES', host / 'tools/external/runtime.txt': b'OWN RUNTIME'}
                for path, data in protected.items():
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
                up = w.install(ROOT, host, 'upgrade', [], True)
                self.assertTrue(up['applied'])
                self.assertFalse((host / 'modules/game-project').exists())
                added = w.install(ROOT, host, 'add', ['game-project'], True)
                self.assertTrue(added['applied'])
                package = host / 'modules/game-project'
                project = host / 'projects/my-game'
                creator(package).create(project, 'My Game', 'my-game', 'Engine', True)
                note = project / 'docs/product/user-design.md'
                note.write_bytes(b'PROJECT OWNED DESIGN')
                custom = package / 'README.md'
                before = custom.read_bytes()
                custom.write_bytes(b'LOCAL LIBRARY EDIT')
                refused = w.rollback(host, added['transaction'], True)
                self.assertFalse(refused['applied'])
                self.assertIn('modules/game-project/README.md', refused['conflicts'])
                self.assertEqual(b'LOCAL LIBRARY EDIT', custom.read_bytes())
                custom.write_bytes(before)
                self.assertTrue(w.rollback(host, added['transaction'], True)['applied'])
                self.assertTrue(w.rollback(host, up['transaction'], True)['applied'])
                self.assertEqual(previous, w.state(host)['version'])
                self.assertFalse((package / 'README.md').exists())
                self.assertFalse((package / 'scripts/create-project.py').exists())
                self.assertEqual(b'PROJECT OWNED DESIGN', note.read_bytes())
                check = subprocess.run(['node', str(project / 'maintenance/scripts/health-check.mjs'), str(project)], capture_output=True)
                self.assertEqual(0, check.returncode, check.stdout + check.stderr)
                for path, data in protected.items():
                    self.assertEqual(data, path.read_bytes())


if __name__ == '__main__':
    unittest.main()
