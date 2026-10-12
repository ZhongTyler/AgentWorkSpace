"""Research isolation, source privacy, pinned archives and real predecessor recovery."""
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


class ResearchRelease(unittest.TestCase):
    def test_standalone_install_repeat_and_recovery_preserve_host(self):
        with tempfile.TemporaryDirectory(prefix='research-host-') as tmp:
            host = Path(tmp)
            rules = host / 'AGENTS.md'
            rules.write_bytes(b'Existing host authority.\n')
            existing = host / 'Research/README.md'
            existing.parent.mkdir()
            existing.write_bytes(b'Existing research workflow.\n')
            user = host / 'research-notes/private.md'
            user.parent.mkdir()
            user.write_bytes(b'PRIVATE-RESEARCH-CANARY\n')
            before = {p: p.read_bytes() for p in (rules, existing, user)}
            cat = w.catalog(ROOT)
            audit = c.audit(cat, host, [], ['research'])
            self.assertEqual(['research'], [p['component'] for p in audit['recommended']])
            review = c.audit(cat, host, ['research'])
            self.assertEqual([], review['required'])
            self.assertIn('Research/README.md', [p['path'] for p in review['candidates']])
            self.assertEqual('needs-agent-review', review['package_review'][0]['assurance'])
            self.assertFalse(w.install(ROOT, host, 'init', ['research'], mode='compatible')['applied'])
            self.assertFalse((host / 'modules').exists())
            result = w.install(ROOT, host, 'init', ['research'], True, mode='compatible')
            self.assertEqual({'research'}, set(w.state(host)['components']))
            self.assertFalse((host / '.codex').exists())
            self.assertFalse((host / 'modules/knowledge').exists())
            self.assertFalse((host / 'modules/research/integrations/mcp/runtime').exists())
            repeated = w.install(ROOT, host, 'add', ['research'], True)
            self.assertFalse(repeated['conflicts'])
            self.assertFalse(repeated['applied'])
            command = subprocess.run([sys.executable, '-X', 'utf8', '-B',
                str(host / 'modules/research/proactive/review.py')], capture_output=True, text=True, encoding='utf-8')
            self.assertEqual(0, command.returncode, command.stderr)
            self.assertNotIn('PRIVATE-RESEARCH-CANARY', command.stdout)
            self.assertTrue(w.rollback(host, result['transaction'], True)['applied'])
            for p, data in before.items():
                self.assertEqual(data, p.read_bytes())

    def test_public_inventory_archives_and_no_inherited_authority(self):
        package = ROOT / 'packages/research'
        names = w.catalog(ROOT)['components']['research']['files']
        for name in names:
            self.assertFalse(any(p in {'runs', 'runtime', 'docs', 'archive', 'experiments', 'node_modules', 'local-status.json', 'validation.json'} for p in Path(name).parts), name)
        self.assertIn('proactive/reporting.md', names)
        self.assertFalse((package / 'preview-manifest.json').exists())
        mcp = package / 'integrations/mcp'
        locks = [json.loads((mcp / 'source-lock.json').read_text(encoding='utf-8'))['sources'],
                 json.loads((mcp / 'npm-package-lock.json').read_text(encoding='utf-8'))['packages'],
                 [json.loads((mcp / 'reddit-package-lock.json').read_text(encoding='utf-8'))],
                 [json.loads((mcp / 'xhs-compat-lock.json').read_text(encoding='utf-8'))]]
        for record in sum(locks, []):
            if record.get('file'):
                self.assertEqual(record['sha256'], w.digest((mcp / record['file']).read_bytes()))
            if record.get('local_only_archive'):
                self.assertFalse((mcp / record['local_only_archive']).exists())
        settings = json.loads((package / 'proactive/schedule-template.json').read_text(encoding='utf-8'))
        self.assertIn('explicitly authorizes', settings['knowledge'])
        self.assertIn('安装本包不授予该授权', (package / 'game-research/README.md').read_text(encoding='utf-8'))

    def test_private_input_rejected_before_git_and_checksum_drift_refused(self):
        with tempfile.TemporaryDirectory(prefix='research-boundary-') as tmp:
            source = Path(tmp) / 'source'
            manifest = source / 'release-input/manifest.json'
            manifest.parent.mkdir(parents=True)
            value = {'release_schema': 1, 'component_id': 'research', 'output_path': 'packages/research',
                     'copy_files': [{'source': 'docs/private.md', 'target': 'README.md', 'sha256': 'a' * 64}],
                     'expected_file_count': 1}
            manifest.write_text(json.dumps(value), encoding='utf-8')
            with self.assertRaisesRegex(w.ContractError, 'public whitelist'):
                stage(source, Path(tmp) / 'output')
            value['copy_files'][0]['source'] = 'release-input/curated/README.md'
            manifest.write_text(json.dumps(value), encoding='utf-8')
            content = source / 'release-input/curated/README.md'
            content.parent.mkdir()
            content.write_text('Changed after review.\n', encoding='utf-8')
            with self.assertRaisesRegex(w.ContractError, 'checksum differs'):
                stage(source, Path(tmp) / 'output')

    def test_actual_150_upgrade_add_reverse_rollback_preserve_reports(self):
        with tempfile.TemporaryDirectory(prefix='research-upgrade-') as tmp:
            base = Path(tmp)
            old = base / 'old'
            old.mkdir()
            p = subprocess.run(['git', '-c', 'safe.directory=' + ROOT.as_posix(), '-C', str(ROOT),
                                'archive', 'v1.5.0'], capture_output=True, check=True)
            with tarfile.open(fileobj=io.BytesIO(p.stdout)) as archive:
                for entry in archive:
                    if entry.isfile():
                        target = w.safe(old, entry.name)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(archive.extractfile(entry).read())
            for mode in ('full', 'compatible'):
                host = base / mode
                args = [sys.executable, '-X', 'utf8', '-B', str(old / 'scripts/workspace.py'),
                        'init', '--target', str(host), '--packages', 'skills', '--apply']
                if mode == 'compatible':
                    host.mkdir()
                    (host / 'AGENTS.md').write_bytes(b'Existing authoritative host rules.\n')
                    args.extend(['--mode', mode])
                result = subprocess.run(args, capture_output=True, text=True, encoding='utf-8')
                self.assertEqual(0, result.returncode, result.stderr)
                report = host / 'research-notes/my-report.md'
                report.parent.mkdir()
                report.write_bytes(b'User research outside installed package.\n')
                local = host / 'modules/skills/README.md'
                local.write_bytes(local.read_bytes() + b'\nUser edit.\n')
                before = {p: p.read_bytes() for p in (report, local, host / 'AGENTS.md')}
                upgrade = w.install(ROOT, host, 'upgrade', [], True)
                self.assertNotIn('research', w.state(host)['components'])
                addition = w.install(ROOT, host, 'add', ['research'], True)
                self.assertEqual('1.6.0', w.state(host)['version'])
                self.assertIn('research', w.state(host)['components'])
                self.assertTrue(w.rollback(host, addition['transaction'], True)['applied'])
                self.assertTrue(w.rollback(host, upgrade['transaction'], True)['applied'])
                self.assertEqual('1.5.0', w.state(host)['version'])
                for p, data in before.items():
                    self.assertEqual(data, p.read_bytes())


if __name__ == '__main__':
    unittest.main()
