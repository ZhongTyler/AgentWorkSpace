"""Synthetic canary only; never inspect an actual user's .env."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

server=Path(__file__).resolve().with_name('server.py')
with tempfile.TemporaryDirectory() as tmp:
    (Path(tmp)/'.env').write_bytes(b'\xff\xfe\x00SYNTHETIC_CANARY')
    code='''import sys, pathlib
def audit(event,args):
    if event=='open' and isinstance(args[0],(str,bytes)) and pathlib.Path(args[0]).name=='.env':
        raise RuntimeError('unexpected_dotenv_read')
sys.addaudithook(audit)
sys.path.insert(0,sys.argv[1])
import server
assert server.mcp.settings.model_config['env_file'] is None
print('synthetic dotenv was not opened')
'''
    p=subprocess.run([sys.executable,'-X','utf8','-B','-c',code,str(server.parent)],cwd=tmp,text=True,encoding='utf-8',capture_output=True)
    if p.returncode:print(p.stderr);raise SystemExit(p.returncode)
    print(p.stdout.strip())
