"""Read-only commit-message and direct-parent Git closure checks."""
import argparse,json
from pathlib import Path
from execution_contract import validate_commit_message,verify_git_closure
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('mode',choices=['message','closure']);p.add_argument('--file',type=Path,required=True);a=p.parse_args()
 if a.mode=='message':
  errors=validate_commit_message(a.file.read_text('utf-8-sig'));result={'status':'fail' if errors else 'pass','errors':errors}
 else:
  value=json.loads(a.file.read_text('utf-8-sig'));result=verify_git_closure(value['repositories'],value['edges']);result['status']='pass' if result['closed'] else 'fail'
 print(json.dumps(result,ensure_ascii=False,indent=2));return 0 if result['status']=='pass' else 1
if __name__=='__main__':raise SystemExit(main())
