"""Optional game support package/selected-skill integration and recovery."""
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
import workspace as w


class GameSupportRelease(unittest.TestCase):
    def command(self, *args, ok=True):
        result = subprocess.run([str(v) for v in args], capture_output=True, text=True, encoding='utf-8')
        if ok:
            self.assertEqual(0, result.returncode, result.stderr + result.stdout)
        else:
            self.assertNotEqual(0, result.returncode)
        return json.loads(result.stdout) if result.stdout else None

    def skill(self, bundle, host, *args, ok=True):
        return self.command(sys.executable, '-X', 'utf8', '-B', bundle/'scripts/skills.py',
            *args, '--target', host, ok=ok)

    def test_skill_only_without_research_or_rea(self):
        with tempfile.TemporaryDirectory(prefix='game-support-optional-') as tmp:
            host = Path(tmp)/'host';host.mkdir()
            rules = host/'AGENTS.md';rules.write_bytes(b'Existing host rules.\n')
            self.assertTrue(w.install(ROOT, host, 'init', ['skills'], True, mode='compatible')['applied'])
            bundle = host/'modules/skills'
            result = self.skill(bundle, host, 'install', '--names', 'game-decision-support', '--apply')
            self.assertTrue(result['applied'])
            self.assertEqual({'skills'}, set(w.state(host)['components']))
            self.assertFalse((host/'modules/research').exists())
            self.assertFalse((host/'.codex').exists())
            self.assertFalse((host/'.agents/skills/rea-investigate').exists())
            self.assertEqual(b'Existing host rules.\n', rules.read_bytes())
            cat = w.catalog(ROOT)
            self.assertEqual([], cat['components']['skills']['required'])
            self.assertEqual([], cat['components']['research']['required'])

    def test_actual_170_package_then_selected_skill_upgrade_and_reverse_recovery(self):
        with tempfile.TemporaryDirectory(prefix='game-support-upgrade-') as tmp:
            base=Path(tmp);old=base/'old';old.mkdir()
            data=subprocess.run(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),
                'archive','v1.7.0'],capture_output=True,check=True).stdout
            with tarfile.open(fileobj=io.BytesIO(data)) as archive:
                for entry in archive:
                    if entry.isfile():
                        target=w.safe(old,entry.name);target.parent.mkdir(parents=True,exist_ok=True)
                        target.write_bytes(archive.extractfile(entry).read())
            for mode in ('full','compatible'):
                host=base/mode
                args=[sys.executable,'-X','utf8','-B',old/'scripts/workspace.py','init',
                    '--target',host,'--packages','skills','research','--apply']
                if mode=='compatible':
                    host.mkdir();(host/'AGENTS.md').write_bytes(b'Host owns authority.\n')
                    args.extend(['--mode',mode])
                self.command(*args)
                bundle=host/'modules/skills'
                self.skill(bundle,host,'install','--names','game-decision-support','humanizer-zh','--apply')
                game=host/'.agents/skills/game-decision-support/SKILL.md';original=game.read_bytes()
                other=host/'.agents/skills/humanizer-zh/SKILL.md'
                local=other.read_bytes()+b'\nPrivate local edit.\n';other.write_bytes(local)
                canaries=[host/'AGENTS.md',host/'research-notes/private.md',
                    host/'tools/rea/keep.txt',host/'client/config.toml']
                for p in canaries[1:]:
                    p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'USER OWNED\n')
                before={p:p.read_bytes() for p in canaries}
                # Follow immutable published predecessors; a new release must not
                # weaken the installer gate to accommodate an old test fixture.
                intermediate=base/('v180-'+mode);intermediate.mkdir()
                raw=subprocess.run(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'archive','v1.8.0'],capture_output=True,check=True).stdout
                with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
                    for entry in archive:
                        if entry.isfile():
                            p=w.safe(intermediate,entry.name);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(archive.extractfile(entry).read())
                advance=self.command(sys.executable,'-X','utf8','-B',intermediate/'scripts/workspace.py','upgrade','--target',host,'--apply')
                self.assertTrue(advance['applied'])
                # Research changes in 1.9; Skills library is unchanged since 1.8.
                readme=host/'modules/research/README.md';readme_before=readme.read_bytes()
                readme.write_bytes(readme_before+b'\nLocal conflicting package edit.\n')
                conflict=w.install(ROOT,host,'upgrade',[],True)
                self.assertFalse(conflict['applied']);self.assertTrue(conflict['conflicts'])
                self.assertEqual(readme_before+b'\nLocal conflicting package edit.\n',readme.read_bytes())
                self.assertEqual('1.8.0',w.state(host)['version'])
                self.assertEqual(original,game.read_bytes())
                for p,data in before.items():self.assertEqual(data,p.read_bytes())
                readme.write_bytes(readme_before)
                preview=w.install(ROOT,host,'upgrade',[])
                self.assertFalse(preview['applied']);self.assertFalse(preview['conflicts'])
                upgraded=w.install(ROOT,host,'upgrade',[],True)
                self.assertTrue(upgraded['applied'])
                self.assertEqual(original,game.read_bytes(),'Package update must not update client skills')
                self.assertTrue((host/'modules/research/game-research/development-support.md').is_file())
                state=host/'.agent-skills/codex/state.json';state_before=state.read_bytes()
                self.assertFalse(self.skill(bundle,host,'upgrade')['applied'])
                self.assertEqual(state_before,state.read_bytes())
                game.write_bytes(original+b'\nConflicting user edit.\n')
                refused=self.skill(bundle,host,'upgrade','--apply',ok=False)
                self.assertTrue(refused['conflicts'])
                self.assertEqual(original+b'\nConflicting user edit.\n',game.read_bytes())
                self.assertEqual(local,other.read_bytes())
                game.write_bytes(original)
                selected=self.skill(bundle,host,'upgrade','--apply')
                self.assertTrue(selected['applied'])
                self.assertNotEqual(original,game.read_bytes())
                self.assertEqual((bundle/'library/game-decision-support/SKILL.md').read_bytes(),game.read_bytes())
                self.assertEqual({'game-decision-support','humanizer-zh'},set(json.loads(state.read_text())['components']))
                self.assertEqual(local,other.read_bytes())
                self.skill(bundle,host,'upgrade','--apply')
                self.assertFalse((host/'.codex').exists())
                self.assertFalse((host/'.agents/skills/rea-investigate').exists())
                self.skill(bundle,host,'rollback','--transaction',selected['transaction'],'--apply')
                self.assertEqual(original,game.read_bytes());self.assertEqual(local,other.read_bytes())
                self.assertTrue(w.rollback(host,upgraded['transaction'],True)['applied'])
                self.assertEqual('1.8.0',w.state(host)['version'])
                self.command(sys.executable,'-X','utf8','-B',intermediate/'scripts/workspace.py','rollback','--target',host,'--transaction',advance['transaction'],'--apply')
                self.assertEqual('1.7.0',w.state(host)['version'])
                for p,data in before.items():self.assertEqual(data,p.read_bytes())


if __name__ == '__main__':
    unittest.main()
