"""Recipient interfaces and actual predecessor recovery, not research-quality claims."""
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
from test_tools import module


class AgentCoordinationRelease(unittest.TestCase):
    def command(self, *args):
        result = subprocess.run([str(x) for x in args], capture_output=True, text=True,
                                encoding='utf-8', errors='replace', timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout[-1500:] + result.stderr[-1500:])
        return json.loads(result.stdout)

    def test_adapter_reports_current_contract_without_execution(self):
        import shutil
        node = shutil.which('node')
        self.assertIsNotNone(node)
        script = ROOT / 'packages/fromdemotospec/scripts/fromdemotospec-analysis-adapter.mjs'
        status = self.command(node, script, 'status')
        self.assertEqual(status['schema_version'], 2)
        self.assertEqual(status['request_contract'], 'GameAnalysisDecision v2')
        self.assertIn('consume-delivery', status['commands'])
        self.assertEqual(status['receipt_contract'], 'HostDecisionReceipt v1')
        self.assertEqual(status['legacy']['selection'], 'explicit_schema_version_1_only')
        self.assertFalse(status['analysis_executed'])
        self.assertFalse(status['ownership']['host_write'])

    def test_cost_trace_is_not_a_completed_run_or_measured_billing(self):
        research = ROOT / 'packages/research'
        cost = module('published_phase_cost', research / 'proactive/cost.py')
        review = module('published_phase_review', research / 'proactive/review.py')
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary); runs = base / 'runs'; runs.mkdir()
            path = runs / '2026-10-14-research.cost.json'
            cost.record(path, 'research', '2026-10-14', 'ingestion', now='2026-10-14T02:00:00Z')
            cost.record(path, 'research', '2026-10-14', 'review', resumed=True, now='2026-10-14T02:10:00Z')
            summary = cost.record(path, 'research', '2026-10-14', None, now='2026-10-14T02:11:00Z')
            self.assertEqual(summary['phase_seconds']['unallocated'], 600)
            self.assertEqual(summary['phase_seconds']['review'], 60)
            self.assertEqual(summary['coverage'], 'partial')
            self.assertIsNone(summary['active_model_seconds'])
            self.assertIsNone(summary['human_minutes'])
            self.assertIsNone(summary['monetary_cost'])
            self.assertEqual(review.status(runs, base / 'reviews')['completed_counts'],
                             {'research': 0, 'game-research': 0})
            before = path.read_bytes()
            with self.assertRaisesRegex(ValueError, 'Closed'):
                cost.record(path, 'research', '2026-10-14', 'discovery')
            self.assertEqual(before, path.read_bytes())

    def test_actual_1100_upgrade_conflict_and_rollback_preserves_host_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary); previous = base / 'previous'; previous.mkdir()
            raw = subprocess.run(['git', '-c', 'safe.directory=' + ROOT.as_posix(), '-C', str(ROOT),
                                  'archive', 'v1.10.0'], capture_output=True, check=True).stdout
            with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
                for entry in archive:
                    if entry.isfile():
                        target = w.safe(previous, entry.name)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(archive.extractfile(entry).read())
            for mode in ('full', 'compatible'):
                host = base / mode
                args = [sys.executable, '-X', 'utf8', '-B', previous / 'scripts/workspace.py',
                        'init', '--target', host, '--packages', 'research', 'fromdemotospec', '--apply']
                if mode == 'compatible':
                    host.mkdir(); (host / 'AGENTS.md').write_bytes(b'EXISTING HOST AUTHORITY\n')
                    args.insert(args.index('--apply'), 'meta'); args += ['--mode', mode]
                self.command(*args)
                keep = {host / 'AGENTS.md': (host / 'AGENTS.md').read_bytes(),
                        host / 'modules/research/user-notes.md': b'PRIVATE NOTE\n',
                        host / 'research-runs/old.cost.json': b'UNMEASURED HISTORICAL COST\n',
                        host / 'client/config.toml': b'USER CLIENT CONFIG\n'}
                for path, data in keep.items():
                    path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
                review = host / 'modules/research/proactive/review.py'
                original = review.read_bytes(); review.write_bytes(original + b'\n# Local edit\n')
                conflict = w.install(ROOT, host, 'upgrade', [], True)
                self.assertFalse(conflict['applied']); self.assertTrue(conflict['conflicts'])
                self.assertEqual(w.state(host)['version'], '1.10.0')
                self.assertFalse((host / 'modules/research/proactive/cost.py').exists())
                review.write_bytes(original)
                result = w.install(ROOT, host, 'upgrade', [], True)
                self.assertTrue(result['applied']); self.assertEqual(w.state(host)['version'], '1.11.0')
                cost = host / 'modules/research/proactive/cost.py'
                self.assertTrue(cost.is_file())
                summary = self.command(sys.executable, '-X', 'utf8', '-B', cost, 'mark', '--runs',
                                       host / 'new-observations', '--route', 'research',
                                       '--scheduled-date', '2026-10-14', '--phase', 'discovery')
                self.assertEqual(summary['status'], 'open'); self.assertIsNone(summary['monetary_cost'])
                self.assertTrue(w.rollback(host, result['transaction'], True)['applied'])
                self.assertEqual(w.state(host)['version'], '1.10.0')
                self.assertFalse(cost.exists())
                self.assertTrue((host / 'new-observations/2026-10-14-research.cost.json').exists())
                for path, data in keep.items():
                    self.assertEqual(data, path.read_bytes())


if __name__ == '__main__':
    unittest.main()
