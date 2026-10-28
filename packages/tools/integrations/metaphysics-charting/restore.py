"""Restore fixed MIT calculation sources offline into a new external home; no npm scripts."""
import argparse,base64,hashlib,json,shutil,tarfile
from pathlib import Path,PurePosixPath
ROOT=Path(__file__).resolve().parent
def restore(output):
 output=output.resolve()
 if output.exists() or output.is_relative_to(ROOT) or ROOT.is_relative_to(output):raise ValueError('Choose a new external home')
 sources=json.loads((ROOT/'vendor/sources.json').read_text('utf8'))
 for row in sources:
  raw=(ROOT/'vendor'/row['file']).read_bytes()
  if hashlib.sha256(raw).hexdigest()!=row['sha256'] or 'sha512-'+base64.b64encode(hashlib.sha512(raw).digest()).decode()!=row['integrity']:raise ValueError('Archive integrity failure')
  with tarfile.open(ROOT/'vendor'/row['file'],'r:gz') as archive:
   for member in archive.getmembers():
    parts=PurePosixPath(member.name).parts
    if not parts or parts[0]!='package' or '..' in parts or any('\\' in x or ':' in x for x in parts) or not (member.isfile() or member.isdir()):raise ValueError('Unsafe archive member')
 output.mkdir(parents=True)
 for source in ROOT.iterdir():
  if source.is_file() and source.suffix in {'.mjs','.json','.md','.cjs'}:shutil.copyfile(source,output/source.name)
 shutil.copytree(ROOT/'sources',output/'sources')
 for row in sources:
  destination=output/'node_modules'/row['name'];destination.mkdir(parents=True)
  with tarfile.open(ROOT/'vendor'/row['file'],'r:gz') as archive:
   for member in archive.getmembers():
    parts=PurePosixPath(member.name).parts[1:]
    if not parts or not member.isfile():continue
    target=destination.joinpath(*parts)
    if not target.resolve().is_relative_to(destination.resolve()):raise ValueError('Extraction escape')
    target.parent.mkdir(parents=True,exist_ok=True)
    with archive.extractfile(member) as stream:target.write_bytes(stream.read())
 lock=json.loads((output/'source-lock.json').read_text('utf8'))
 for name,sha in lock['files'].items():
  file=output/name
  if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest()!=sha:raise ValueError('Restored source mismatch: '+name)
 return {'status':'restored','home':str(output),'files_verified':len(lock['files']),'network':False,'npm_scripts':False,'accuracy_verified':False}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);a=p.parse_args();print(json.dumps(restore(a.output)))
