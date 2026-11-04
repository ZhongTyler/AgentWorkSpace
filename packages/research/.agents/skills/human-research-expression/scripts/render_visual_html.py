"""HTML-only visual chapters, using the existing authored story and SVG diagrams.

No PDF/font installation, source fetching, summarization or inferred game facts.
Evidence sequences preserve the original image bytes; optional crops are CSS views.
The output also supports assemble_html.py for a single report with detailed evidence.
"""
import argparse,base64,hashlib,html,json,mimetypes,re
from pathlib import Path
from render_visual import diagram

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def esc(x):return html.escape(str(x),quote=True)

CSS='''*{box-sizing:border-box}html{scroll-behavior:auto}body{margin:0;background:#efeee8;color:#193541;font:18px/1.8 system-ui,"Microsoft YaHei",sans-serif}header,main{max-width:1020px;margin:auto}header{padding:40px}h1{font-size:40px;line-height:1.35;max-width:20em}h2{font-size:30px;line-height:1.45}h3{font-size:25px;line-height:1.5}section{padding:32px 42px;background:#fffdf8;margin:16px 0;scroll-margin-top:12px}.chapter-heading{background:#193541;color:#fffdf8;padding:26px 42px;margin-top:36px}.chapter-heading h2,.chapter-heading p{margin:8px 0}.eyebrow{font-size:14px;color:#50636b}.chapter-heading .eyebrow{color:#d9e8e9}.lead{max-width:46em}.takeaway{border-left:4px solid #17667a;padding:12px 18px;background:#e4f0f2;font-size:20px}a{color:#17667a;text-underline-offset:3px}a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #b65726;outline-offset:4px}summary{cursor:pointer;padding:10px 0}details{font-size:15px;border-top:1px solid #aac2c8;margin-top:20px;overflow-wrap:anywhere}details a{display:block;padding:6px 0}.book-toc{list-style:none;padding:0}.book-toc>li{margin:20px 0}.book-toc ol{list-style:none;padding-left:18px}.book-toc>li>a{font-weight:700}.reading-links{display:flex;gap:18px;flex-wrap:wrap;font-size:15px;margin-top:22px}.reading-links a{padding:5px 0}aside{color:#50636b;font-size:15px;line-height:1.75}aside p{margin:8px 0}.diagram{margin:24px 0}.diagram svg{display:block;width:100%;height:auto}.mobile{display:none}.sequence{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;margin:24px 0}.sequence figure{margin:0;min-width:0}.sequence h4{font-size:18px;margin:6px 0}.shot{position:relative}.zoom{display:block;position:relative;overflow:hidden;background:#142330}.zoom img{display:block;width:100%;height:auto}.zoom.crop img{position:absolute;max-width:none;height:auto}.marker{position:absolute;display:grid;place-items:center;border-radius:50%;background:#fffdf8;color:#913c14;border:3px solid #b65726;font-size:14px;font-weight:700;width:28px;height:28px;transform:translate(-50%,-50%);pointer-events:none}.sequence figcaption{font-size:15px;line-height:1.7;margin-top:10px}.sequence .location{font-size:13px;color:#50636b}.marker-key{font-size:15px;line-height:1.7;padding-left:22px}.wide-only{display:block}.coverage{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0}.coverage>div{border-top:4px solid #17667a;background:#e4f0f2;padding:14px}.coverage>div[data-level="boundary"]{border-color:#b65726;background:#fbebdf}.coverage strong{display:block}.coverage p{font-size:15px;margin:5px 0}.top{position:fixed;right:12px;bottom:12px;padding:8px 14px;background:white;border:1px solid #aac2c8;font-size:14px;z-index:2}dialog{max-width:98vw;max-height:96vh;border:0;padding:14px}dialog img{max-width:92vw;max-height:82vh;display:block}dialog::backdrop{background:#152e38dd}button{font:inherit;padding:8px 18px}section[data-scene]{outline:none}@media(max-width:600px){header{padding:24px}h1{font-size:29px}h2{font-size:25px}h3{font-size:23px}section,.chapter-heading{padding:24px 20px;margin:12px 0}.sequence{grid-template-columns:1fr;gap:26px}.coverage{grid-template-columns:1fr}.wide{display:none}.mobile{display:block}.takeaway{font-size:18px}.marker{width:24px;height:24px;border-width:2px;font-size:13px}.diagram svg{max-width:420px;margin:auto}}'''

