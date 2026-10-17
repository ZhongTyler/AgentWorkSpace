"""Synthetic recipient setup, HTTP lazy startup and isolated session cleanup."""
import json, os, shutil, socket, subprocess, sys, tempfile, time, tomllib, unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import ProxyHandler, Request, build_opener

HERE=Path(__file__).resolve().parent
SCRIPTS=HERE if (HERE/'demand_portable_install.py').exists() else HERE.parent/'scripts'
sys.path.insert(0,str(SCRIPTS))
import demand_portable_install as setup
from demand_common import pack
from demand_http_headers import headers, ProcessOwner

def powershell():
    bundled=Path(os.environ.get('USERPROFILE',''))/'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
    return str(bundled) if bundled.is_file() else shutil.which('pwsh') or shutil.which('powershell')

class Client:
    def __init__(self,home,port,owner):
        self.url=f'http://127.0.0.1:{port}/mcp/sample'
        self.auth=headers(home,owner)
        self.open=build_opener(ProxyHandler({})).open
        response=self.post({'jsonrpc':'2.0','id':0,'method':'initialize','params':{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'recipient-fixture','version':'1'}}})
        self.auth['Mcp-Session-Id']=response.headers['Mcp-Session-Id']
        assert 'result' in json.load(response)
        response.close()
    def post(self,msg):
        return self.open(Request(self.url,data=pack(msg),headers={**self.auth,'Content-Type':'application/json','Accept':'application/json, text/event-stream'}),timeout=15)
    def rpc(self,method,params=None):
        with self.post({'jsonrpc':'2.0','id':1,'method':method,'params':params or {}}) as response:
            if response.headers['Content-Type']=='application/json':
                return json.load(response)
            for line in response:
                if line.startswith(b'data: '):
                    item=json.loads(line[6:])
                    if item.get('id')==1 and 'method' not in item:return item
        raise AssertionError('No RPC result')
    def call(self):
        r=self.rpc('tools/call',{'name':'probe','arguments':{}})
        return json.loads(r['result']['content'][0]['text'])
    def close(self):
        with self.open(Request(self.url,method='DELETE',headers=self.auth),timeout=5) as r:
            assert r.status==200

