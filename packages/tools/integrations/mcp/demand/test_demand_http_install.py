import json
import hashlib
from pathlib import Path
import sys
import unittest
import tempfile

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from demand_http_install import apply, check, config_change, http_spec, render
from demand_common import atomic_json, digest, private_write


class ConfigTests(unittest.TestCase):
    def test_roundtrip_preserves_other_owner_edits_and_policy(self):
        original = '[mcp_servers.owned]\ncommand="python"\ndisabled_tools=["write"]\n\n'
        replacement = render('owned', http_spec({'command': 'python', 'disabled_tools': ['write'], 'tools': {'read': {'approval_mode': 'prompt'}}}, 'helper', 1234, 'owned'))
        records = [{'kind': 'section', 'name': 'owned', 'original': original, 'replacement': replacement},
                   {'kind': 'setting', 'original': '', 'replacement': 'thread_unload_delay_secs = 120\n'}]
        raw = b'# owner\n' + original.encode() + b'[other]\nvalue=1\n'
        result = config_change(raw, records)
        self.assertIn(b'disabled_tools = ["write"]', result)
        result = result.replace(b'value=1', b'value=2')
        restored = config_change(result, records, True)
        self.assertEqual(restored, raw.replace(b'value=1', b'value=2'))

    def test_overlapping_owner_changes_are_rejected(self):
        records = [{'kind': 'section', 'name': 'owned', 'original': '[mcp_servers.owned]\ncommand="python"\n', 'replacement': 'unused'}]
        with self.assertRaises(ValueError):
            config_change(b'[mcp_servers.owned]\ncommand="other-owner"\n', records)

    def test_local_transport_preserves_tool_rules(self):
        spec = http_spec({'command': 'old', 'args': ['old'], 'env': {'SECRET': 'private'},
                          'enabled': False, 'enabled_tools': ['read'], 'tool_timeout_sec': 90,
                          'tools': {'read': {'approval_mode': 'prompt'}}}, 'helper', 1234, 'name')
        self.assertNotIn('env', spec)
        self.assertFalse(spec['enabled'])
        self.assertEqual(spec['tools']['read']['approval_mode'], 'prompt')
        self.assertEqual(spec['tool_timeout_sec'], 90)

    def test_remote_placement_is_not_silently_changed(self):
        with self.assertRaises(ValueError):
            http_spec({'experimental_environment': 'remote'}, 'helper', 1234, 'name')

    def prepared(self, folder):
        runtime = folder / 'runtime/test'; runtime.mkdir(parents=True)
        (runtime / 'fixture.py').write_bytes(b'# test\n')
        entry = folder / 'cua.mjs'; entry.write_bytes(b'// unchanged\n')
        config = folder / 'config.toml'
        original = '[mcp_servers.fixture]\ncommand="old"\n\n'
        replacement = render('fixture', {'url': 'http://127.0.0.1:1/mcp'})
        config.write_bytes((original + '[other]\nvalue=1\n').encode('utf-8'))
        manifest = folder / 'plugin.json'; manifest.write_text('{"name":"fixture"}', encoding='utf-8')
        target = folder / 'transport.json'
        profiles = {'profiles': {}}; settings = {'port': 1}
        private_write(folder / 'profiles.dpapi', profiles); private_write(folder / 'http.dpapi', settings)
        atomic_json(folder / 'prepared.json', {'runtime_revision': 'test', 'runtime_sha256': {'fixture.py': hashlib.sha256(b'# test\n').hexdigest()},
            'cua_entry': str(entry), 'cua_entry_sha256': hashlib.sha256(entry.read_bytes()).hexdigest(),
            'manifest_sha256': digest(profiles), 'http_sha256': digest(settings), 'review_sha256': {}})
        private_write(folder / 'changes.dpapi', {'config': str(config), 'records': [
            {'kind': 'section', 'name': 'fixture', 'original': original, 'replacement': replacement},
            {'kind': 'setting', 'original': '', 'replacement': 'thread_unload_delay_secs = 120\n'}],
            'plugins': [{'path': str(manifest), 'original': '{"name":"fixture"}', 'replacement': '{"name":"fixture","mcpServers":"new"}',
                         'transport': str(target), 'transport_contents': '{}\n'}]})
        return config, manifest, target

    def test_apply_audit_and_rollback_preserve_new_unrelated_edit(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory); config, manifest, target = self.prepared(folder)
            before = config.read_bytes(); apply(folder)
            self.assertTrue(check(folder)['wiring_unchanged'])
            config.write_bytes(config.read_bytes().replace(b'value=1', b'value=2'))
            apply(folder, True)
            self.assertEqual(config.read_bytes(), before.replace(b'value=1', b'value=2'))
            self.assertEqual(manifest.read_bytes(), b'{"name":"fixture"}')
            self.assertTrue(target.is_file())

    def test_plugin_owner_overlap_is_rejected_before_any_write(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory); config, manifest, target = self.prepared(folder)
            before = config.read_bytes(); manifest.write_text('{"name":"other-owner"}', encoding='utf-8')
            with self.assertRaises(ValueError):
                apply(folder)
            self.assertEqual(config.read_bytes(), before)
            self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
