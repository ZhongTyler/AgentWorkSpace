"""Portable method routes and ownership across real previous-version upgrades."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from release_history import published_bundle

class InterfaceDesignRelease(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cache=tempfile.TemporaryDirectory(prefix='interface-frozen-')
        tag=subprocess.run(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'rev-parse','--verify','refs/tags/v1.23.0'],capture_output=True)
        if tag.returncode==0:
            cls.bundle=published_bundle(ROOT,'1.23.0',pathlib.Path(cls.cache.name)/'bundle')
        else:
            # Only the not-yet-published 1.23.0 candidate may use working bytes.
            assert w.catalog(ROOT)['version']=='1.23.0'
            cls.bundle=ROOT

    @classmethod
    def tearDownClass(cls):cls.cache.cleanup()

    def skill(self,host,platform,*args,ok=True):
        p=subprocess.run([sys.executable,'-X','utf8','-B',str(host/'modules/skills/scripts/skills.py'),*args,'--target',str(host),'--platform',platform],capture_output=True)
        self.assertEqual(p.returncode==0,ok,(p.stdout+p.stderr).decode('utf8','replace'))
        return json.loads(p.stdout)

    def test_scope_portability_and_standalone_skill(self):
        current=w.catalog(self.bundle)
        old=json.loads(subprocess.check_output(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'show','v1.22.1:catalog.json']))
        self.assertEqual({'meta','skills'},{k for k,v in current['components'].items() if v['files']!=old['components'][k]['files']})
        method=(self.bundle/'meta/workspace/collaboration/interface-design.md').read_text('utf8')
        for forbidden in ('E:/TylerWorkSpace','C:\\Users\\Admin','codex://threads/','78bc3ab','Tools/integrations/gamehot','runtime/design-reuse'):
            for p in [self.bundle/'meta/workspace/collaboration/interface-design.md',self.bundle/'packages/skills/integrations/prototype.md']:
                self.assertNotIn(forbidden,p.read_text('utf8'))
        self.assertIn('代表内容',method)
        for name in ('workflow-redesign','reference-deconstruction'):
            self.assertEqual((self.bundle/f'meta/workspace/.agents/skills/{name}/SKILL.md').read_bytes(),(self.bundle/f'packages/skills/library/{name}/SKILL.md').read_bytes())
        with tempfile.TemporaryDirectory(prefix='interface-standalone-') as tmp:
            host=pathlib.Path(tmp)/'host';host.mkdir()
            (host/'AGENTS.md').write_bytes(b'EXISTING HOST AUTHORITY\n')
            self.assertTrue(w.install(self.bundle,host,'init',['skills'],True,mode='compatible')['applied'])
            self.assertFalse((host/'modules/meta').exists())
            self.assertTrue(self.skill(host,'codex','install','--names','game-presentation','--apply')['applied'])
            text=(host/'.agents/skills/game-presentation/SKILL.md').read_text('utf8')
            self.assertIn('/blob/v1.23.0/meta/workspace/collaboration/interface-design.md',text)
            self.assertFalse((host/'.agents/skills/prototype').exists())
            self.assertFalse((host/'modules/tools').exists())
            self.assertEqual(b'EXISTING HOST AUTHORITY\n',(host/'AGENTS.md').read_bytes())

    def test_real_predecessor_routes_conflicts_and_recovery(self):
        with tempfile.TemporaryDirectory(prefix='interface-upgrade-') as tmp:
            tmp=pathlib.Path(tmp);old=published_bundle(ROOT,'1.22.1',tmp/'old')
            for mode in ('full','compatible'):
                host=tmp/mode;host.mkdir()
                canaries={host/'private.md':b'PRIVATE USER DATA\r\n',host/'.agents/skills/frontend-design/SKILL.md':b'EXTERNAL VISUAL METHOD\nFONT HOOK\nINTERACTION HOOK\n',host/'.agents/skills/prototype/SKILL.md':b'EXTERNAL PROTOTYPE AND LOCAL ADAPTER\n'}
                if mode=='compatible':canaries[host/'AGENTS.md']=b'HOST AUTHORITY\n'
                for p,data in canaries.items():p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
                self.assertTrue(w.install(old,host,'init',['skills']+(['meta'] if mode=='compatible' else []),True,mode=mode)['applied'])
                # Select only one affected Skill; other meta built-ins retain workspace ownership.
                selected={}
                for platform,folder in [('codex','.agents'),('codebuddy','.codebuddy')]:
                    self.assertTrue(self.skill(host,platform,'install','--names','game-presentation','--apply')['applied'])
                    selected[platform]=(host/folder/'skills/game-presentation/SKILL.md').read_bytes()
                plan=w.install(self.bundle,host,'upgrade',[])
                self.assertFalse(plan['applied']);self.assertFalse(plan['conflicts'])
                update=w.install(self.bundle,host,'upgrade',[],True);self.assertTrue(update['applied'])
                method=host/('modules/meta/' if mode=='compatible' else '')/'collaboration/interface-design.md'
                self.assertTrue(method.is_file())
                for platform,folder in [('codex','.agents'),('codebuddy','.codebuddy')]:
                    entry=host/folder/'skills/game-presentation/SKILL.md'
                    self.assertEqual(selected[platform],entry.read_bytes())
                    entry.write_bytes(selected[platform]+b'\nLOCAL EDIT\n')
                    self.assertTrue(self.skill(host,platform,'upgrade','--apply',ok=False)['conflicts'])
                    self.assertEqual(selected[platform]+b'\nLOCAL EDIT\n',entry.read_bytes())
                    entry.write_bytes(selected[platform])
                    step=self.skill(host,platform,'upgrade','--apply');self.assertTrue(step['applied'])
                    current=entry.read_bytes();self.assertIn(b'/blob/v1.23.0/',current)
                    entry.write_bytes(current+b'\nAFTER UPGRADE\n')
                    self.assertTrue(self.skill(host,platform,'rollback','--transaction',step['transaction'],'--apply',ok=False)['conflicts'])
                    self.assertEqual(current+b'\nAFTER UPGRADE\n',entry.read_bytes());entry.write_bytes(current)
                    self.assertTrue(self.skill(host,platform,'rollback','--transaction',step['transaction'],'--apply')['applied'])
                    self.assertEqual(selected[platform],entry.read_bytes())
                original=method.read_bytes();method.write_bytes(original+b'\nHOST CUSTOMIZATION\n')
                self.assertTrue(w.rollback(host,update['transaction'],True)['conflicts'])
                self.assertEqual(original+b'\nHOST CUSTOMIZATION\n',method.read_bytes());method.write_bytes(original)
                self.assertTrue(w.rollback(host,update['transaction'],True)['applied'])
                self.assertFalse(method.exists());self.assertEqual('1.22.1',w.state(host)['version'])
                for p,data in canaries.items():self.assertEqual(data,p.read_bytes())

if __name__=='__main__':unittest.main()
