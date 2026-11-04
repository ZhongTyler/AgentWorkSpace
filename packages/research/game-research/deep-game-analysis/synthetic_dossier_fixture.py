"""Synthetic provenance fixture preserving the upstream negative test matrix."""
import hashlib,json
from pathlib import Path
def create(root):
 root=Path(root);root.mkdir(parents=True,exist_ok=False)
 def text(name,value):p=root/name;p.write_text(value,encoding='utf8');return hashlib.sha256(p.read_bytes()).hexdigest()
 baseline={'names':['mechanics','rewards'],'source_sha256':'synthetic'}
 h=text('baseline.json',json.dumps(baseline));doc=text('README.md','# Synthetic dossier\nNot game research or visual evidence.\n')
 assets=[]
 for ident,source,role,accepted,decoded in [('frame-S15','S15','video_frame',True,True),('transcript-S15','S15','transcript',True,False),('file-S13-CommunicationMod-LICENSE','S13','license',True,False),('M10-rejected-thumbnail','S15','video_frame',False,False)]:
  name=ident+'.txt';sha=text(name,'Synthetic bytes for '+ident);assets.append(dict(id=ident,source_id=source,path=name,role=role,accepted=accepted,decoded_frame_verified=decoded,sha256=sha))
 m=dict(schema_version=1,dossier_id='synthetic-contract',game_id='slay-the-spire-1',game_title='Synthetic interface fixture, not a game study',allowed_root='.',dossier_ref='README.md',coverage_status='partial',unresolved=['No real research or visual acceptance'],domain_baseline=dict(names=baseline['names'],sha256='synthetic',snapshot_ref='baseline.json',snapshot_sha256=h),documents=['README.md'],document_hashes={'README.md':doc},sources=[dict(id='S15',read_status='partial_read',read_scope='Entire synthetic fixture',role='synthetic'),dict(id='S13',read_status='read',read_scope='Constructed unrelated archive',role='synthetic'),dict(id='S10',read_status='unread',read_scope='',role='unavailable')],assets=assets,cases=[dict(id='E01',status='partial',continuity='sparse',evidence=['S15'],frames=['frame-S15'],evidence_requirements=dict(kind='visual_sequence',required_refs=['frame-S15'],min_frames=1)),dict(id='E02',status='answered',continuity='documentary',evidence=['S15'],frames=[],evidence_requirements=dict(kind='documentary',required_refs=['S15']))],claims=[])
 for ident,evidence,status,version in [('C01','E01','supported_with_conditions','historical-v1.0'),('C03','E02','supported_with_conditions','conditional-math'),('C10','S13','unresolved','knowledge-current-read')]:
  m['claims'].append(dict(id=ident,evidence=[evidence],support_status=status,version_groups=[version],conditions=['Synthetic fixture only'],limits=['小'],chapter='README.md'))
 m['domains']=[dict(name=name,applicability='present',chapter='README.md',evidence=['C03'],scope='Synthetic fixture only') for name in baseline['names']]
 p=root/'manifest.json';p.write_text(json.dumps(m,ensure_ascii=False),encoding='utf8');return p
