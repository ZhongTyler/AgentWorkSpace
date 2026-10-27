"""Render a complete authored Markdown corpus with internal navigation.

Input: book.json tokenized by parse_markdown.mjs. No summarization or remote reads.
"""
import argparse, base64, hashlib, html, json, mimetypes, os, re, importlib.metadata
from pathlib import Path
from urllib.parse import unquote

def esc(s):return html.escape(str(s),quote=True)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def slug(s):return re.sub(r'[^\w\-\u4e00-\u9fff ]','',s.lower()).strip().replace(' ','-')

class Book:
 def __init__(self,spec,out):
  for d in spec['documents']:
   if sha(Path(d['source_path']))!=d['source_sha256']:raise ValueError('Original source changed: '+d['id'])
   reader=Path(d['reader_path'])
   if sha(reader)!=d['reader_sha256']:raise ValueError('Reader text changed; retokenize: '+d['id'])
   if ''.join(t['raw'] for t in d['tokens'])!=reader.read_text(encoding='utf8'):raise ValueError('Tokens do not cover reader text exactly: '+d['id'])
  self.spec=spec;self.out=out;self.by_path={str(Path(d['source_path']).resolve()).casefold():d for d in spec['documents']}
  self.targets={};self.images={};self.resources={};self.headings={};self.references={d['id']:set() for d in spec['documents']}
  for d in spec['documents']:
   self.targets[d['id']]=d['title'];serial=0
   for t in self.walk(d['tokens']):
    if t['type']=='heading':
     serial+=1;t['_id']=d['id'] if t['depth']==1 and serial==1 else f'{d["id"]}-h{serial}'
     self.targets[t['_id']]=t['text'];self.headings[(d['id'],slug(t['text']))]=t['_id']
    if t['type']=='image':
     p=(Path(d['source_path']).parent/unquote(t['href'])).resolve(strict=True)
     self.images[str(p)]=sha(p)
   if d['id'].startswith('case'):self.targets['E'+d['id'][4:]]=d['title']
  # Claim row anchors are created where their complete table lives.
  self.claims=set()
  for d in spec['documents']:
   if d['id']=='archive-overview':
    for t in d['tokens']:
     if t['type']=='table':
      for row in t['rows']:
       if re.fullmatch(r'C\d{2}',row[0]['text']):self.claims.add(row[0]['text'])
  self.sources={}
  for d in spec['documents']:
   if d['id']=='source-index':
    for t in d['tokens']:
     if t['type']=='heading':
      m=re.match(r'(S\d{2}(?:-\d+)?)\b',t['text'])
      if m:
       self.sources[m[1]]=t['_id']
       if '-' in m[1]:self.sources.setdefault(m[1].split('-')[0],'source-index')
 def walk(self,tokens):
  for t in tokens:
   yield t
   if 'tokens' in t:yield from self.walk(t['tokens'])
   if t['type']=='table':
    for c in t['header']+[c for row in t['rows'] for c in row]:yield from self.walk(c.get('tokens',[]))
   if t['type']=='list':
    for item in t['items']:yield from self.walk(item['tokens'])
 def target(self,href,d):
  if href.startswith(('https://','http://','mailto:')):return ('web',href)
  if href.startswith('#'):
   key=self.headings.get((d['id'],unquote(href[1:])),d['id']);return ('internal',key)
  plain,_,fragment=href.partition('#')
  p=(Path(d['source_path']).parent/unquote(plain)).resolve()
  linked=self.by_path.get(str(p).casefold())
  if linked:
   dest=self.headings.get((linked['id'],unquote(fragment)),linked['id']) if fragment else linked['id']
   self.references[d['id']].add(linked['id']);return ('internal',dest)
  key='resource-'+hashlib.sha256(str(p).encode()).hexdigest()[:12]
  self.resources[key]={'path':str(p),'label':p.name,'exists':p.exists()}
  return ('resource',key)
 def ids(self,text,d,pdf=False):
  def replace(m):
   value=m[0];dest=None
   if value.startswith('E') and 'case'+value[1:] in self.targets:
    dest='case'+value[1:];self.references[d['id']].add(dest)
   elif value.startswith('S'):dest=self.sources.get(value)
   elif value in self.claims:dest='claim-'+value
   if not dest:return esc(value)
   return f'<link href="#{dest}" color="#075568">{esc(value)}</link>' if pdf else f'<a href="#{dest}">{esc(value)}</a>'
  parts=re.split(r'((?<![A-Za-z0-9])(?:E\d{2}|C\d{2}|S\d{2}(?:-\d+)?)(?![A-Za-z0-9]))',text)
  return ''.join(replace(re.fullmatch(r'(?:E\d{2}|C\d{2}|S\d{2}(?:-\d+)?)',part)) if re.fullmatch(r'(?:E\d{2}|C\d{2}|S\d{2}(?:-\d+)?)',part) else esc(part) for part in parts)
 def inline(self,tokens,d,pdf=False,linked=False):
  result=[]
  for t in tokens:
   kind=t['type']
   if kind in ('text','escape'):
    result.append(self.inline(t['tokens'],d,pdf,linked) if 'tokens' in t else esc(t['text']) if linked else self.ids(t['text'],d,pdf))
   elif kind in ('strong','em','del'):
    tag={'strong':'b','em':'i','del':'strike' if pdf else 'del'}[kind];result.append(f'<{tag}>'+self.inline(t['tokens'],d,pdf,linked)+f'</{tag}>')
   elif kind=='codespan':result.append(esc(t['text']) if pdf else '<code>'+esc(t['text'])+'</code>')
   elif kind=='br':result.append('<br/>' if pdf else '<br>')
   elif kind=='link':
    mode,url=self.target(t['href'],d);label=self.inline(t['tokens'],d,pdf,True)
    dest=url if mode=='web' else '#'+url
    result.append(f'<link href="{esc(dest)}" color="#075568">{label}</link>' if pdf else f'<a href="{esc(dest)}">{label}</a>')
   elif kind=='image':result.append(esc(t.get('text','图示')))
   elif kind=='html':result.append(esc(t.get('text',t['raw'])))
   else:raise ValueError('Unsupported inline token '+kind)
  return ''.join(result)
 def image(self,t,d):
  p=(Path(d['source_path']).parent/unquote(t['href'])).resolve(strict=True)
  return p,t.get('text','原研究图示')

