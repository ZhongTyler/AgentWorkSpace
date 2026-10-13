"""Optional Research preclassification. Keep every source; no automatic adoption or discard."""
import argparse
import hashlib
import json
from pathlib import Path
import time

from local_runtime import predict

BASE=Path(__file__).resolve().parent

def classify(records,questions,backend='intern',purpose=None):
    if backend not in ('intern','laya','startlux'):raise ValueError('Unknown backend')
    if backend=='startlux' and purpose!='noncommercial_research':
        raise ValueError('StartLux requires explicit noncommercial_research purpose')
    if not isinstance(records,list) or not 1<=len(records)<=64:
        raise ValueError('Supply 1-64 already-read material records')
    if any(not isinstance(r,dict) for r in records):raise ValueError('Records must be objects')
    ids=[r.get('id') for r in records]
    if any(not isinstance(i,str) or not i for i in ids) or len(set(ids))!=len(ids):
        raise ValueError('Stable, unique string IDs required')
    if any(not isinstance(r.get('text'),str) or not isinstance(r.get('title'),str) for r in records):
        raise ValueError('Each record needs title and text; files and URLs are not fetched')
    start=time.perf_counter()
    result=dict(schema='research-advisory-batch-v1',backend=backend,purpose=purpose,
                started_unix=time.time(),records=[],source_ids=ids,review_required=True,
                automatic_discard=False,knowledge_ingest=False)
    startup_failure=None
    for item in records:
        state={'_research_decision':{'backend':backend,'purpose':purpose},
               'payload':{'title':item['title'],'text':item['text']}}
        before=time.perf_counter()
        try:
            if startup_failure:raise RuntimeError(startup_failure)
            response=predict(state,questions)
            answers=response.get('answers',{})
            if set(answers)!=set(questions):raise ValueError('Question IDs mismatch')
            for key,q in questions.items():
                if q['type']=='choice' and answers[key].get('choice') not in q['criteria']:
                    raise ValueError('Choice outside supplied options')
            row=dict(id=item['id'],response=response,status='advisory_unreviewed')
        except Exception as exc:
            row=dict(id=item['id'],status='original_path_required',error=str(exc))
            if isinstance(exc,RuntimeError) and 'startup' in str(exc).lower():
                startup_failure=str(exc)
        row['elapsed_ms']=round((time.perf_counter()-before)*1000,2)
        result['records'].append(row)
    result.update(ended_unix=time.time(),generation_seconds=round(time.perf_counter()-start,3))
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--materials',type=Path,required=True)
    parser.add_argument('--questions',type=Path,required=True)
    parser.add_argument('--backend',choices=['intern','laya','startlux'],default='intern')
    parser.add_argument('--purpose',choices=['noncommercial_research'])
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists():raise SystemExit('Output exists; preserve prior receipts')
    material_bytes=args.materials.read_bytes(); question_bytes=args.questions.read_bytes()
    result=classify(json.loads(material_bytes),json.loads(question_bytes),args.backend,args.purpose)
    result['input_sha256']=dict(materials=hashlib.sha256(material_bytes).hexdigest(),questions=hashlib.sha256(question_bytes).hexdigest())
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(output=str(args.output),records=len(result['records']),generation_seconds=result['generation_seconds'],review_required=True)))
