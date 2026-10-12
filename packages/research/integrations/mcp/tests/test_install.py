import importlib.util
import json
from pathlib import Path
import tempfile
import tomllib
import unittest

BASE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('installer', BASE / 'scripts/install.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.servers = json.loads((BASE / 'servers.json').read_text())['servers']
        self.names = [s['id'] for s in self.servers]
        self.block = module.render(Path('/a path/runtime'), '/runtime/node', self.servers)

    def test_preserve_existing_settings_and_credentials(self):
        old = 'model = "keep-model"\n[mcp_servers.existing.env]\nPRIVATE_TOKEN = "synthetic-test-secret"\n'
        merged = module.merge(old, self.block, self.names)
        parsed = tomllib.loads(merged)
        self.assertEqual(parsed['model'], 'keep-model')
        self.assertEqual(parsed['mcp_servers']['existing']['env']['PRIVATE_TOKEN'], 'synthetic-test-secret')

    def test_repeat_install_is_idempotent(self):
        first = module.merge('model="keep"\n', self.block, self.names)
        self.assertEqual(first, module.merge(first, self.block, self.names))

    def test_refuse_unowned_collision(self):
        with self.assertRaises(ValueError):
            module.merge('[mcp_servers.research-hn]\ncommand="other-owner"\n', self.block, self.names)

    def test_refuse_broken_ownership_markers(self):
        with self.assertRaises(ValueError):
            module.merge(module.BEGIN + '\n', self.block, self.names)

    def test_only_read_tools_and_pending_auth_disabled(self):
        config = tomllib.loads(self.block)['mcp_servers']
        denied = ['publish', 'create', 'delete', 'remove', 'like', 'favorite', 'comment_to', 'remember', 'subscribe']
        for server in config.values():
            for tool in server['enabled_tools']:
                self.assertFalse(any(word in tool for word in denied), tool)
        for name in ['v2ex', 'github', 'stackoverflow', 'zhihu', 'xiaohongshu']:
            self.assertFalse(config['research-' + name]['enabled'])
        if module.os.name != 'nt':
            self.assertEqual(config['research-zhihu']['bearer_token_env_var'], 'ZHIHU_ACCESS_SECRET')
        else:
            self.assertIn('launch-auth.mjs', config['research-zhihu']['args'][0])

    def test_reapply_keeps_local_connection_enabled_state(self):
        local = self.block.replace('[mcp_servers.research-v2ex]', '[mcp_servers.research-v2ex]', 1)
        local = local.replace('enabled = false', 'enabled = true', 1)
        merged = module.merge(local, self.block, self.names)
        self.assertTrue(tomllib.loads(merged)['mcp_servers']['research-v2ex']['enabled'])
        self.assertFalse(tomllib.loads(merged)['mcp_servers']['research-zhihu']['enabled'])

    def test_catalog_covered_and_rss_shared(self):
        sources = json.loads((BASE.parents[1] / 'sources.json').read_text(encoding='utf-8'))['sources']
        self.assertEqual(len(sources), 11)
        self.assertEqual({s['mcp'] for s in sources}, set(self.names))

    def test_archives_match_recorded_content(self):
        module.verify_archives()


if __name__ == '__main__':
    unittest.main()