CSS='''
.image-viewport{max-width:90vw;max-height:76vh;overflow:auto;overscroll-behavior:contain}
body{overflow-wrap:anywhere}
*{box-sizing:border-box}body{margin:0;color:#20343f;background:#e9edef;font:18px/1.85 system-ui,"Microsoft YaHei",sans-serif}header,main,footer{max-width:1040px;margin:auto}header{padding:32px 36px}h1{font-size:34px;line-height:1.4}h2{font-size:27px;line-height:1.5}h3{font-size:22px}section{background:white;padding:36px 44px;margin:20px 0;scroll-margin-top:16px}h1,h2,h3,h4{color:#163f4b}a{color:#07596c;text-underline-offset:3px}a:focus-visible,button:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:3px solid #c77a00;outline-offset:4px}p{margin:16px 0}blockquote{margin:20px 0;padding:12px 20px;border-left:4px solid #a7bfc6;background:#edf3f5;font-size:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf3f5;padding:16px;font-size:14px}code{overflow-wrap:anywhere}figure{margin:26px 0}figure img{max-width:100%;height:auto;display:block;margin:auto}figcaption{font-size:15px;line-height:1.75;background:#edf3f5;padding:10px 16px}.table-scroll{overflow-x:auto;max-width:100%;margin:22px 0}table{border-collapse:collapse;width:100%;font-size:16px;line-height:1.75;table-layout:fixed}th,td{padding:12px 14px;vertical-align:top;border-bottom:1px solid #cfdbdf;overflow-wrap:anywhere}th{background:#dcebef;text-align:left}.wide table{min-width:700px}.table-help{font-size:13px;color:#536b75}.group{color:#526b75;font-size:15px}.chapter-end{border-top:1px solid #c4d6dc;font-size:15px;padding-top:16px}.toc a{display:block;padding:5px 0}.toc small{display:block;color:#536b75}.reader-note{border-left:4px solid #ad863d;padding-left:16px;font-size:16px}.resource{font-size:15px;overflow-wrap:anywhere}dialog{border:0;max-width:96vw;max-height:96vh;padding:18px}dialog::backdrop{background:rgba(15,30,40,.78)}dialog img{display:block;max-width:90vw;max-height:76vh;object-fit:contain}dialog button{font:inherit;padding:8px 18px;margin-bottom:12px}dialog p{font-size:15px;max-width:85vw}.source-card{border-bottom:1px solid #c9d7db;padding:18px 0}.back-top{position:fixed;right:16px;bottom:16px;padding:8px 14px;background:white;border:1px solid #aec6cf;font-size:14px}@media(max-width:650px){header{padding:20px}h1{font-size:28px}section{padding:24px 20px;margin:12px 0}h2{font-size:24px}table{font-size:15px}td,th{padding:10px}.wide table{min-width:650px}}@media print{header,.chapter-end,.back-top,dialog{display:none}body{background:white;font-size:11pt}section{break-before:page;margin:0;padding:0}figure{break-inside:avoid}.table-scroll{overflow:visible}.wide table{min-width:0}h1,h2,h3{break-after:avoid}}
'''

