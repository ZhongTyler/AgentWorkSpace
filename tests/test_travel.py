import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import workspace as w
import compatibility as c
from publish import stage


class TravelRelease(unittest.TestCase):
    def test_standalone_compatible_install_preserves_existing_workflow_and_trips(self):
        with tempfile.TemporaryDirectory(prefix='travel-host-') as tmp:
            host = Path(tmp) / 'host'
            host.mkdir()
            rules = host / 'AGENTS.md'
            rules.write_bytes(b'Existing authoritative host rules.\n')
            existing = host / 'Travel/README.md'
            existing.parent.mkdir()
            existing.write_bytes(b'Existing travel workflow; review before integration.\n')
            trip = host / 'trips/my-trip/notes.md'
            trip.parent.mkdir(parents=True)
            trip.write_bytes(b'PRIVATE-TRIP-CANARY\n')
            incoming = w.catalog(ROOT)
            report = c.audit(incoming, host, [], ['travel'])
            self.assertEqual(['travel'], [p['component'] for p in report['recommended']])
            review = c.audit(incoming, host, ['travel'])
            self.assertEqual([], review['required'])
            self.assertEqual('needs-agent-review', review['package_review'][0]['assurance'])
            self.assertIn('Travel/README.md', [p['path'] for p in review['candidates']])
            before = {p: p.read_bytes() for p in [rules, existing, trip]}
            preview = w.install(ROOT, host, 'init', ['travel'], mode='compatible')
            self.assertFalse(preview['applied'])
            self.assertFalse((host / 'modules').exists())
            result = w.install(ROOT, host, 'init', ['travel'], True, mode='compatible')
            self.assertTrue(result['applied'])
            self.assertEqual({'travel'}, set(w.state(host)['components']))
            self.assertFalse((host / 'modules/meta').exists())
            module = host / 'modules/travel'
            project = host / 'trips/demo'
            for args in [[module / 'scripts/make-demo.mjs', '--project', project],
                         [module / 'scripts/travel.mjs', 'build', '--project', project],
                         [module / 'scripts/travel.mjs', 'validate', '--project', project]]:
                p = subprocess.run(['node', *map(str, args)], capture_output=True, text=True,
                                   encoding='utf-8', errors='replace', timeout=60)
                self.assertEqual(0, p.returncode, p.stdout[-1000:] + p.stderr[-1000:])
            html = (project / 'build/index.html').read_text(encoding='utf-8')
            self.assertIn('虚构海湾', html)
            self.assertNotIn('PRIVATE-TRIP-CANARY', html)
            self.assertTrue(w.rollback(host, result['transaction'], True)['applied'])
            self.assertTrue((project / 'build/index.html').exists())
            for p, original in before.items():
                self.assertEqual(original, p.read_bytes())

    def test_actual_predecessor_upgrade_add_and_reverse_rollback_keep_user_content(self):
        with tempfile.TemporaryDirectory(prefix='travel-upgrade-') as tmp:
            base = Path(tmp)
            old = base / 'old'
            old.mkdir()
            p = subprocess.run(['git', '-c', 'safe.directory=' + ROOT.as_posix(),
                                '-C', str(ROOT), 'archive', 'v'+json.loads((ROOT/'catalog.json').read_text(encoding='utf-8'))['previous_version']], capture_output=True, check=True)
            with tarfile.open(fileobj=io.BytesIO(p.stdout)) as archive:
                for entry in archive:
                    if not entry.isfile():
                        continue
                    path = w.safe(old, entry.name)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(archive.extractfile(entry).read())
            for mode in ['full', 'compatible']:
                host = base / mode
                args = [sys.executable, '-X', 'utf8', '-B', str(old / 'scripts/workspace.py'),
                        'init', '--target', str(host), '--packages', 'skills', '--apply']
                if mode == 'compatible':
                    host.mkdir()
                    (host / 'AGENTS.md').write_bytes(b'Existing root authority.\n')
                    args.extend(['--mode', 'compatible'])
                initial = subprocess.run(args, capture_output=True, text=True, encoding='utf-8')
                self.assertEqual(0, initial.returncode, initial.stderr)
                user = host / 'trips/existing/notes.md'
                user.parent.mkdir(parents=True)
                user.write_bytes(b'PRIVATE-CANARY\n')
                local = host / 'modules/skills/library/humanizer-zh/SKILL.md'
                local.write_bytes(local.read_bytes() + b'\nLocal user edit.\n')
                retained = {p: p.read_bytes() for p in [user, local, host / 'AGENTS.md']}
                upgrade = w.install(ROOT, host, 'upgrade', [], True)
                resolved_local = bool(upgrade.get('conflicts'))
                if resolved_local:
                    self.assertEqual(['modules/skills/library/humanizer-zh/SKILL.md'], upgrade['conflicts'])
                    self.assertFalse(upgrade['applied'])
                    self.assertEqual(retained[local], local.read_bytes())
                    self.assertEqual(w.catalog(ROOT)['previous_version'], w.state(host)['version'])
                    saved = user.parent/'custom-humanizer.before-upgrade.md'
                    saved.write_bytes(retained[local])
                    local.write_bytes((old/'packages/skills/library/humanizer-zh/SKILL.md').read_bytes())
                    upgrade = w.install(ROOT, host, 'upgrade', [], True)
                    self.assertEqual(retained[local], saved.read_bytes())
                self.assertTrue(upgrade['applied'])
                self.assertEqual(w.catalog(ROOT)['version'], w.state(host)['version'])
                self.assertNotIn('travel', w.state(host)['components'])
                addition = w.install(ROOT, host, 'add', ['travel'], True)
                self.assertTrue(addition['applied'])
                self.assertIn('travel', w.state(host)['components'])
                self.assertTrue(w.rollback(host, addition['transaction'], True)['applied'])
                self.assertTrue(w.rollback(host, upgrade['transaction'], True)['applied'])
                self.assertEqual(w.catalog(ROOT)['previous_version'], w.state(host)['version'])
                if resolved_local:
                    local.write_bytes(saved.read_bytes())
                for p, original in retained.items():
                    self.assertEqual(original, p.read_bytes())

    def test_publication_rejects_private_input_before_git_or_reading_it(self):
        with tempfile.TemporaryDirectory(prefix='travel-private-') as tmp:
            source = Path(tmp) / 'source'
            manifest = source / 'release-input/manifest.json'
            manifest.parent.mkdir(parents=True)
            manifest.write_text(json.dumps({'release_schema': 1, 'component_id': 'travel',
                'output_path': 'packages/travel', 'copy_files': [
                    {'source': '私有/orders.txt', 'target': '私有/orders.txt'}]}), encoding='utf-8')
            with self.assertRaisesRegex(w.ContractError, 'public workflow whitelist'):
                stage(source, Path(tmp) / 'output')


if __name__ == '__main__':
    unittest.main()
