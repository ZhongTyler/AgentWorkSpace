"""Assemble reviewed visual explanations and detailed evidence into one offline HTML.

This adapter consumes the existing render_visual/render_book HTML contracts.
It does not summarize, retokenize, fetch sources, or generate a PDF.
"""
import argparse,base64,hashlib,html,json,mimetypes,re
from pathlib import Path
from urllib.parse import unquote

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def esc(s):return html.escape(str(s),quote=True)
def assemble(spec,out):
 for p,h in spec['inputs'].items():
  if sha(Path(p))!=h:raise ValueError('Changed reviewed input: '+p)
 visual_path=Path(spec['visual_html']);detail_path=Path(spec['detail_html'])
 visual=visual_path.read_text(encoding='utf8');detail=detail_path.read_text(encoding='utf8')
 story=json.loads(Path(spec['story']).read_text(encoding='utf8'));book=json.loads(Path(spec['book']).read_text(encoding='utf8'))
 docs=dict(re.findall(r'<section data-document="([^"]+)">(.*?)</section>',detail,re.S))
 if list(docs)!=[d['id'] for d in book['documents']]:raise ValueError('Incomplete detail documents')
 ids=[key for group in spec['appendices'] for key in group['documents']]
 if len(ids)!=len(set(ids)) or set(ids)!=set(docs):raise ValueError('Appendix membership must cover every document once')
 titles={d['id']:d['title'] for d in book['documents']};refs={key:[s['id'] for s in story['scenes'] if key in s['refs']] for key in docs}
 # Only navigation/packaging changes to reviewed content; inner document prose is preserved.
 visual=visual.replace(story['evidence_reader']+'#','#')
 visual=re.sub(r'<a href="#([^"]+)">',lambda m:f'<a data-evidence-target="{m[1]}" href="#{m[1]}">' if m[1] in docs else m[0],visual)
 visual=visual.replace('核对本节依据与详细记录','查本节详细论证与证据').replace('链接进入已排版的证据底本，常规读图不需要离开本页。','链接定位到本报告的详细附录；读完可返回刚才的图解。')
 visual=visual.replace('<p>编号：</p>','')
 visual=visual.replace(esc(story['edition']),esc(spec.get('edition',story['edition'])))
 visual=visual.replace(esc(story['intro']),esc(spec.get('introduction',story['intro'])))
 appendix_toc='<div class="appendix-toc"><h3>详细附录</h3><p>按需要查细节，阅读和查证都留在本报告内。</p>'
 for group in spec['appendices']:
  appendix_toc+=f'<details><summary>{esc(group["title"])}</summary>'+''.join(f'<a href="#{key}">{esc(titles[key])}</a>' for key in group['documents'])+'</details>'
 appendix_toc+='<a href="#technical-resources">原件位置与技术记录</a></div>'
 visual=visual.replace('</ol><a href="#book-conclusion">全篇总结</a>','</ol><a href="#book-conclusion">全篇总结</a>'+appendix_toc)
 appendix_index=appendix_toc.replace('<h3>详细附录</h3><p>按需要查细节，阅读和查证都留在本报告内。</p>','')
 appendices=['<section id="appendix-contents"><p class="eyebrow">同一报告的查证部分</p><h2>详细附录</h2><p>这里保留完整机制论证、案例过程与来源记录。它们与前面的图解互相定位；重要限制仍在对应结论旁，不需要读另一份报告。</p>'+appendix_index+'</section>']
 coverage=[]
 for group in spec['appendices']:
  appendices.append(f'<article class="appendix-group" id="{esc(group["id"])}"><div class="chapter-heading"><h2>{esc(group["title"])}</h2><p>{esc(group["intro"])}</p></div>')
  for key in group['documents']:
   original=docs[key];content=original.replace('class="table-scroll wide"','class="table-scroll wide-table"')
   content=content.replace('<p class="group">领域正文</p>','<p class="group">完整机制与论证</p>')
   content=content.replace('<a href="#contents">返回本册目录</a>','<a href="#appendix-contents">返回详细附录目录</a>')
   fallback=refs[key][0] if refs[key] else 'book-overview'
   nav=f'<nav class="appendix-links" aria-label="回到图解"><a data-reading-return href="#{fallback}">返回刚才的图解</a><a href="#appendix-contents">详细附录目录</a></nav>'
   related='<details class="related-scenes"><summary>相关图解</summary>'+''.join(f'<a href="#{s["id"]}">{esc(s["title"])}</a>' for s in story['scenes'] if s['id'] in refs[key])+'</details>' if refs[key] else ''
   appendices.append(f'<section class="appendix-document" data-document="{key}">'+nav+content+related+nav+'</section>')
   coverage.append({'id':key,'original_fragment_sha256':hashlib.sha256(original.encode()).hexdigest(),'navigation_edits_only':True})
  appendices.append('</article>')
 resources=re.search(r'<section id="technical-resources">.*?</section>',detail,re.S)
 if not resources:raise ValueError('Missing original-resource index')
 appendices.append(resources[0].replace('<section id="technical-resources">','<section class="appendix-document" id="technical-resources">'))
 result=visual.replace('</main>',''.join(appendices)+'</main><a class="return-reading" data-reading-return href="#book-overview" hidden>返回刚才的图解</a>')
 # Retain the reviewed image viewer; native anchors still work without scripting.
 navigation='''<script>
history.scrollRestoration='manual';let readingOrigin=null;
function updateReadingReturn(){const target=document.getElementById(decodeURIComponent(location.hash.slice(1)));document.querySelector('.return-reading').hidden=!readingOrigin||!(target?.closest('.appendix-document,.appendix-group')||target?.id==='appendix-contents');}
document.addEventListener('click',e=>{const a=e.target.closest('a');if(!a)return;const href=a.getAttribute('href');if(!href?.startsWith('#'))return;
history.replaceState({...history.state,researchScroll:scrollY},'');
if(a.hasAttribute('data-reading-return')&&readingOrigin){e.preventDefault();history.pushState({researchScroll:readingOrigin.y},'','#'+readingOrigin.id);document.getElementById(readingOrigin.id)?.focus({preventScroll:true});scrollTo(0,readingOrigin.y);updateReadingReturn();return;}
const scene=a.closest('[data-scene]');if(a.hasAttribute('data-evidence-target')&&scene){readingOrigin={id:scene.id,y:scrollY};document.querySelectorAll('[data-reading-return]').forEach(x=>x.setAttribute('href','#'+scene.id));document.querySelector('.return-reading').hidden=false;}
});
addEventListener('hashchange',updateReadingReturn);
addEventListener('popstate',e=>requestAnimationFrame(()=>{if(typeof e.state?.researchScroll==='number')scrollTo(0,e.state.researchScroll);else document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();updateReadingReturn();}));
</script>'''
 result=result.replace('</html>',navigation+'</html>')
 css='''<style>
.appendix-toc{border-top:1px solid #aac2c8;margin-top:22px;padding-top:12px}.appendix-toc a,.related-scenes a{display:block;padding:6px 0}.appendix-document{overflow-wrap:anywhere}.appendix-document h3{font-size:23px;line-height:1.5;margin-top:32px}.appendix-document h4{font-size:20px;line-height:1.6}.appendix-document blockquote{margin:20px 0;padding:12px 20px;border-left:4px solid #aac2c8;background:#edf3f5;font-size:16px}.appendix-document pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf3f5;padding:16px;font-size:14px}.appendix-document figure{margin:24px 0}.appendix-document img{max-width:100%;height:auto;display:block}.appendix-document .table-scroll{overflow-x:auto;max-width:100%;margin:22px 0}.appendix-document table{border-collapse:collapse;width:100%;font-size:16px;line-height:1.75;table-layout:fixed}.appendix-document td,.appendix-document th{padding:12px;vertical-align:top;border-bottom:1px solid #aac2c8;overflow-wrap:anywhere}.appendix-document th{background:#e4f0f2;text-align:left}.appendix-document .wide-table table{min-width:700px}.appendix-links{display:flex;gap:20px;flex-wrap:wrap;font-size:15px;border-bottom:1px solid #aac2c8;padding:8px 0}.appendix-document .table-help,.appendix-document .reader-note,.appendix-document .group{font-size:15px;color:#50636b}.appendix-document .chapter-end{font-size:15px;border-top:1px solid #aac2c8;padding-top:14px}.appendix-document .resource{font-size:15px;overflow-wrap:anywhere}.appendix-document .resource code{white-space:normal}section[data-scene]{outline:none}@media(max-width:600px){.appendix-document table{font-size:15px}.appendix-document td,.appendix-document th{padding:10px}.appendix-document .wide-table table{min-width:650px}}
</style>'''
 css=css.replace('</style>','.appendix-toc>details{margin:0;padding:12px 0;border-top:0}.appendix-toc>details+details{border-top:1px solid #aac2c8}#appendix-contents .appendix-toc{margin-top:14px;padding-top:0;border-top:0}.return-reading{position:fixed;right:12px;bottom:68px;padding:8px 14px;background:#193541;color:white;font-size:14px;z-index:2}.return-reading[hidden]{display:none}@media(max-width:1239px){.return-reading{display:none}}</style>')
 result=result.replace('</style>', '</style>'+css,1)
 result=re.sub(r'(<section id="[^"]+" data-scene)',r'\1 tabindex="-1"',result)
 # Embed local visual images. Detail images are already embedded in reviewed HTML.
 assets={}
 def image_src(m):
  src=html.unescape(m[1])
  if not src or src.startswith('data:'):return m[0]
  p=(visual_path.parent/unquote(src)).resolve();raw=p.read_bytes();assets[str(p)]=sha(p)
  return 'src="data:'+mimetypes.guess_type(p.name)[0]+';base64,'+base64.b64encode(raw).decode()+'"'
 result=re.sub(r'src="([^"]+)"',image_src,result)
 # Zoom links use the same embedded image rather than a dependency on old folders.
 serial=iter(range(1,10000))
 def zoom_link(m):
  key='report-image-'+str(next(serial))
  return '<a'+re.sub(r'href="[^"]*"','href="#'+key+'"',m[1])+'>'+m[2].replace('<img','<img id="'+key+'"',1)+'</a>'
 result=re.sub(r'<a([^>]*class="zoom"[^>]*)>(<img[^>]*src="([^"]+)"[^>]*>)</a>',zoom_link,result)
 out.mkdir(parents=True,exist_ok=True);target=out/'index.html';target.write_text(result,encoding='utf8',newline='\n')
 receipt={'input_sha256':spec['inputs'],'builder_sha256':sha(Path(__file__)),'output_sha256':sha(target),'format':'html-only','self_contained_images':True,'embedded_visual_assets':assets,'detailed_documents':coverage,'scenes':len(story['scenes']),'facts':'Existing reviewed inputs, no new game evidence','reader_effect':'unverified'}
 (out/'build-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
 return receipt
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('manifest',type=Path);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args();r=assemble(json.loads(a.manifest.read_text(encoding='utf8')),a.out);print(json.dumps({'documents':len(r['detailed_documents']),'scenes':r['scenes'],'html_sha256':r['output_sha256']}))