class PortableTests(unittest.TestCase):
    def fixture(self,base):
        config=base/'client.toml'
        entry=base/'native.py';entry.write_bytes((HERE/'demand_fixture.py').read_bytes())
        spec={'command':sys.executable,'args':['-B',str(entry)],'enabled':False,'disabled_tools':['write'],
              'tool_timeout_sec':20,'env':{'LOCAL_FIXTURE_SECRET':'secret-canary'},'tools':{'probe':{'approval_mode':'prompt'}}}
        config.write_text('# host rules\n'+setup.render('sample',spec)+'[other]\nvalue=1\n',encoding='utf8')
        with socket.socket() as s:
            s.bind(('127.0.0.1',0));port=s.getsockname()[1]
        settings=setup.plan(base/'private-runtime',config,['sample'],port=port,powershell=powershell())
        return config,entry,settings

    def test_plan_is_readonly_and_rejects_invalid_selection(self):
        with tempfile.TemporaryDirectory() as t:
            base=Path(t);config,entry,s=self.fixture(base)
            before=config.read_bytes()
            self.assertFalse(Path(s['home']).exists())
            self.assertEqual(before,config.read_bytes())
            for kw in ({'profiles':['missing']},{'profiles':['sample','sample']},{'shared':['missing']},{'home':base/'modules/runtime'}):
                args=dict(home=base/'another',config=config,profiles=['sample'],powershell=powershell());args.update(kw)
                with self.assertRaises(ValueError):setup.plan(**args)

    def test_remote_and_existing_owner_are_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            base=Path(t);config,entry,s=self.fixture(base)
            for spec in ({'url':'https://example.invalid/mcp'},{'command':sys.executable,'experimental_environment':'remote'},
                         {'command':sys.executable,'args':['demand_proxy.py']}):
                config.write_text(setup.render('sample',spec),encoding='utf8')
                with self.assertRaises(ValueError):setup.plan(base/'new',config,['sample'],powershell=powershell())

    def test_unload_version_guard_and_shorter_setting(self):
        with tempfile.TemporaryDirectory() as t:
            base=Path(t);config,entry,s=self.fixture(base)
            args=dict(home=base/'new',config=config,profiles=['sample'],powershell=powershell(),unload=120,codex=sys.executable)
            with patch.object(setup.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'wrong version')):
                with self.assertRaises(ValueError):setup.plan(**args)
            with patch.object(setup.subprocess,'run',return_value=subprocess.CompletedProcess([],0,setup.SUPPORTED_CORE)):
                self.assertEqual(120,setup.plan(**args)['unload'])
                config.write_text('thread_unload_delay_secs = 60\n'+config.read_text('utf8'),encoding='utf8')
                with self.assertRaises(ValueError):setup.plan(**args)

    def test_setting_scope_and_owner_conflicts(self):
        records=[{'kind':'setting','original':'','replacement':'thread_unload_delay_secs = 120\n'}]
        raw=b'# root\n[child]\nthread_unload_delay_secs = 120\n'
        changed=setup.rewrite(raw,records)
        self.assertEqual(raw,setup.rewrite(changed,records,True))
        with self.assertRaises(ValueError):setup.rewrite(changed.replace(b'= 120',b'= 121',1),records,True)

    def test_setting_like_text_inside_literal_is_not_mutated(self):
        raw=b"host_note='''\nthread_unload_delay_secs = 120\n'''\n[other]\nvalue=1\n"
        records=[{'kind':'setting','original':'thread_unload_delay_secs = 120\n','replacement':'thread_unload_delay_secs = 3\n'}]
        with self.assertRaises(ValueError):setup.rewrite(raw,records)

    @unittest.skipUnless(os.name=='nt','Windows DPAPI and process jobs')
    def test_prepare_apply_check_and_reverse_preserve_other_owner(self):
        with tempfile.TemporaryDirectory() as t:
            base=Path(t);config,entry,s=self.fixture(base);before=config.read_bytes()
            self.assertFalse(setup.prepare(s)['config_modified']);self.assertEqual(before,config.read_bytes())
            home=Path(s['home']).resolve()
            self.assertEqual('stopped',headers(home,start=False)['status'])
            self.assertTrue(setup.apply(home)['applied']);self.assertTrue(setup.check(home)['wiring_unchanged'])
            parsed=tomllib.loads(config.read_text('utf8'))['mcp_servers']['sample']
            self.assertFalse(parsed['enabled']);self.assertEqual(['write'],parsed['disabled_tools'])
            self.assertEqual('prompt',parsed['tools']['probe']['approval_mode'])
            self.assertNotIn('secret-canary',config.read_text('utf8'));self.assertNotIn('secret-canary',(home/'profiles.dpapi').read_bytes().decode('latin1'))
            config.write_bytes(config.read_bytes().replace(b'value=1',b'value=2'))
            self.assertTrue(setup.apply(home,True)['rolled_back'])
            self.assertEqual(before.replace(b'value=1',b'value=2'),config.read_bytes())

    @unittest.skipUnless(os.name=='nt','Windows DPAPI and process jobs')
    def test_frozen_runtime_and_overlap_refuse_writes_native_change_allows_recovery(self):
        with tempfile.TemporaryDirectory() as t:
            base=Path(t);config,entry,s=self.fixture(base);setup.prepare(s);home=Path(s['home']).resolve()
            setup.apply(home);owned=config.read_bytes()
            config.write_bytes(owned.replace(b'tool_timeout_sec',b'custom_timeout_sec'))
            with self.assertRaises(ValueError):setup.apply(home,True)
            edited=config.read_bytes()
            self.assertIn(b'custom_timeout_sec',edited)
            config.write_bytes(owned)
            entry.write_bytes(entry.read_bytes()+b'\n# upstream changed\n')
            with self.assertRaises(ValueError):setup.check(home)
            self.assertTrue(setup.apply(home,True)['rolled_back'])

    @unittest.skipUnless(os.name=='nt','Windows DPAPI and process jobs')
    def test_real_http_lazy_start_owner_exit_and_idle_gateway(self):
        with tempfile.TemporaryDirectory() as t:
            base=Path(t);config,entry,s=self.fixture(base);setup.prepare(s);home=Path(s['home']).resolve()
            setup.apply(home)
            owners=[subprocess.Popen([sys.executable,'-c','import sys;sys.stdin.read()'],stdin=subprocess.PIPE) for _ in range(2)]
            clients=[];processes=[]
            try:
                a,b=[Client(home,s['port'],p.pid) for p in owners];clients=[a,b]
                self.assertEqual('probe',a.rpc('tools/list')['result']['tools'][0]['name'])
                state=headers(home,start=False);self.assertEqual(2,state['sessions']);self.assertEqual([],state['workers'])
                gateway=ProcessOwner(state['pid']);processes.append(gateway)
                pa,pb=a.call(),b.call()
                self.assertNotEqual(pa['pid'],pb['pid']);self.assertEqual((1,1),(pa['value'],pb['value']))
                wa,wb=ProcessOwner(pa['pid']),ProcessOwner(pb['pid']);processes.extend([wa,wb])
                owners[0].stdin.close();owners[0].wait(timeout=5)
                deadline=time.monotonic()+8
                while wa.alive() and time.monotonic()<deadline:time.sleep(.1)
                self.assertFalse(wa.alive());self.assertTrue(wb.alive());self.assertEqual(2,b.call()['value'])
                b.close();clients=[]
                owners[1].stdin.close();owners[1].wait(timeout=5)
                deadline=time.monotonic()+45
                while gateway.alive() and time.monotonic()<deadline:time.sleep(.2)
                self.assertFalse(gateway.alive());self.assertFalse(wb.alive())
                self.assertEqual('stopped',headers(home,start=False)['status'])
            finally:
                for c in clients:
                    try:c.close()
                    except Exception:pass
                for p in owners:
                    if p.poll() is None:p.stdin.close();p.wait(timeout=5)
                for p in processes:p.close()
            self.assertTrue(setup.apply(home,True)['rolled_back'])

if __name__=='__main__':
    unittest.main()