CSS+='''.spatial-states{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin:24px 0}.spatial-state h4{margin:6px 0;font-size:18px}.spatial-grid{display:grid;gap:4px;max-width:420px}.spatial-cell{aspect-ratio:1;display:grid;place-items:center;text-align:center;background:#e4f0f2;border:1px solid #aac2c8;font-size:17px;line-height:1.35;padding:5px}.spatial-cell[data-tone="danger"]{background:#f9dfd1;border-color:#b65726}.spatial-cell[data-tone="accent"]{background:#193541;color:#fffdf8}.spatial-cell[data-tone="info"]{background:#badde7}.spatial-state p,.spatial-basis{font-size:15px;line-height:1.7}@media(max-width:600px){.spatial-states{grid-template-columns:1fr}.spatial-cell{font-size:16px}}'''

CSS+='''.book-toc{display:grid;gap:14px}.book-toc>li{margin:0;padding:16px 20px;border:1px solid #b7cdd1;border-radius:10px;background:#f4f8f6}.book-toc>li>a{display:block;line-height:1.6}.book-toc>li>details{margin:6px 0 0;padding:0;border-top:0}.book-toc>li>details>summary{padding:5px 0}.book-toc>li>details ol{margin:6px 0 0}.book-toc>li>details li{margin:0}@media(max-width:600px){.book-toc>li{padding:14px 16px}}'''

CSS+='''@media(max-width:1239px){.top{position:static;display:block;width:max-content;max-width:calc(100% - 40px);margin:24px auto}}'''

def structure(spec):
 scenes=spec['scenes'];chapters=spec['chapters'];ids=[s['id'] for s in scenes]
 if len(ids)!=len(set(ids)):raise ValueError('Duplicate scene identity')
 by={s['id']:s for s in scenes};expected=['book-overview']
 if by['book-overview'].get('role')!='book-overview':raise ValueError('Missing opening overview')
 chapter_ids=set()
 for c in chapters:
  if c['id'] in chapter_ids or c['id'] in by:raise ValueError('Duplicate chapter identity')
  chapter_ids.add(c['id'])
  rows=[(c['overview_id'],'chapter-overview'),*[(k,'detail') for k in c['detail_ids']],(c['summary_id'],'chapter-summary')]
  if not c['detail_ids']:raise ValueError('Chapter needs substantive detail')
  for key,role in rows:
   if key not in by or by[key].get('role')!=role or by[key].get('chapter_id')!=c['id']:raise ValueError('Chapter membership mismatch: '+key)
   expected.append(key)
 expected.append('book-conclusion')
 if ids!=expected or by['book-conclusion'].get('role')!='book-conclusion':raise ValueError('Whole-part-whole order mismatch')
 return by

