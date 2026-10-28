import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from demand_app_native_repair import native_manifest, replace_guarded
from demand_http_install import PLUGINS, http_spec


class AppTransportTests(unittest.TestCase):
    def source(self):
        return {'mcpServers': {'codex_app': {'command': 'cmd.exe',
            'args': ['/d', '/s', '/c', 'call', './scripts/launch_codex_app_tools_mcp.cmd', './server.mjs'],
            'env_vars': ['CODEX_APP_TOOLS_PIPE_PATH'], 'tools': {'send_message_to_thread': {'approval_mode': 'prompt'}}}}}

    def test_only_manifest_pointer_changes(self):
        original = {'name': 'codex-app-tools', 'version': '0.1.6', 'mcpServers': './.demand-http.mcp.json', 'license': 'Proprietary'}
        source = self.source(); frozen = json.dumps(source)
        result = json.loads(native_manifest(json.dumps(original).encode(), source))
        self.assertEqual(result, {**original, 'mcpServers': './.mcp.json'})
        self.assertEqual(json.dumps(source), frozen)

    def test_future_http_install_rejects_host_bound_capability(self):
        self.assertNotIn('plugin-codex-app', [entry[0] for entry in PLUGINS])
        for name, spec in [('plugin-codex-app', {}), ('another-name', self.source()['mcpServers']['codex_app']),
                           ('renamed', {'env_vars': [{'name': 'CODEX_APP_TOOLS_PIPE_PATH', 'source': 'local'}]}),
                           ('captured', {'env': {'CODEX_APP_TOOLS_PIPE_PATH': 'must-not-freeze'}})]:
            with self.assertRaises(ValueError):
                http_spec(spec, 'helper', 1234, name)

    def test_unknown_manifest_owner_or_launcher_is_preserved(self):
        valid = {'name': 'codex-app-tools', 'version': '0.1.6', 'mcpServers': './.demand-http.mcp.json'}
        with self.assertRaises(ValueError):
            native_manifest(json.dumps({**valid, 'mcpServers': './other.json'}).encode(), self.source())
        source = self.source(); source['mcpServers']['codex_app']['args'] = ['other']
        with self.assertRaises(ValueError):
            native_manifest(json.dumps(valid).encode(), source)

    def test_exact_rollback_and_concurrent_change_guard(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'plugin.json'; path.write_bytes(b'before')
            replace_guarded(path, b'before', b'after')
            with self.assertRaises(ValueError):
                replace_guarded(path, b'before', b'bad')
            self.assertEqual(path.read_bytes(), b'after')
            replace_guarded(path, b'after', b'before')
            self.assertEqual(path.read_bytes(), b'before')


if __name__ == '__main__':
    unittest.main()