def render_html(book):
 spec=book.spec;parts=['<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',f'<title>{esc(spec["title"])}</title><style>{CSS}</style>',f'<header id="contents"><p>{esc(spec["edition"])}</p><h1>{esc(spec["title"])}</h1><p>{esc(spec["introduction"])}</p><p class="reader-note">正文和案例已完整排入本册。编号可在册内跳转；图示可放大。阅读完跳转内容后，可用浏览器返回继续原来的段落。技术原件集中在末尾，日常阅读不需要打开Markdown。</p><details class="toc"><summary>展开完整目录</summary>']
 for d in spec['documents']:parts.append(f'<a href="#{d["id"]}"><small>{esc(d["group"])}</small>{esc(d["title"])}</a>')
 parts.append('</details>')
 for route in spec.get('reading_paths',[]):
  parts.append('<p>'+esc(route['label'])+'：'+' → '.join(f'<a href="#{k}">{esc(book.targets[k])}</a>' for k in route['targets'])+'</p>')
 parts.append('</header><main>')
 def blocks(tokens,d):
  out=[]
  for t in tokens:
   k=t['type']
   if k=='space':continue
   if k=='heading':
    level=min(4,t['depth']+1);out.append(f'<h{level} id="{t["_id"]}">{esc(t["text"])}</h{level}>')
   elif k in ('paragraph','text'):
    if k=='paragraph' and len(t['tokens'])==1 and t['tokens'][0]['type']=='image':
     p,caption=book.image(t['tokens'][0],d);mime=mimetypes.guess_type(p.name)[0];data=base64.b64encode(p.read_bytes()).decode();href=Path(os.path.relpath(p,book.out)).as_posix()
     out.append(f'<figure><a class="zoom" href="{esc(href)}"><img src="data:{mime};base64,{data}" alt="{esc(caption)}" loading="lazy"></a><figcaption>{esc(caption)} · <span>点击或用键盘放大</span></figcaption></figure>')
    else:out.append('<p>'+book.inline(t.get('tokens',[{'type':'text','text':t.get('text','')}]),d)+'</p>')
   elif k=='blockquote':out.append('<blockquote>'+''.join(blocks(t['tokens'],d))+'</blockquote>')
   elif k=='list':
    tag='ol' if t['ordered'] else 'ul';out.append('<'+tag+'>')
    out.extend('<li>'+''.join(blocks(item['tokens'],d))+'</li>' for item in t['items']);out.append('</'+tag+'>')
   elif k=='table':
    wide=len(t['header'])>=3;out.append('<div class="table-scroll '+('wide' if wide else '')+'" tabindex="0" aria-label="研究数据表，可用方向键横向查看"><table><thead><tr>')
    out.extend('<th scope="col">'+book.inline(c['tokens'],d)+'</th>' for c in t['header']);out.append('</tr></thead><tbody>')
    for row in t['rows']:
     rid='claim-'+row[0]['text'] if d['id']=='archive-overview' and row[0]['text'] in book.claims else None
     out.append('<tr'+(f' id="{rid}"' if rid else '')+'>');out.extend('<td>'+book.inline(c['tokens'],d)+'</td>' for c in row);out.append('</tr>')
    out.append('</tbody></table></div>')
    if wide:out.append('<p class="table-help">窄屏可在表格内左右滚动；完整列名与条件均保留。</p>')
   elif k=='code':out.append('<pre>'+esc(t['text'])+'</pre>')
   elif k=='hr':out.append('<hr>')
   else:raise ValueError('Unsupported block '+k)
  return out
 for d in spec['documents']:
  parts.append(f'<section data-document="{d["id"]}"><p class="group">{esc(d["group"])}</p>')
  if d['group'].startswith('原研究记录'):parts.append('<p class="reader-note">以下保留原档案的版本与验证历史，其中“本轮”“当前”和旧入口推荐属于原记录时点。它们没有被用来改写本册的当前阅读入口。</p>')
  parts.extend(blocks(d['tokens'],d));parts.append('<p class="chapter-end"><a href="#contents">返回本册目录</a> · 可继续使用文内编号查阅案例和来源。</p></section>')
 parts.append('<section id="technical-resources"><h2>原件定位与技术记录</h2><p>正文已包含理解本研究所需的论证、表格和画面。下面的索引保留原材料的恢复位置，供需要核验底本或继续研究时使用。它们不会自动打开Markdown源码。</p>')
 for key,r in book.resources.items():parts.append(f'<div class="resource" id="{key}"><h3>{esc(r["label"])}</h3><p>原研究附带材料；'+('当前文件存在。' if r['exists'] else '当前路径不可用，保留历史位置。')+'</p><details><summary>查看原件位置</summary><code>'+esc(Path(os.path.relpath(r['path'],book.out)).as_posix())+'</code></details></div>')
 parts.append('</section></main><a class="back-top" href="#contents">目录</a><dialog aria-label="放大研究图示"><button type="button" autofocus>关闭放大图</button><p>原尺寸查看；可在图内滚动或拖动，关闭后回到原阅读位置。</p><div class="image-viewport" tabindex="0" aria-label="原尺寸图像，可用方向键滚动"><img alt="" style="max-width:none;max-height:none"></div><p class="image-caption"></p></dialog><script>history.scrollRestoration="manual";document.addEventListener("click",e=>{const a=e.target.closest("a");if(a&&a.getAttribute("href")?.startsWith("#"))history.replaceState({...history.state,researchScroll:scrollY},"");});addEventListener("popstate",e=>{if(typeof e.state?.researchScroll==="number")requestAnimationFrame(()=>scrollTo(0,e.state.researchScroll));});const dlg=document.querySelector("dialog");let opener;document.querySelectorAll("a.zoom").forEach(a=>a.addEventListener("click",e=>{if(!dlg.showModal)return;e.preventDefault();opener=a;const im=a.querySelector("img");dlg.querySelector("img").src=im.src;dlg.querySelector("img").alt=im.alt;dlg.querySelector(".image-caption").textContent=im.alt;dlg.showModal();}));dlg.querySelector("button").onclick=()=>dlg.close();dlg.addEventListener("close",()=>opener?.focus());</script></html>')
 target=book.out/'index.html';target.write_text('\n'.join(parts),encoding='utf8',newline='\n');return target

