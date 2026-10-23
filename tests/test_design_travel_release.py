import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests'))
import workspace as w
from release_history import published_bundle


class DesignTravelRelease(unittest.TestCase):
    def pick(self, library, host, platform, *args, code=0):
        p = subprocess.run([sys.executable, '-X', 'utf8', '-B', str(library / 'scripts/skills.py'),
                            *args, '--target', str(host), '--platform', platform],
                           capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120)
        self.assertEqual(code, p.returncode, p.stdout + p.stderr)
        return json.loads(p.stdout)

    def test_pinned_originals_and_independent_client_selection_recovery(self):
        library = ROOT / 'packages/skills'
        names = ['design-critique', 'design-handoff']
        for name in names:
            folder = library / 'library' / name
            metadata = json.loads((folder / 'references/UPSTREAM.json').read_text())
            original = (folder / 'references/SKILL.original.txt').read_bytes()
            self.assertEqual(metadata['original_sha256'], hashlib.sha256(original).hexdigest())
            self.assertEqual(metadata['license_sha256'], hashlib.sha256((folder / 'LICENSE').read_bytes()).hexdigest())
            self.assertEqual('Apache-2.0', metadata['license'])
            self.assertEqual('a266ab8c3c754a3ccf7a634044fc1595fc06e50e', metadata['revision'])
            adapted = (folder / 'SKILL.md').read_bytes()
            hint = next(line for line in original.splitlines(keepends=True) if line.startswith(b'argument-hint:'))
            hook = b'\nLocal host integration: read [HOST-ADAPTER.md](HOST-ADAPTER.md) before applying this original method.\n'
            restored = adapted.replace(hook, b'', 1).replace(b'CONNECTORS.md)', b'../../CONNECTORS.md)', 1)
            end = restored.find(b'\n---\n', 4)
            restored = restored[:end + 1] + hint + restored[end + 1:]
            self.assertEqual(original, restored)
        for platform, directory in [('codex', '.agents/skills'), ('codebuddy', '.codebuddy/skills')]:
            with self.subTest(platform=platform), tempfile.TemporaryDirectory(prefix='design-client-') as temp:
                host = Path(temp)
                rule = host / 'AGENTS.md'; rule.write_bytes(b'Host owns decisions and permissions.\n')
                preview = self.pick(library, host, platform, 'install', '--names', *names)
                self.assertFalse(preview['applied']); self.assertFalse((host / directory).exists())
                installed = self.pick(library, host, platform, 'install', '--names', *names, '--apply')
                self.assertEqual(names, sorted(p.name for p in (host / directory).iterdir()))
                self.assertFalse((host / 'modules').exists())
                modified = host / directory / names[0] / 'SKILL.md'; baseline = modified.read_bytes()
                modified.write_bytes(baseline + b'\nRecipient customization.\n')
                self.pick(library, host, platform, 'rollback', '--transaction', installed['transaction'], '--apply', code=2)
                self.assertTrue(modified.read_bytes().endswith(b'Recipient customization.\n'))
                modified.write_bytes(baseline)
                self.pick(library, host, platform, 'rollback', '--transaction', installed['transaction'], '--apply')
                self.assertFalse(modified.exists()); self.assertEqual(b'Host owns decisions and permissions.\n', rule.read_bytes())

    def test_real_predecessor_upgrade_and_reverse_preserve_trip_and_host(self):
        with tempfile.TemporaryDirectory(prefix='design-travel-upgrade-') as temp:
            base = Path(temp); old = published_bundle(ROOT, '1.23.0', base / 'old')
            # This historical delta stays bound to its immutable release.
            release = published_bundle(ROOT, '1.24.0', base / 'release')
            for mode in ['full', 'compatible']:
                with self.subTest(mode=mode):
                    host = base / mode; host.mkdir()
                    if mode == 'compatible': (host / 'AGENTS.md').write_bytes(b'Existing host authority.\n')
                    initial = w.install(old, host, 'init', ['travel', 'skills'], True, mode=mode)
                    self.assertTrue(initial['applied'])
                    private = host / 'trips/existing/notes.md'; private.parent.mkdir(parents=True); private.write_bytes(b'PRIVATE-TRIP-KEEP\n')
                    external = host / '.local/frontend/SKILL.md'; external.parent.mkdir(parents=True); external.write_bytes(b'External frontend original.\n')
                    retained = {p: p.read_bytes() for p in [private, external, host / 'AGENTS.md']}
                    self.pick(host / 'modules/skills', host, 'codex', 'install', '--names', 'game-presentation', '--apply')
                    old_skill = (host / '.agents/skills/game-presentation/SKILL.md').read_bytes()
                    update = w.install(release, host, 'upgrade', [], True); self.assertTrue(update['applied'])
                    self.assertEqual('0.5.0', json.loads((host / 'modules/travel/package.json').read_text())['version'])
                    self.assertEqual(old_skill, (host / '.agents/skills/game-presentation/SKILL.md').read_bytes())
                    self.assertFalse((host / '.agents/skills/design-handoff').exists())
                    upgraded = self.pick(host / 'modules/skills', host, 'codex', 'upgrade', '--apply')
                    added = self.pick(host / 'modules/skills', host, 'codex', 'install', '--names', 'design-handoff', '--apply')
                    self.assertFalse((host / '.agents/skills/design-critique').exists())
                    library = host / 'modules/skills'
                    self.pick(library, host, 'codex', 'rollback', '--transaction', added['transaction'], '--apply')
                    self.pick(library, host, 'codex', 'rollback', '--transaction', upgraded['transaction'], '--apply')
                    changed = host / 'modules/travel/README.md'; bytes_before = changed.read_bytes()
                    changed.write_bytes(bytes_before + b'\nLater travel customization.\n')
                    self.assertTrue(w.rollback(host, update['transaction'])['conflicts'])
                    changed.write_bytes(bytes_before)
                    self.assertTrue(w.rollback(host, update['transaction'], True)['applied'])
                    self.assertEqual('1.23.0', w.state(host)['version'])
                    for p, content in retained.items(): self.assertEqual(content, p.read_bytes())


if __name__ == '__main__':
    unittest.main(verbosity=2)
