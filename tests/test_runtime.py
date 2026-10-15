"""Exercise installed packages; all data is synthetic and temporary."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import workspace as w
from publish import inventory


class Runtime(unittest.TestCase):
    def test_unregistered_regression_file_rejected_even_with_matching_inventory(self):
        shell = shutil.which('pwsh') or shutil.which('powershell')
        self.assertIsNotNone(shell)
        with tempfile.TemporaryDirectory(prefix='knowledge-test-boundary-') as temporary:
            host = Path(temporary) / 'host'
            self.assertTrue(w.install(ROOT, host, 'init', ['knowledge'], True)['applied'])
            knowledge = host / 'modules/knowledge'
            # Even an updated file count must not authorize unknown test contents.
            (knowledge / 'tests/unregistered.txt').write_bytes(b'SYNTHETIC UNREGISTERED FILE')
            marker = knowledge / '_release.json'
            value = json.loads(marker.read_text(encoding='utf-8'))
            value['file_count'] += 1
            marker.write_bytes((json.dumps(value) + '\n').encode('utf-8'))
            result = subprocess.run([shell, '-NoProfile', '-File', str(knowledge / 'system/maintenance/checklists/run-release-contract.ps1')], capture_output=True, timeout=60)
            self.assertNotEqual(0, result.returncode)
            self.assertIn(b'Unexpected regression test file: unregistered.txt', result.stdout + result.stderr)

    def test_real_compatible_package_preserves_host_and_reuses_governance(self):
        import compatibility as c
        shell = shutil.which('pwsh') or shutil.which('powershell')
        env = os.environ.copy()
        if os.name == 'nt':
            env['PSMODULEPATH'] = str(Path(os.environ['SYSTEMROOT']) / 'System32/WindowsPowerShell/v1.0/Modules')
        with tempfile.TemporaryDirectory(prefix='agentworkspace-compatible-runtime-') as temporary:
            target = Path(temporary) / 'host'
            target.mkdir()
            rules = target / 'AGENTS.md'
            rules.write_bytes(b'Synthetic reviewed host contract: authority, scope, verification and recovery.\n')
            definition = c.contract(w.catalog(ROOT))
            profile = {'schema_version': 1, 'providers': [{'id': 'synthetic-host', 'capabilities': ['host-governance'], 'assurance': 'reviewed', 'reason': 'Synthetic fixture for engineering integration, not a real semantic review', 'checks': {'host-governance': definition['capabilities']['host-governance']['criteria']}, 'evidence': [{'path': 'AGENTS.md', 'sha256': w.digest(rules.read_bytes())}]}]}
            original = rules.read_bytes()
            report = w.install(ROOT, target, 'init', ['brainstorm'], True, mode='compatible', profile=profile)
            self.assertTrue(report['applied'])
            self.assertFalse((target / 'modules/meta').exists())
            self.assertEqual(original, rules.read_bytes())
            result = subprocess.run([shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(target / 'modules/brainstorm/tests/run-release-contract.ps1')], capture_output=True, text=True, encoding='utf-8', errors='replace', env=env, timeout=180)
            self.assertEqual(0, result.returncode, result.stdout[-4000:] + result.stderr[-4000:])
            self.assertIn('Runtime PASS', result.stdout)
            self.assertTrue(w.rollback(target, report['transaction'], True)['applied'])
            self.assertEqual(original, rules.read_bytes())
            meta = w.install(ROOT, target, 'init', ['meta'], True, mode='compatible')
            self.assertTrue(meta['applied'])
            self.assertTrue((target / 'modules/meta/AGENTS.md').is_file())
            self.assertTrue((target / 'modules/meta/.agents/skills/humanizer-zh/SKILL.md').is_file())
            self.assertFalse((target / '.agents').exists())
            self.assertEqual(original, rules.read_bytes())

    def test_installed_packages_and_ingest_approval_boundary(self):
        if not (ROOT / 'catalog.json').exists():
            self.skipTest('Seal the real distribution before running runtime contracts')
        shell = shutil.which('pwsh') or shutil.which('powershell')
        self.assertIsNotNone(shell, 'PowerShell is required for runtime verification')
        env = os.environ.copy()
        # Python does not adjust PowerShell 7 inherited module paths for Windows 5.1.
        if os.name == 'nt':
            env['PSMODULEPATH'] = str(Path(os.environ['SYSTEMROOT']) / 'System32/WindowsPowerShell/v1.0/Modules')
        def run(args, expected=0):
            result = subprocess.run([str(a) for a in args], env=env, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180)
            if expected == 0:
                self.assertEqual(0, result.returncode, result.stdout[-4000:] + result.stderr[-4000:])
            else:
                self.assertNotEqual(0, result.returncode, 'An unapproved operation succeeded')
            return result.stdout
        def ps(script, *args, expected=0):
            return run([shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, *args], expected)
        before = inventory(ROOT / 'packages')
        with tempfile.TemporaryDirectory(prefix='agentworkspace-installed-runtime-') as temporary:
            base = Path(temporary)
            target = base / 'workspace'
            result = w.install(ROOT, target, 'init', ['brainstorm', 'fromdemotospec', 'knowledge'], True)
            self.assertTrue(result['applied'])
            self.assertFalse(w.install(ROOT, target, 'init', ['brainstorm', 'fromdemotospec', 'knowledge'], True)['changes'])
            bs, fromdemotospec, knowledge = [target / 'modules' / name for name in ('brainstorm', 'fromdemotospec', 'knowledge')]
            self.assertIn('Runtime PASS', ps(bs / 'tests/run-release-contract.ps1'))
            self.assertIn('Release contract: PASS', ps(knowledge / 'system/maintenance/checklists/run-release-contract.ps1'))
            query_checks = json.loads(run(['node', knowledge / 'system/query/query-evidence-check.mjs']))
            self.assertEqual('passed', query_checks['status'])
            self.assertGreaterEqual(query_checks['checks'], 41)
            request = base / 'query.json'
            request.write_bytes((knowledge / 'system/query/request.template.json').read_bytes())
            discovered = json.loads(run(['node', knowledge / 'system/query/query-evidence.mjs', 'discover', request, '--root', knowledge]))
            self.assertIn('candidates', discovered)
            project = base / 'project'
            created = json.loads(run(['node', fromdemotospec / 'scripts/prototype-project.mjs', 'init', '--project', project, '--name', 'Synthetic', '--path', 'single-file', '--apply']))
            self.assertFalse(created['implementation_created'])
            state = json.loads(run(['node', fromdemotospec / 'scripts/prototype-project.mjs', 'check-state', '--project', project]))
            self.assertFalse(state['actual_play_quality_verified'])
            canonical = json.loads(run(['node', fromdemotospec / 'scripts/fromdemotospec-analysis-adapter.mjs', 'status']))
            self.assertEqual('fromdemotospec-adapter', canonical['adapter_id'])
            # Scope configuration is a real task-time step, retaining the managed directory.
            ps(knowledge / 'system/maintenance/initialize-knowledge.ps1', '-PackagePath', knowledge, '-DisplayName', 'Synthetic Knowledge', '-DirectoryName', 'knowledge', '-Purpose', 'Isolated runtime verification', '-Audience', 'Test fixture', '-Topics', 'Synthetic mechanics', '-SourceQuality', 'Traceable originals', '-UseIma', 'no', '-Apply')
            clipping = knowledge / 'Clippings/20261009-synthetic.md'
            clipping.write_text('# Synthetic source\n\nA reversible test observation.\n', encoding='utf-8', newline='\n')
            def git(*args):
                return run(['git', '-c', 'safe.directory=' + knowledge.as_posix(), '-C', knowledge, *args])
            git('init', '-b', 'main')
            git('config', 'user.name', 'Runtime Fixture')
            git('config', 'user.email', 'runtime-fixture@example.invalid')
            git('add', '.')
            git('commit', '-m', 'test: establish synthetic baseline')
            control = knowledge / 'system/maintenance/checklists/ingest-control.ps1'
            manifest = 'system/maintenance/ingest-runs/synthetic-runtime/run.json'
            ps(control, '-Action', 'start', '-BatchId', 'synthetic-runtime', '-RunPath', manifest, '-Items', 'Clippings/20261009-synthetic.md', '-BeforeCount', '0', '-ReviewPolicy', 'deferred')
            recorded = json.loads((knowledge / manifest).read_text(encoding='utf-8-sig'))
            self.assertEqual(8, recorded['schema_version'])
            snapshot = inventory(knowledge)
            ps(control, '-Action', 'finish', '-RunPath', manifest, expected=1)
            self.assertEqual(snapshot, inventory(knowledge), 'Rejected finish must not alter state or approve content')
        self.assertEqual(before, inventory(ROOT / 'packages'), 'Runtime must not write to the release packages')


if __name__ == '__main__':
    unittest.main(verbosity=2)
