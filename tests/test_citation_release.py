"""Verify the optional citation method against real recipients and predecessor files."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import workspace as w
from release_history import published_bundle, advance_to_predecessor, rollback_history


class CitationReleaseTests(unittest.TestCase):
    def skill(self, host, platform, operation, *arguments, bundle=ROOT, success=True):
        result = subprocess.run([sys.executable, '-X', 'utf8', '-B',
                                 str(bundle / 'packages/skills/scripts/skills.py'), operation,
                                 '--target', str(host), '--platform', platform, *arguments], capture_output=True)
        self.assertEqual(result.returncode == 0, success, (result.stdout + result.stderr).decode('utf-8', 'replace'))
        return json.loads(result.stdout if result.returncode == 0 or result.stdout else result.stderr)

    def test_only_skills_package_changes_and_existing_methods_are_preserved(self):
        # This is a historical 1.22.0 scope invariant, not a claim about every later release.
        with tempfile.TemporaryDirectory(prefix='citation-frozen-scope-') as temporary:
            release = published_bundle(ROOT, '1.22.0', Path(temporary) / 'release')
            prior = json.loads(subprocess.check_output(['git', '-c', 'safe.directory=' + ROOT.as_posix(),
                                                        '-C', str(ROOT), 'show', 'v1.21.1:catalog.json']))
            current = w.catalog(release)
            self.assertEqual({'skills'}, {k for k, v in current['components'].items()
                                         if v['files'] != prior['components'][k]['files']})
            listing = json.loads((release / 'packages/skills/skills.json').read_text('utf-8'))
            self.assertEqual(19, len(listing['skills']))
            old = json.loads(subprocess.check_output(['git', '-c', 'safe.directory=' + ROOT.as_posix(),
                                                     '-C', str(ROOT), 'show', 'v1.21.1:packages/skills/catalog.json']))
            new = json.loads((release / 'packages/skills/catalog.json').read_text('utf-8'))
            for name in old['components']:
                self.assertEqual(old['components'][name]['files'], new['components'][name]['files'])
            library = release / 'packages/skills/library/citation-management'
            self.assertEqual(8, len(list((library / 'scripts').glob('*.py'))))
            self.assertIn('K-Dense', (library / 'references/LICENSE').read_text('utf-8'))

    def test_fresh_both_clients_offline_script_and_conflicting_skill_preserved(self):
        with tempfile.TemporaryDirectory(prefix='citation-fresh-') as temporary:
            host = Path(temporary) / 'host'
            host.mkdir()
            canary = host / 'private-research.md'
            canary.write_bytes(b'PRIVATE USER RESEARCH\r\n')
            for platform, folder in [('codex', '.agents'), ('codebuddy', '.codebuddy')]:
                self.assertTrue(self.skill(host, platform, 'install', '--names', 'citation-management', '--apply')['applied'])
                library = host / folder / 'skills/citation-management'
                bib = host / (platform + '.bib')
                original = b'@article{first, title={A {Nested} Title}, author={Doe, Jane}, year={2024}, doi={10.1000/example}}\n@article{other, title={A {Nested} Title}, author={Doe, Jane}, year={2024}, doi={10.1000/example}}\n'
                bib.write_bytes(original)
                before = {p.relative_to(host).as_posix(): p.read_bytes() for p in host.rglob('*') if p.is_file()}
                run = subprocess.run([sys.executable, '-X', 'utf8', '-B', str(library / 'scripts/format_bibtex.py'),
                                      str(bib), '--deduplicate'], capture_output=True)
                self.assertEqual(0, run.returncode, run.stderr)
                self.assertEqual(1, run.stdout.count(b'@article{'))
                self.assertIn(b'Nested', run.stdout)
                self.assertEqual(before, {p.relative_to(host).as_posix(): p.read_bytes() for p in host.rglob('*') if p.is_file()})
            conflict = Path(temporary) / 'conflict'
            path = conflict / '.agents/skills/citation-management/SKILL.md'
            path.parent.mkdir(parents=True)
            path.write_bytes(b'OWNED USER SKILL')
            self.assertTrue(self.skill(conflict, 'codex', 'install', '--names', 'citation-management', '--apply', success=False)['conflicts'])
            self.assertEqual(b'OWNED USER SKILL', path.read_bytes())
            self.assertEqual(b'PRIVATE USER RESEARCH\r\n', canary.read_bytes())

    def test_real_package_and_selected_skill_upgrade_are_independent_and_reversible(self):
        with tempfile.TemporaryDirectory(prefix='citation-upgrade-') as temporary:
            base = Path(temporary)
            old = published_bundle(ROOT, '1.21.1', base / 'old')
            host = base / 'host'
            self.assertTrue(w.install(old, host, 'init', ['skills'], True, mode='compatible')['applied'])
            self.assertTrue(self.skill(host, 'codex', 'install', '--names', 'dual-layer-explainer', '--apply', bundle=old)['applied'])
            entry = host / '.agents/skills/dual-layer-explainer/SKILL.md'
            prior = entry.read_bytes()
            private = host / 'private.md'
            private.write_bytes(b'USER DATA')
            intermediate = advance_to_predecessor(ROOT, host, base / 'steps')
            package = w.install(ROOT, host, 'upgrade', [], True)
            self.assertTrue(package['applied'])
            self.assertFalse((host / '.agents/skills/citation-management').exists())
            self.assertEqual(prior, entry.read_bytes())
            selected = self.skill(host, 'codex', 'upgrade', '--apply')
            self.assertTrue(selected['applied'])
            addition = self.skill(host, 'codex', 'install', '--names', 'citation-management', '--apply')
            new_entry = host / '.agents/skills/citation-management/SKILL.md'
            clean = new_entry.read_bytes()
            new_entry.write_bytes(clean + b'\nUSER EDIT')
            self.assertTrue(self.skill(host, 'codex', 'rollback', '--transaction', addition['transaction'], '--apply', success=False)['conflicts'])
            self.assertEqual(clean + b'\nUSER EDIT', new_entry.read_bytes())
            new_entry.write_bytes(clean)
            self.assertTrue(self.skill(host, 'codex', 'rollback', '--transaction', addition['transaction'], '--apply')['applied'])
            self.assertFalse(new_entry.exists())
            self.assertTrue(self.skill(host, 'codex', 'rollback', '--transaction', selected['transaction'], '--apply')['applied'])
            self.assertTrue(w.rollback(host, package['transaction'], True)['applied'])
            rollback_history(host, intermediate)
            self.assertEqual('1.21.1', w.state(host)['version'])
            self.assertEqual(prior, entry.read_bytes())
            self.assertEqual(b'USER DATA', private.read_bytes())


if __name__ == '__main__':
    unittest.main()
