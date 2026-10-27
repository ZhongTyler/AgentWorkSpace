"""Generate a minimal SYNTHETIC dossier; never read host data or overwrite output."""
import argparse,hashlib,json
from pathlib import Path

def create(root):
 root=Path(root)
 if root.exists():raise ValueError('Choose a new output directory; existing data is preserved')
 root.mkdir(parents=True)
 def write(rel,data):
  p=root/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(data,encoding='utf-8',newline='\n')
 def save(rel,x):write(rel,json.dumps(x,ensure_ascii=False,indent=2)+'\n')
 def sha(rel):return hashlib.sha256((root/rel).read_bytes()).hexdigest()
 write('report/README.md','# Synthetic example\n\nConstructed interface exercise, not gameplay or research evidence.\n')
 write('evidence/source.txt','Constructed rule: pay one unit to move once. Conditions are synthetic.\n')
 save('baseline.json',{'names':['mechanics'],'source_sha256':'a'*64,'synthetic':True})
 m={'schema_version':1,'dossier_id':'synthetic-dossier','game_id':'synthetic-game','allowed_root':'.',
 'dossier_ref':'report/README.md','coverage_status':'partial','unresolved':['No real game, media or human validation'],
 'domain_baseline':{'names':['mechanics'],'sha256':'a'*64,'snapshot_ref':'baseline.json','snapshot_sha256':sha('baseline.json')},
 'domains':[{'name':'mechanics','applicability':'present','chapter':'README.md','evidence':['C01'],'scope':'Synthetic rule only'}],
 'sources':[{'id':'S01','read_status':'read','read_scope':'Entire constructed fixture','role':'synthetic','version':'fixture-v1'}],
 'assets':[{'id':'A01','source_id':'S01','path':'evidence/source.txt','sha256':sha('evidence/source.txt'),'accepted':True,'role':'document'}],
 'cases':[{'id':'E01','status':'answered','continuity':'documentary','evidence':['A01'],'frames':[],'evidence_requirements':{'kind':'documentary','required_refs':['A01']}}],
 'claims':[{'id':'C01','evidence':['E01'],'version_groups':['fixture-v1'],'conditions':['Synthetic input only'],'limits':['Not a real game conclusion'],'support_status':'supported_with_conditions','chapter':'README.md'}],
 'documents':['report/README.md'],'document_hashes':{'report/README.md':sha('report/README.md')},
 'knowledge_disposition':'Direct lookup only; no ingestion or implicit registration',
 'export_roots':[{'source':'report','destination':'report'},{'source':'evidence','destination':'evidence'},{'source':'baseline.json','destination':'baseline.json'},{'source':'manifest.json','destination':'canonical-manifest.json'}]}
 save('manifest.json',m)
 save('request.json',{'game_id':m['game_id'],'caller_ref':'synthetic-test','question':'Constructed rule','claim_ids':['C01'],'allowed_version_groups':['fixture-v1']})
 return m
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);a=p.parse_args();create(a.output);print(json.dumps({'synthetic':True,'output':str(a.output)}))
