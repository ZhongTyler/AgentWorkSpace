"""Frozen 1.30.0 recipient use and real 1.29.0 recovery."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from release_history import published_bundle

class WorkspaceMethodsRelease(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cache=tempfile.TemporaryDirectory()
        cls.bundle=ROOT if w.catalog(ROOT)['version']=='1.30.0' else published_bundle(ROOT,'1.30.0',Path(cls.cache.name)/'frozen')
    @classmethod
    def tearDownClass(cls):cls.cache.cleanup()
    def command(self,*args,env=None):
        result=subprocess.run(list(map(str,args)),env=env,capture_output=True)
        self.assertEqual(result.returncode,0,(result.stdout+result.stderr).decode('utf8','replace'))
        return result
    def pick(self,host,*args):
        return json.loads(self.command(sys.executable,'-X','utf8','-B',host/'modules/skills/scripts/skills.py',*args,'--target',host).stdout)
    def test_four_methods_install_in_both_clients_without_other_modules(self):
        with tempfile.TemporaryDirectory() as temporary:
            host=Path(temporary)/'host';host.mkdir();authority=host/'AGENTS.md';authority.write_bytes(b'HOST AUTHORITY')
            w.install(self.bundle,host,'init',['skills'],True,mode='compatible')
            names=['task-tooling','research-collection','game-evidence-collection','opportunity-flow']
            for platform,directory in [('codex','.agents'),('codebuddy','.codebuddy')]:
                result=self.pick(host,'install','--platform',platform,'--names',*names,'--apply');self.assertTrue(result['applied'])
                for name in names:self.assertTrue((host/directory/'skills'/name/'SKILL.md').is_file())
                self.assertTrue((host/directory/'skills/opportunity-flow/references/opportunity-flow.md').is_file())
            self.assertEqual(authority.read_bytes(),b'HOST AUTHORITY')
            self.assertEqual(sorted(folder.name for folder in (host/'modules').iterdir()),['skills'])
    def test_real_predecessor_upgrade_conflict_and_reverse_preserve_project_copies(self):
        with tempfile.TemporaryDirectory() as temporary:
            base=Path(temporary);old=published_bundle(ROOT,'1.29.0',base/'old')
            for mode in ['full','compatible']:
                host=base/mode;host.mkdir()
                if mode=='compatible':(host/'AGENTS.md').write_bytes(b'HOST AUTHORITY')
                selection=['skills','knowledge','research','game-presentation','game-project']
                if mode=='compatible':selection.insert(0,'meta')
                w.install(old,host,'init',selection,True,mode=mode)
                authority=(host/'AGENTS.md').read_bytes();private=host/'private.txt';private.write_bytes(b'PRIVATE CANARY')
                project=base/(mode+'-existing-project')
                self.command(sys.executable,'-B',host/'modules/game-project/scripts/create-project.py','--target',project,'--name','Existing','--id',mode+'-existing','--apply')
                old_project_readme=(project/'README.md').read_bytes()
                self.pick(host,'install','--names','human-research-expression','--apply')
                changed=host/'modules/knowledge/README.md';original=changed.read_bytes();changed.write_bytes(original+b'\nOWNER EDIT')
                self.assertTrue(w.install(self.bundle,host,'upgrade',[],True)['conflicts']);self.assertEqual(changed.read_bytes(),original+b'\nOWNER EDIT');changed.write_bytes(original)
                package=w.install(self.bundle,host,'upgrade',[],True);self.assertTrue(package['applied'])
                client=self.pick(host,'upgrade','--apply');self.assertTrue(client['applied'])
                added=self.pick(host,'install','--names','task-tooling','--apply');self.assertTrue(added['applied'])
                method='.agents/skills/anti-defensive-writing/HOST-ADAPTER.md' if mode=='full' else 'modules/meta/.agents/skills/anti-defensive-writing/HOST-ADAPTER.md'
                self.assertTrue((host/method).is_file())
                self.assertEqual((project/'README.md').read_bytes(),old_project_readme)
                self.pick(host,'rollback','--transaction',added['transaction'],'--apply');self.pick(host,'rollback','--transaction',client['transaction'],'--apply')
                self.assertTrue(w.rollback(host,package['transaction'],True)['applied'])
                self.assertEqual(w.state(host)['version'],'1.29.0');self.assertEqual((host/'AGENTS.md').read_bytes(),authority);self.assertEqual(private.read_bytes(),b'PRIVATE CANARY')
                self.assertEqual((project/'README.md').read_bytes(),old_project_readme)
    def test_knowledge_query_without_feedback_or_other_packages(self):
        with tempfile.TemporaryDirectory() as temporary:
            host=Path(temporary)/'host';host.mkdir()
            authority=host/'AGENTS.md';authority.write_text('Follow user goals and authority. Preserve scope and private data. Verify facts and results. Deliver within scope and retain recovery evidence.\n',encoding='utf8')
            contract=json.loads((self.bundle/'compatibility.json').read_text('utf8'))
            profile={'schema_version':1,'providers':[{'id':'fixture-host','capabilities':['host-governance'],'assurance':'reviewed','reason':'Synthetic host covers the four declared governance criteria','checks':{'host-governance':contract['capabilities']['host-governance']['criteria']},'evidence':[{'path':'AGENTS.md','sha256':w.digest(authority.read_bytes())}]}]}
            self.assertTrue(w.install(self.bundle,host,'init',['knowledge'],True,mode='compatible',profile=profile)['applied'])
            data=Path(temporary)/'data';(data/'wiki').mkdir(parents=True);(data/'wiki/demo.md').write_text('# Synthetic\n\nA synthetic condition.\n',encoding='utf8')
            module=(host/'modules/knowledge/system/query/query-evidence.mjs').as_uri()
            program='import {createEvidenceQuery} from '+json.dumps(module)+'; const q=createEvidenceQuery({root:'+json.dumps(str(data))+'}); const request={need:{kind:"understanding",question:"synthetic condition"},terms:["synthetic"]}; console.log(JSON.stringify(q.readSource({request,ref:"knowledge:wiki:demo",selection:{mode:"full"}})));'
            result=json.loads(self.command('node','--input-type=module','--eval',program).stdout);self.assertEqual(result['status'],'source_read')
            self.assertFalse((host/'modules/tools').exists());self.assertFalse((host/'modules/meta').exists())
    def test_distributed_core_retains_unsupported_closure_pending(self):
        env=dict(os.environ,FEEDBACK_TOOLS_ROOT=str(self.bundle/'packages/tools'))
        result=self.command('node','--test',self.bundle/'packages/knowledge/tests/query-package.contract.mjs',env=env)
        text=result.stdout.decode('utf8','replace');self.assertIn('feedback Core',text);self.assertIn('legacy Core retains a verified fix pending',text)
    def test_project_template_and_review_boundaries(self):
        with tempfile.TemporaryDirectory() as temporary:
            target=Path(temporary)/'project'
            result=json.loads(self.command(sys.executable,'-B',self.bundle/'packages/game-project/scripts/create-project.py','--target',target,'--name','New project','--id','new-project','--apply').stdout)
            self.assertEqual(result['template_version'],'0.2.11');self.assertTrue((target/'assets/index.html').is_file())
            self.assertTrue((target/'maintenance/scripts/asset-atlas-store.mjs').is_file())
            self.command('node','--test',self.bundle/'packages/game-presentation/tests/resource-review-boundaries.test.mjs')
    def test_unknown_template_html_and_command_files_stay_outside_public_whitelist(self):
        from publish import stage
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temporary:
            source=Path(temporary)/'source';(source/'release-input').mkdir(parents=True)
            for target in ['template/assets/other.html','template/maintenance/previews/other.cmd']:
                (source/'release-input/manifest.json').write_text(json.dumps({'release_schema':1,'component_id':'game-project','output_path':'packages/game-project','copy_files':[{'source':target,'target':target,'sha256':'a'*64}],'expected_file_count':1}),encoding='utf8')
                with patch('publish.git',side_effect=AssertionError('Unreviewed paths must fail before Git')):
                    with self.assertRaisesRegex(w.ContractError,'whitelist'):stage(source,Path(temporary)/'rejected')

if __name__=='__main__':unittest.main()
