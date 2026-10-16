import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import release_metadata as release


class ReleaseMetadata(unittest.TestCase):
    def test_api_readback_rejects_wrong_version_and_old_naming(self):
        for name in ('AgentWorkSpace1.18.0 · Answer qualifier review',
                     '1.18.0 · Answer qualifier review',
                     'v1.18.0 - Answer qualifier review',
                     'v1.17.0 — Answer qualifier review'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                release.check({'tag_name': 'v1.18.0', 'name': name})
        release.check({'tag_name': 'v1.18.0', 'name': 'v1.18.0 — Answer qualifier review',
                       'body': 'Existing notes and extra API fields are allowed', 'id': 42})

    def test_invalid_identity_and_ambiguous_summary_fail_closed(self):
        for tag in ('1.2.3', 'v01.2.3', 'v1.2', 'v1.2.3\n', 'v1.2.3-rc.1'):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                release.title(tag, 'Travel')
        for summary in ('', ' Travel', 'Travel\nTools', 'Travel  tools', 'Travel\ttools',
                        'Travel\x00tools', '中文', 'AgentWorkSpace Travel', 'Travel v1.2.3', 'A' * 73):
            with self.subTest(summary=summary), self.assertRaises(ValueError):
                release.title('v1.2.3', summary)

    def test_creation_preserves_notes_and_matches_readback_contract(self):
        notes = '## 中文\n\n按需使用。\n\n## English\n\nOptional; not enabled on install.\n'
        payload = release.create_payload('v1.20.0', 'Optional interactive explanations', notes)
        self.assertEqual(payload['body'], notes)
        self.assertEqual(payload['tag_name'], 'v1.20.0')
        self.assertFalse(payload['draft'])
        self.assertFalse(payload['prerelease'])
        release.check(payload)
        with self.assertRaises(ValueError):
            release.create_payload('v1.20.0', 'Travel', '  ')

    def test_cli_checks_entire_list_and_reports_failures(self):
        good = release.create_payload('v1.20.0', 'Travel', 'Notes')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'releases.json'
            for data, expected in (([good], 0), ([], 2), ([good, {'tag_name': 'v1.19.0', 'name': 'Bad'}], 2)):
                path.write_text(json.dumps(data), encoding='utf-8')
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(release.main(['check', '--file', str(path)]), expected)


if __name__ == '__main__':
    unittest.main(verbosity=2)