def render(spec,out):
 by=structure(spec);images={};out=Path(out);out.mkdir(parents=True,exist_ok=True)
 for p,digest in spec.get('source_hashes',{}).items():
  if sha(Path(p))!=digest:raise ValueError('Changed input: '+p)
 def picture(step,key):
  p=Path(step['image_path']);actual=sha(p)
  if actual!=step['image_sha256']:raise ValueError('Changed evidence image: '+str(p))
  images[str(p)]=actual;mime=mimetypes.guess_type(p.name)[0]
  if mime not in ('image/jpeg','image/png','image/webp'):raise ValueError('Unsupported evidence type')
  src='data:'+mime+';base64,'+base64.b64encode(p.read_bytes()).decode();style='';crop=step.get('crop')
  if crop:
   iw,ih=step['image_size'];x,y,w,h=crop
   if min(x,y)<0 or min(w,h)<=0 or x+w>iw or y+h>ih:raise ValueError('Crop outside original')
   style=f' style="width:{100*iw/w:.6f}%;left:{-100*x/w:.6f}%;top:{-100*y/h:.6f}%"'
  linkstyle=f' style="aspect-ratio:{crop[2]}/{crop[3]}"' if crop else ''
  markers=''
  for marker in step.get('markers',[]):
   x,y=marker['at']
   if not 0<=x<=100 or not 0<=y<=100:raise ValueError('Marker outside displayed view')
   markers+=f'<span class="marker" style="left:{x}%;top:{y}%" aria-hidden="true">{esc(marker["label"])}</span>'
  return f'<figure><h4>{esc(step["title"])}</h4><div class="shot"><a class="zoom'+(' crop' if crop else '')+f'" href="#{key}"{linkstyle}><img id="{key}" src="{src}" alt="{esc(step["alt"])}"{style}></a>{markers}</div><figcaption>{esc(step["caption"])}</figcaption><p class="location">{esc(step["locator"])}'+(' · 局部原图，点图查看全图' if crop else ' · 点图查看原图')+'</p></figure>'
 def visual(s):
  v=s.get('visual',{'kind':'none'})
  if v['kind']=='none':return ''
  if v['kind']=='evidence_sequence':
   if not 1<=len(v['steps'])<=6:raise ValueError('Sequence needs one to six explicit steps')
   return '<div class="sequence">'+''.join(picture(x,f'{s["id"]}-image-{i}') for i,x in enumerate(v['steps'],1))+'</div>'
  if v['kind']=='depth_map':
   return '<div class="coverage">'+''.join(f'<div data-level="{esc(x["level"])}"><strong>{esc(x["title"])}</strong><p>{esc(x["scope"])}</p><p>{esc(x["limit"])}</p></div>' for x in v['data'])+'</div>'
  if v['kind']=='spatial_states':
   if not v.get('basis'):raise ValueError('Spatial explanation needs observed or schematic basis')
   parts=[]
   for state in v['states']:
    rows=state['rows'];cols=len(rows[0]) if rows else 0
    if not 1<=cols<=8 or not 1<=len(rows)<=8 or any(len(row)!=cols for row in rows):raise ValueError('Ambiguous spatial grid')
    cells=''
    for row in rows:
     for cell in row:
      tone=cell.get('tone','neutral')
      if tone not in ('neutral','danger','accent','info'):raise ValueError('Unknown spatial encoding')
      cells+=f'<div class="spatial-cell" data-tone="{tone}">{esc(cell["label"])}</div>'
    parts.append(f'<div class="spatial-state"><h4>{esc(state["title"])}</h4><div class="spatial-grid" style="grid-template-columns:repeat({cols},minmax(0,1fr))" role="img" aria-label="{esc(state["alt"])}">{cells}</div><p>{esc(state["caption"])}</p></div>')
   return '<p class="spatial-basis">'+esc(v['basis'])+'</p><div class="spatial-states">'+''.join(parts)+'</div>'
  return '<figure class="diagram" data-diagram-kind="'+esc(v['kind'])+'"><div class="wide">'+diagram(v,780).svg()+'</div><div class="mobile">'+diagram(v,340).svg()+'</div></figure>'
 def scene(s):
  role=s['role'];phase={'book-overview':'全篇总览','chapter-overview':'本章总览','detail':'分项图解','chapter-summary':'本章小结','book-conclusion':'全篇总结'}[role]
  eyebrow=s['section_number']+' · '+phase if s.get('section_number') else phase
  links=''.join(f'<a href="{esc(spec["evidence_reader"])}#{esc(k)}">{esc(spec["reference_titles"][k])}</a>' for k in s['refs'])
  limits=''.join('<p>'+esc(x)+'</p>' for x in s.get('limits',[]))
  return f'<section id="{esc(s["id"])}" data-scene data-role="{role}" tabindex="-1"><p class="eyebrow">{esc(eyebrow)}</p><h3 class="scene-title">{esc(s["title"])}</h3><p class="lead">{esc(s["lead"])}</p>'+visual(s)+f'<p class="takeaway">{esc(s["takeaway"])}</p><aside>{limits}</aside><details><summary>核对本节依据与详细记录</summary><p>{links}</p><p>编号：{esc("、".join(s.get("claims",[])))}</p><p>链接进入已排版的证据底本，常规读图不需要离开本页。</p></details><nav class="reading-links"><a href="#contents">回分层目录</a>'+ (f'<a href="#{esc(s["chapter_id"])}">回本章总览</a>' if s.get('chapter_id') else '')+'</nav></section>'
 toc='<a href="#book-overview">开篇总览：先认识全局</a><ol class="book-toc">'
 for c in spec['chapters']:
  keys=[c['overview_id'],*c['detail_ids'],c['summary_id']]
  toc+=f'<li class="toc-chapter"><a href="#{esc(c["id"])}">第{c["number"]}章 · {esc(c["title"])}</a><details class="toc-sections"><summary>总览 → {len(c["detail_ids"])}项展开 → 小结</summary><ol>'+''.join(f'<li><a href="#{esc(k)}">{esc(by[k]["title"])}</a></li>' for k in keys)+'</ol></details></li>'
 toc+='</ol><a href="#book-conclusion">全篇总结</a>'
 body=scene(by['book-overview'])+'<section id="contents"><h2>阅读目录</h2><p>每章先交代本章要解决什么，再读具体画面与图解，最后把取舍接回全局。</p>'+toc+'</section>'
 for i,c in enumerate(spec['chapters']):
  body+=f'<article data-chapter="{esc(c["id"])}" id="{esc(c["id"])}"><div class="chapter-heading"><p class="eyebrow">第{c["number"]}章</p><h2>{esc(c["title"])}</h2><p>{esc(c["question"])}</p></div>'
  body+=''.join(scene(by[k]) for k in [c['overview_id'],*c['detail_ids'],c['summary_id']])
  nextid=spec['chapters'][i+1]['overview_id'] if i+1<len(spec['chapters']) else 'book-conclusion'
  body+=f'<section class="reading-links"><a href="#{esc(nextid)}">继续：'+('下一章总览' if i+1<len(spec['chapters']) else '全篇总结')+'</a></section></article>'
 body+=scene(by['book-conclusion'])
 viewer='''<dialog aria-label="查看研究原画面"><button autofocus>关闭</button><img alt=""></dialog><script>const dlg=document.querySelector('dialog');let opener;document.querySelectorAll('.zoom').forEach(a=>a.addEventListener('click',e=>{if(!dlg.showModal)return;e.preventDefault();opener=a;const src=a.querySelector('img');dlg.querySelector('img').src=src.src;dlg.querySelector('img').alt=src.alt;dlg.showModal()}));dlg.querySelector('button').onclick=()=>dlg.close();dlg.addEventListener('close',()=>opener?.focus());</script>'''
 markup='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(spec['title'])+'</title><style>'+CSS+'</style><header id="book-cover"><p class="eyebrow">'+esc(spec['edition'])+'</p><h1>'+esc(spec['title'])+'</h1><p>'+esc(spec['intro'])+'</p><a href="#contents">阅读目录</a></header><main>'+body+'</main><a href="#contents" class="top">目录</a>'+viewer+'</html>'
 emitted_ids=re.findall(r'\bid="([^"]+)"',markup)
 if len(emitted_ids)!=len(set(emitted_ids)):raise ValueError('Generated HTML identity collision')
 target=out/'index.html';target.write_text(markup,encoding='utf8',newline='\n')
 receipt={'format':'html-only','scenes':len(spec['scenes']),'images':images,'source_hashes':spec.get('source_hashes',{}),'output_sha256':sha(target),'renderer_sha256':sha(Path(__file__)),'effect':'Content supplied by author; rendering does not prove understanding.'}
 (out/'build-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 return receipt

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('story',type=Path);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
 spec=json.loads(a.story.read_text(encoding='utf8'));print(json.dumps(render(spec,a.out),ensure_ascii=False))
