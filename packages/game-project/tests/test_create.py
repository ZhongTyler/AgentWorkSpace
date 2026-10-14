import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('create_project', ROOT / 'scripts/create-project.py')
creator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(creator)


class ProjectCreation(unittest.TestCase):
    def test_preview_then_independent_custom_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            target = base / 'projects/new-game'
            report = creator.create(target, '新游戏 "Alpha"', 'new-game', 'Engine')
            self.assertFalse(report['applied'])
            self.assertFalse(target.parent.exists())
            self.assertTrue(creator.create(target, '新游戏 "Alpha"', 'new-game', 'Engine', True)['applied'])
            self.assertFalse((target / 'Game').exists())
            self.assertTrue((target / 'Engine/README.md').exists())
            self.assertFalse((target / 'Engine/project.godot').exists())
            self.assertFalse((target / 'demo').exists())
            self.assertFalse((target / '.git').exists())
            import json
            config = json.loads((target / 'maintenance/project-config.json').read_text(encoding='utf-8'))
            self.assertEqual('新游戏 "Alpha"', config['project']['name'])
            self.assertEqual('not_initialized', config['engine']['state'])
            self.assertIsNone(config['assets']['workflow_contract'])
            self.assertEqual([], config['engine']['target_platforms'])
            result = subprocess.run(['node', str(target / 'maintenance/scripts/health-check.mjs'), str(target)], capture_output=True, text=True, encoding='utf-8', errors='replace')
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            self.assertIn('decision reception empty', result.stderr)

    def test_existing_and_managed_targets_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            existing = base / 'existing'
            existing.mkdir()
            (existing / 'README.md').write_bytes(b'USER PROJECT')
            with self.assertRaises(ValueError):
                creator.create(existing, 'Game', 'game', apply=True)
            self.assertEqual(b'USER PROJECT', (existing / 'README.md').read_bytes())
            for target in (base / 'modules/game', ROOT / 'template/new-game', base / '.agent-workspace/game'):
                with self.assertRaises(ValueError):
                    creator.create(target, 'Game', 'game', apply=True)
                self.assertFalse(target.exists())
            for engine in ('../Game', 'docs', 'NUL', 'COM1'):
                with self.assertRaises(ValueError):
                    creator.create(base / 'new-game', 'Game', 'game', engine, True)

    def test_tampered_template_rejected_and_unlisted_files_not_copied(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            bundle = base / 'bundle'
            shutil.copytree(ROOT / 'template', bundle / 'template')
            inventory = ROOT / 'template-inventory.json'
            if not inventory.exists():
                inventory = ROOT / 'release-input/curated/template-inventory.json'
            shutil.copyfile(inventory, bundle / 'template-inventory.json')
            (bundle / 'template/private.txt').write_bytes(b'PRIVATE')
            target = base / 'project'
            creator.create(target, 'Game', 'game', apply=True, bundle=bundle)
            self.assertFalse((target / 'private.txt').exists())
            (bundle / 'template/README.md').write_bytes(b'TAMPERED')
            with self.assertRaises(ValueError):
                creator.create(base / 'other', 'Game', 'game', apply=True, bundle=bundle)
            self.assertFalse((base / 'other').exists())

    def test_partial_failure_recovers_own_files_and_keeps_other_writer(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'project'
            original = Path.open
            calls = 0
            def fail_on_write(path, mode='r', *args, **kwargs):
                nonlocal calls
                if mode == 'xb':
                    calls += 1
                    if calls == 2:
                        (target / 'other-owner.txt').write_bytes(b'KEEP')
                        raise OSError('synthetic partial write failure')
                return original(path, mode, *args, **kwargs)
            with patch.object(Path, 'open', fail_on_write):
                with self.assertRaises(OSError):
                    creator.create(target, 'Game', 'game', apply=True)
            self.assertEqual(b'KEEP', (target / 'other-owner.txt').read_bytes())
            self.assertEqual(['other-owner.txt'], [p.name for p in target.iterdir()])


if __name__ == '__main__':
    unittest.main()