def render_pdf(book,font,symbol_font=None):
 from reportlab.pdfbase import pdfmetrics
 from reportlab.pdfbase.ttfonts import TTFont
 from reportlab.lib.styles import ParagraphStyle
 from reportlab.lib import colors
 from reportlab.lib.pagesizes import A4
 from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,Image,KeepTogether,PageBreak,Preformatted,CondPageBreak
 from reportlab.platypus.tableofcontents import TableOfContents
 from PIL import Image as PILImage
 pdfmetrics.registerFont(TTFont('BookCN',str(font),subfontIndex=0));pdfmetrics.registerFontFamily('BookCN',normal='BookCN',bold='BookCN',italic='BookCN',boldItalic='BookCN')
 glyphs=pdfmetrics.getFont('BookCN').face.charToGlyph
 missing={c for d in book.spec['documents'] for c in Path(d['reader_path']).read_text(encoding='utf8') if ord(c)>32 and not glyphs.get(ord(c))}
 if missing:
  if not symbol_font:raise ValueError('Primary font lacks glyphs; supply --symbol-font: '+repr(sorted(missing)))
  pdfmetrics.registerFont(TTFont('BookSymbols',str(symbol_font)))
  if any(not pdfmetrics.getFont('BookSymbols').face.charToGlyph.get(ord(c)) for c in missing):raise ValueError('Symbol font also lacks required glyphs')
 width=A4[0]-86
 body=ParagraphStyle('body',fontName='BookCN',fontSize=10.5,leading=18,wordWrap='CJK',spaceAfter=10)
 styles={k:ParagraphStyle(k,parent=body,**v) for k,v in {
  'h1':dict(fontSize=21,leading=29,spaceBefore=8,spaceAfter=18,keepWithNext=True,textColor=colors.HexColor('#163f4b')),
  'h2':dict(fontSize=15,leading=23,spaceBefore=18,spaceAfter=10,keepWithNext=True,textColor=colors.HexColor('#163f4b')),
  'h3':dict(fontSize=12,leading=19,spaceBefore=12,spaceAfter=8,keepWithNext=True),
  'cell':dict(fontSize=9,leading=14,spaceAfter=0), 'caption':dict(fontSize=9,leading=14,textColor=colors.HexColor('#526b75')),
  'quote':dict(fontSize=9.5,leading=16,leftIndent=12,textColor=colors.HexColor('#526b75')),
  'toc':dict(fontSize=10.5,leading=20,spaceBefore=5), 'code':dict(fontSize=8,leading=12)}.items()}
 def par(text,style='body'):
  for c in missing:text=text.replace(c,'<font name="BookSymbols">'+c+'</font>')
  return Paragraph(text,body if style=='body' else styles[style])
 class Doc(SimpleDocTemplate):
  def afterFlowable(self,f):
   if hasattr(f,'anchor'):
    self.canv.bookmarkPage(f.anchor)
    level=getattr(f,'outline_level',0)
    self.canv.addOutlineEntry(f.getPlainText(),f.anchor,level=level,closed=(level>0))
    if getattr(f,'toc',False):self.notify('TOCEntry',(0,f.getPlainText(),self.page,f.anchor))
 story=[par(esc(book.spec['title']),'h1'),par(esc(book.spec['edition']),'quote'),par(esc(book.spec['introduction'])),par('本PDF支持可点击目录、章节书签，以及案例和来源编号之间的文内跳转。页脚可返回目录。正文和图已排入本册，阅读研究不需要打开本地Markdown。')]
 for route in book.spec.get('reading_paths',[]):story.append(par(esc(route['label'])+'：'+' → '.join(f'<link href="#{k}" color="#075568">{esc(book.targets[k])}</link>' for k in route['targets']),'quote'))
 story.append(PageBreak())
 contents=par('目录','h1');contents.anchor='contents';contents.outline_level=0;story.append(contents)
 toc=TableOfContents();toc.levelStyles=[styles['toc']];story.extend([toc,PageBreak()])
 def blocks(tokens,d):
  result=[]
  for t in tokens:
   k=t['type']
   if k=='space':continue
   if k=='heading':
    title=('历史附录 · ' if t['depth']==1 and d['group'].startswith('原研究记录') else '')+t['text']
    q=par(esc(title),'h1' if t['depth']==1 else 'h2' if t['depth']==2 else 'h3');q.anchor=t['_id'];q.outline_level=0 if t['depth']==1 else 1;q.toc=t['depth']==1;result.append(q)
   elif k in ('paragraph','text'):
    if k=='paragraph' and len(t['tokens'])==1 and t['tokens'][0]['type']=='image':
     path,caption=book.image(t['tokens'][0],d)
     with PILImage.open(path) as im:iw,ih=im.size
     scale=min(width/iw,320/ih);visual=Image(str(path),width=iw*scale,height=ih*scale)
     result.extend([Spacer(1,10),KeepTogether([visual,Spacer(1,6),par(esc(caption),'caption')]),Spacer(1,6)])
    else:result.append(par(book.inline(t.get('tokens',[{'type':'text','text':t.get('text','')}]),d,True)))
   elif k=='blockquote':
    for item in t['tokens']:
     if item['type']=='paragraph':result.append(par(book.inline(item['tokens'],d,True),'quote'))
     else:result.extend(blocks([item],d))
   elif k=='list':
    for i,item in enumerate(t['items'],1):
     nested=blocks(item['tokens'],d)
     if nested and isinstance(nested[0],Paragraph):nested[0]=par((str(i)+'. ' if t['ordered'] else '• ')+nested[0].text)
     result.extend(nested)
   elif k=='table':
    data=[[par(book.inline(c['tokens'],d,True),'cell') for c in t['header']]]
    for row in t['rows']:
     cells=[]
     for i,c in enumerate(row):
      anchor='<a name="claim-'+c['text']+'"/>' if i==0 and d['id']=='archive-overview' and c['text'] in book.claims else ''
      cells.append(par(anchor+book.inline(c['tokens'],d,True),'cell'))
     data.append(cells)
    n=len(t['header']);weights=[0.17]+[(0.83)/(n-1)]*(n-1) if n>=3 else [1/n]*n
    tb=Table(data,colWidths=[width*x for x in weights],repeatRows=1,hAlign='LEFT')
    tb.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#dcebef')),('LINEBELOW',(0,0),(-1,-1),.3,colors.HexColor('#c7d7dc')),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
    if result and isinstance(result[-1],Paragraph) and hasattr(result[-1],'anchor'):
     # Keep the heading with the first table row, not with the entire long table.
     heading=result.pop();heading.keepWithNext=False;tb.wrap(width,10000)
     result.extend([CondPageBreak(heading.wrap(width,10000)[1]+sum(tb._rowHeights[:2])+32),heading])
    result.extend([tb,Spacer(1,14)])
   elif k=='code':result.append(Preformatted(t['text'],styles['code'],maxLineLength=65))
   elif k=='hr':result.append(Spacer(1,12))
   else:raise ValueError('Unsupported block '+k)
  return result
 for i,d in enumerate(book.spec['documents']):
  if i:story.append(PageBreak())
  if d['group'].startswith('原研究记录'):story.append(par('本节保留原研究的历史记录。“当前”和旧入口推荐属于原记录时点；本册的阅读入口与页脚目录不受影响。','quote'))
  story.extend(blocks(d['tokens'],d))
 story.append(PageBreak());h=par('原件定位与技术记录','h1');h.anchor='technical-resources';h.outline_level=0;h.toc=True;story.append(h)
 story.append(par('以下位置用于恢复原件或继续研究。正文中的机制、案例和画面已经排入本册，阅读不依赖这些技术文件。','quote'))
 for key,r in book.resources.items():
  q=par(esc(r['label']),'h3');q.anchor=key;q.outline_level=1;story.append(q)
  story.append(par(esc(Path(os.path.relpath(r['path'],book.out)).as_posix()),'caption'))
 def footer(c,doc):
  c.setFont('BookCN',8);c.setFillColor(colors.HexColor('#526b75'));c.drawString(43,28,book.spec.get('short_title',book.spec['title'])+' · 返回目录');c.linkRect('','contents',(43,23,225,39),relative=0,thickness=0);c.drawRightString(A4[0]-43,28,str(doc.page))
 target=book.out/(book.spec.get('output_stem','research-full')+'.pdf')
 doc=Doc(str(target),pagesize=A4,leftMargin=43,rightMargin=43,topMargin=38,bottomMargin=48,title=book.spec['title'],author='Research',invariant=1,pageCompression=1)
 doc.multiBuild(story,onFirstPage=footer,onLaterPages=footer)
 return target

