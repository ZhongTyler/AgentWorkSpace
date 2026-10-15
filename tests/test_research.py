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
    def test_portable_validation_guide_contains_no_maintainer_backlog(self):
        package = ROOT / 'packages/research'
        guide = (package / 'validation/README.md').read_text(encoding='utf-8')
        self.assertIn('开题先查', guide)
        self.assertIn('包外研究目录', guide)
        for private in ['codex://threads/', 'local-validation:', 'V-001', 'V-014', '当前本机索引']:
            self.assertNotIn(private, guide)
        self.assertTrue((package / 'templates/validation-candidate.md').is_file())
        self.assertFalse((package / 'validation/verification.json').exists())

    def test_private_validation_inputs_and_records_fail_before_git(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(prefix='validation-public-boundary-') as tmp:
            source = Path(tmp) / 'source'
            manifest = source / 'release-input/manifest.json'
            manifest.parent.mkdir(parents=True)
            for target in ['validation/private.md', 'validation/verification.json', 'validation/candidates.json']:
                value = {'release_schema': 1, 'component_id': 'research', 'output_path': 'packages/research',
                         'copy_files': [{'source': 'release-input/curated/' + target, 'target': target, 'sha256': 'a' * 64}],
                         'expected_file_count': 1}
                manifest.write_text(json.dumps(value), encoding='utf-8')
                with patch('publish.git', side_effect=AssertionError('Git must not be reached')):
                    with self.assertRaisesRegex(w.ContractError, 'portable guide'):
                        stage(source, Path(tmp) / 'rejected')
            for i, content in enumerate(['# Private\nV-001 real candidate\n', 'codex://threads/private-id', '<!-- local-validation:start --> private']):
                target = 'validation/README.md'
                saved = source / ('release-input/curated/' + target)
                saved.parent.mkdir(parents=True, exist_ok=True)
                saved.write_bytes(content.encode('utf-8'))
                value['copy_files'] = [{'source': 'release-input/curated/' + target, 'target': target,
                                        'sha256': w.digest(saved.read_bytes())}]
                manifest.write_text(json.dumps(value), encoding='utf-8')
                with patch('publish.git', side_effect=AssertionError('Git must not be reached')):
                    with self.assertRaisesRegex(w.ContractError, 'Private validation'):
                        stage(source, Path(tmp) / ('private-' + str(i)))

    def test_actual_1130_upgrade_conflict_and_rollback_preserve_user_validation(self):
        from release_history import published_bundle
        with tempfile.TemporaryDirectory(prefix='validation-1130-upgrade-') as tmp:
            base = Path(tmp)
            old = published_bundle(ROOT, '1.13.0', base / 'old')
            bridge = published_bundle(ROOT, '1.13.1', base / 'bridge')
            destination = published_bundle(ROOT, '1.14.0', base / 'next-historical-release')
            for mode in ['full', 'compatible']:
                host = base / mode
                host.mkdir()
                authority = host / 'AGENTS.md'
                if mode == 'compatible':
                    authority.write_bytes(b'EXISTING HOST AUTHORITY')
                w.install(old, host, 'init', ['research'], True, mode=mode)
                private = host / 'research-notes/validation.md'
                private.parent.mkdir()
                private.write_bytes(b'PRIVATE CANDIDATE AND CHAT CANARY')
                rules = authority.read_bytes()
                result = w.install(bridge, host, 'upgrade', [], True)
                self.assertTrue(result['applied'])
                guide = host / 'modules/research/validation/README.md'
                self.assertTrue(guide.exists())
                original = guide.read_bytes()
                guide.write_bytes(original + b'\nUSER LIBRARY EDIT')
                conflict = w.rollback(host, result['transaction'], False)
                self.assertTrue(conflict['conflicts'])
                self.assertFalse(conflict['applied'])
                # The next release leaves Research bytes unchanged: preserve its user edit.
                latest = w.install(destination, host, 'upgrade', [], True)
                self.assertTrue(latest['applied'])
                self.assertEqual(original + b'\nUSER LIBRARY EDIT', guide.read_bytes())
                self.assertTrue(w.rollback(host, latest['transaction'], True)['applied'])
                self.assertEqual('1.13.1', w.state(host)['version'])
                self.assertEqual(original + b'\nUSER LIBRARY EDIT', guide.read_bytes())
                guide.write_bytes(original)
                self.assertTrue(w.rollback(host, result['transaction'], True)['applied'])
                self.assertEqual('1.13.0', w.state(host)['version'])
                self.assertFalse(guide.exists())
                self.assertEqual(b'PRIVATE CANDIDATE AND CHAT CANARY', private.read_bytes())
                self.assertEqual(rules, authority.read_bytes())

    def advance_to_previous(self, host, destination):
        """Follow published predecessor contracts; never bypass the upgrade gate."""
        current = w.state(host)['version']
        wanted = w.catalog(ROOT)['previous_version']
        chain = []
        while wanted != current:
            self.assertNotIn(wanted, chain, 'Published predecessor cycle')
            w.version(wanted)
            chain.append(wanted)
            previous = subprocess.run(['git', '-c', 'safe.directory=' + ROOT.as_posix(), '-C', str(ROOT),
                'show', 'v' + wanted + ':catalog.json'], capture_output=True, check=True).stdout
            wanted = json.loads(previous)['previous_version']
        transactions = []
        for version in reversed(chain):
            bundle = destination / version
            bundle.mkdir(parents=True)
            data = subprocess.run(['git', '-c', 'safe.directory=' + ROOT.as_posix(), '-C', str(ROOT),
                'archive', 'v' + version], capture_output=True, check=True).stdout
            with tarfile.open(fileobj=io.BytesIO(data)) as archive:
                for entry in archive:
                    if entry.isfile():
                        target = w.safe(bundle, entry.name)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(archive.extractfile(entry).read())
            result = subprocess.run([sys.executable, '-X', 'utf8', '-B', str(bundle/'scripts/workspace.py'),
                'upgrade', '--target', str(host), '--apply'], capture_output=True, text=True, encoding='utf-8')
            self.assertEqual(0, result.returncode, result.stderr)
            transactions.append(json.loads(result.stdout)['transaction'])
            self.assertEqual(version, w.state(host)['version'])
        return transactions

    def test_rea_public_material_and_no_machine_state(self):
        package = ROOT / 'packages/research'
        rea = package / 'integrations/rea'
        lock = json.loads((rea / 'source-lock.json').read_text(encoding='utf-8'))
        self.assertEqual('6.4.0', lock['version'])
        self.assertEqual(lock['sha256'], w.digest((rea / lock['file']).read_bytes()))
        self.assertTrue((rea / 'skill/rea-investigate/references/upstream/SKILL.md').is_file())
        self.assertTrue((package / 'templates/tool-storage.md').is_file())
        for path in rea.rglob('*'):
            if path.is_file():
                self.assertFalse(any(part in {'runtime', 'checks', 'node_modules', 'connection-status.json', 'runtime-copy-receipt.json', 'install-paths.json'} for part in path.relative_to(rea).parts))

    def test_actual_160_research_upgrade_rollback_preserves_external_tools(self):
        with tempfile.TemporaryDirectory(prefix='research-rea-upgrade-') as tmp:
            base = Path(tmp); old = base / 'old'; old.mkdir()
            archive_bytes = subprocess.run(['git', '-c', 'safe.directory=' + ROOT.as_posix(), '-C', str(ROOT),
                                'archive', 'v1.6.0'], capture_output=True, check=True).stdout
            with tarfile.open(fileobj=io.BytesIO(archive_bytes)) as archive:
                for entry in archive:
                    if entry.isfile():
                        target = w.safe(old, entry.name)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(archive.extractfile(entry).read())
            for mode in ('full', 'compatible'):
                host = base / mode
                args = [sys.executable, '-X', 'utf8', '-B', str(old / 'scripts/workspace.py'),
                        'init', '--target', str(host), '--packages', 'research', '--apply']
                if mode == 'compatible':
                    host.mkdir(); (host / 'AGENTS.md').write_bytes(b'Host rules.\n')
                    args.extend(['--mode', mode])
                result = subprocess.run(args, capture_output=True, text=True, encoding='utf-8')
                self.assertEqual(0, result.returncode, result.stderr)
                notes = host/'research-notes/private.md'; notes.parent.mkdir(); notes.write_bytes(b'PRIVATE')
                runtime = host/'tools/rea/existing.txt'; runtime.parent.mkdir(parents=True); runtime.write_bytes(b'USER TOOL')
                client = host/'client/config.toml'; client.parent.mkdir(); client.write_bytes(b'# OWN CONFIG\n')
                before = {p: p.read_bytes() for p in (notes, runtime, client, host/'AGENTS.md')}
                intermediates = self.advance_to_previous(host, base/'steps'/mode)
                upgrade = w.install(ROOT, host, 'upgrade', [], True)
                self.assertTrue(upgrade['applied'])
                self.assertTrue((host/'modules/research/integrations/rea/scripts/install.py').is_file())
                self.assertFalse((host/'.codex').exists())
                self.assertTrue(w.rollback(host, upgrade['transaction'], True)['applied'])
                self.assertEqual(w.catalog(ROOT)['previous_version'], w.state(host)['version'])
                for transaction in reversed(intermediates):
                    self.assertTrue(w.rollback(host, transaction, True)['applied'])
                self.assertEqual('1.6.0', w.state(host)['version'])
                for p, data in before.items():
                    self.assertEqual(data, p.read_bytes())

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

    def test_rea_local_connection_receipts_rejected_before_git(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'source'; manifest=source/'release-input/manifest.json';manifest.parent.mkdir(parents=True)
            for target in ('integrations/rea/connection-status.json', 'integrations/rea/checks/receipt.json',
                           'integrations/rea/skill/rea-investigate/references/install-paths.json'):
                manifest.write_text(json.dumps({'release_schema':1,'component_id':'research','output_path':'packages/research',
                    'copy_files':[{'source':'release-input/curated/'+target,'target':target,'sha256':'a'*64}],
                    'expected_file_count':1}),encoding='utf-8')
                with self.assertRaisesRegex(w.ContractError,'public whitelist'):
                    stage(source,Path(tmp)/'output')

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
                local = host / 'modules/skills/library/humanizer-zh/SKILL.md'
                local.write_bytes(local.read_bytes() + b'\nUser edit.\n')
                before = {p: p.read_bytes() for p in (report, local, host / 'AGENTS.md')}
                intermediates = self.advance_to_previous(host, base/'steps'/mode)
                upgrade = w.install(ROOT, host, 'upgrade', [], True)
                self.assertNotIn('research', w.state(host)['components'])
                addition = w.install(ROOT, host, 'add', ['research'], True)
                self.assertEqual(w.catalog(ROOT)['version'], w.state(host)['version'])
                self.assertIn('research', w.state(host)['components'])
                self.assertTrue(w.rollback(host, addition['transaction'], True)['applied'])
                self.assertTrue(w.rollback(host, upgrade['transaction'], True)['applied'])
                self.assertEqual(w.catalog(ROOT)['previous_version'], w.state(host)['version'])
                for transaction in reversed(intermediates):
                    self.assertTrue(w.rollback(host, transaction, True)['applied'])
                self.assertEqual('1.5.0', w.state(host)['version'])
                for p, data in before.items():
                    self.assertEqual(data, p.read_bytes())


if __name__ == '__main__':
    unittest.main()
