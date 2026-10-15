"""Verify a local batch and expose review-only previews and generated-source handoff."""
import argparse,hashlib,html,json,pathlib,shutil

def sha(path):
    with pathlib.Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def prepare(batch,output):
    batch=pathlib.Path(batch).resolve();data=json.loads(batch.read_text(encoding='utf-8'));output=pathlib.Path(output).resolve()
    if data['status']!='awaiting_visual_review' or data.get('project_adopted'):raise ValueError('Expected complete, unadopted supervised batch')
    if output.exists() and any(output.iterdir()):raise FileExistsError('Preserve existing consumer output')
    verified=[]
    for spec in data['request']['assets']:
        row=data['assets'][spec['id']]
        for key in ('source','candidate'):
            p=pathlib.Path(row[key]).resolve()
            if not p.is_relative_to(batch.parent) or sha(p)!=row[key+'_sha256']:raise ValueError('Batch source/candidate changed or escaped')
        for stage in row['stages']:
            for item in stage['outputs']:
                p=pathlib.Path(item['path']).resolve()
                if not p.is_relative_to(batch.parent) or sha(p)!=item['sha256']:raise ValueError('Stage changed')
        view=pathlib.Path(row['preview']).resolve()
        if not view.is_relative_to(batch.parent):raise ValueError('Preview escaped')
        receipt=json.loads(view.with_suffix('.stage.json').read_text())
        if not any(r['path']==str(view) and r['sha256']==sha(view) for r in receipt['outputs']):raise ValueError('Preview changed')
        verified.append((spec,row))
    output.mkdir(parents=True,exist_ok=True);(output/'images').mkdir();(output/'previews').mkdir()
    assets=[];cards=[]
    for spec,row in verified:
        name=spec['id']+'.png';image=output/'images'/name;view=output/'previews'/name
        # Source handoff retains the original image; processed candidate remains a separate review attachment.
        shutil.copyfile(row['source'],image);shutil.copyfile(row['preview'],view)
        assets.append({'id':spec['id'],'producer':'Tools/local-image/'+('processing-existing' if spec.get('source') else spec['profile']),'version':data['request']['profile_version'],'prompt':spec['prompt'],'references':[{'path':spec[k],'sha256':spec[k+'_sha256'],'rights':'user must separately confirm'} for k in ['reference','source','original'] if spec.get(k)],'file':{'path':'images/'+name,'sha256':sha(image)},'candidate':{'path':row['candidate'],'sha256':row['candidate_sha256']},'adopted':False})
        cards.append('<article><h2>'+html.escape(spec['id'])+'</h2><p>'+html.escape(spec['profile'])+' · '+str(spec['target_size'])+' · 未审核/未采用 · <a href="images/'+name+'" target="_blank">查看原图</a></p><img src="previews/'+name+'" alt="深浅底实际尺寸预览"></article>')
    generation={'kind':'generated','assets':assets,'source_batch_sha256':sha(batch),'rights_verified':False,'project_adopted':False}
    (output/'generation.json').write_text(json.dumps(generation,ensure_ascii=False,indent=2),encoding='utf-8')
    (output/'index.html').write_text('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地素材审核工作台</title><style>body{font:16px system-ui;background:#171b22;color:#eee;margin:24px}article{border:1px solid #454a55;padding:16px;margin:20px 0;overflow:auto}img{max-width:none;image-rendering:auto}h1{font-size:26px}a{color:#8bc5ff}</style><h1>本地素材审核工作台</h1><p>此页仅供候选审图，尚未采用到游戏。预览保持实际像素；窄窗口可横向滚动查看深浅底，也可打开原图检查细节。</p>'+''.join(cards),encoding='utf-8')
    receipt={'operation':'review_only_local_image_consumer','batch':str(batch),'batch_sha256':sha(batch),'assets':len(assets),'generation_json_sha256':sha(output/'generation.json'),'html_sha256':sha(output/'index.html'),'engine_modified':False,'adopted':False}
    (output/'consumer.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');return receipt
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--batch',required=True);p.add_argument('--output',required=True);a=p.parse_args();print(json.dumps(prepare(a.batch,a.output),indent=2))