def main():
 ap=argparse.ArgumentParser();ap.add_argument('book',type=Path);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--format',choices=['html','pdf','both'],default='both');ap.add_argument('--font',type=Path);ap.add_argument('--symbol-font',type=Path);a=ap.parse_args()
 spec=json.loads(a.book.read_text(encoding='utf8'));a.out.mkdir(parents=True,exist_ok=True);book=Book(spec,a.out.resolve())
 # Resolve links in a first pass so both carriers receive the same resource destinations.
 for d in spec['documents']:
  for t in book.walk(d['tokens']):
   if t['type']=='link':book.target(t['href'],d)
 outputs=[]
 if a.format in ('html','both'):outputs.append(render_html(book))
 if a.format in ('pdf','both'):
  if not a.font or not a.font.is_file():raise ValueError('PDF needs --font')
  outputs.append(render_pdf(book,a.font,a.symbol_font))
 receipt={'book_sha256':sha(a.book),'renderer_sha256':sha(Path(__file__)),'documents':len(spec['documents']),
  'sources':{d['source_path']:d['source_sha256'] for d in spec['documents']},'reader_files':{d['reader_path']:sha(Path(d['reader_path'])) for d in spec['documents']},
  'images':book.images,'resource_targets':book.resources,'output_sha256':{p.name:sha(p) for p in outputs},
  'font_sha256':sha(a.font) if a.font else None,'symbol_font_sha256':sha(a.symbol_font) if a.symbol_font else None,'lexer':spec.get('lexer'),
  'pdf_dependencies':{n:importlib.metadata.version(n) for n in ('reportlab','Pillow')} if a.format in ('pdf','both') else {},
  'effect':'content and production; not proof of human understanding'}
 (a.out/'build-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
 print(json.dumps({'documents':len(spec['documents']),'images':len(book.images),'resources':len(book.resources),'outputs':receipt['output_sha256']},ensure_ascii=False))

if __name__=='__main__':main()
