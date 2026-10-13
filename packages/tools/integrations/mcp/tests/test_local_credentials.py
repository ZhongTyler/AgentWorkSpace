import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('local_entry', BASE / 'scripts/connect-local.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@unittest.skipUnless(os.name == 'nt', 'Windows DPAPI interoperability')
class LocalCredentialTests(unittest.TestCase):
    def test_python_encryption_is_readable_by_powershell_current_user(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'ZHIHU_ACCESS_SECRET.dpapi'
            synthetic = 'synthetic-credential-only-测试'
            encrypted = module.protect(synthetic)
            self.assertNotIn(synthetic.encode('utf-8'), encrypted)
            target.write_bytes(encrypted)
            shell = shutil.which('pwsh') or shutil.which('powershell.exe')
            script = "Add-Type -AssemblyName System.Security; $v=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($env:TEST_DPAPI_FILE),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)); if($v -eq $env:TEST_SYNTHETIC_VALUE){'roundtrip-ok'}else{exit 1}"
            env = dict(os.environ, TEST_DPAPI_FILE=str(target), TEST_SYNTHETIC_VALUE=synthetic)
            result = subprocess.run([shell, '-NoProfile', '-Command', script], env=env, capture_output=True, text=True, check=True)
            self.assertEqual(result.stdout.strip(), 'roundtrip-ok')
            check = subprocess.run([shell, '-NoProfile', '-File', str(BASE / 'scripts/launch-auth.ps1'),
                                    '-Server', 'research-zhihu', '-Runtime', folder, '-Node', 'unused',
                                    '-SecretDirectory', folder, '-Check'], capture_output=True, text=True, check=True)
            self.assertEqual(check.stdout.strip(), 'True')
            node = shutil.which('node')
            check_node = subprocess.run([node, str(BASE / 'scripts/launch-auth.mjs'), 'research-zhihu', shell,
                                         '--secret-directory', folder, '--check'], capture_output=True, text=True, check=True)
            self.assertEqual(check_node.stdout.strip(), 'True')


if __name__ == '__main__':
    unittest.main()
