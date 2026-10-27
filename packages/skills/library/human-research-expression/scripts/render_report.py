"""Render an authored explanation to self-contained HTML and PDF; never summarize evidence.

Python + ReportLab. Chinese font paths are explicit inputs, not bundled assets.
"""
import argparse
import base64
import hashlib
import html
import importlib.metadata
import json
import mimetypes
import os
from pathlib import Path

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def esc(text): return html.escape(str(text), quote=True)

def validate(spec, base):
    if spec.get('schema') != 1 or not spec.get('reader') or not spec.get('sections'):
        raise ValueError('schema=1, reader and nonempty sections required')
    ids, files = set(), {}
    for key, source in spec['sources'].items():
        if 'path' in source:
            path = (base / source['path']).resolve(strict=True)
            files[key] = path
        elif not source.get('url', '').startswith('https://'):
            raise ValueError(f'{key}: local file or HTTPS source required')
    for section in spec['sections']:
        if section['id'] in ids: raise ValueError('duplicate section id')
        ids.add(section['id'])
        if not section.get('reader_goals') or not section.get('references'):
            raise ValueError('each section needs goals and references')
        for key in section['references']:
            if key not in spec['sources']: raise ValueError(f'unknown reference {key}')
        for block in section['blocks']:
            kind = block['type']
            if kind == 'image':
                if not block.get('caption'): raise ValueError('image needs explanation caption')
                path = (base/block['src']).resolve(strict=True)
                files['image:'+block['src']] = path
            elif kind == 'table':
                n = len(block['headers'])
                if any(len(row) != n for row in block['rows']): raise ValueError('ragged table')
                if 'widths' in block and (len(block['widths']) != n or abs(sum(block['widths'])-1)>0.001):
                    raise ValueError('table widths must sum to one')
            elif kind == 'links':
                for label, key in block['items']:
                    if key not in spec['sources']: raise ValueError(f'unknown link {key}')
            elif kind == 'flow':
                if not block.get('items'): raise ValueError('flow needs nonempty items')
            elif kind not in ('p', 'note'): raise ValueError(f'unsupported block: {kind}')
    return files

CSS = '''
.picture{position:relative}.marker{position:absolute;transform:translate(-50%,-50%);width:28px;height:28px;background:white;border:2px solid #176d78;border-radius:50%;font-size:16px;font-weight:bold;text-align:center;line-height:24px;color:#143a49}
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#e9edef;color:#182a34;font:18px/1.8 system-ui,"Microsoft YaHei",sans-serif}
header,main,footer{max-width:960px;margin:auto}header{padding:48px 32px 24px}h1{font-size:36px;line-height:1.35;margin:12px 0}header p{color:#49606c}
nav{display:flex;gap:8px;flex-wrap:wrap}nav a{font-size:14px;padding:4px 10px;background:white;border:1px solid #b7c8ce;border-radius:4px}
section{background:white;padding:42px 48px;margin:28px 0;border-top:5px solid #176d78;scroll-margin-top:20px}h2{font-size:29px;line-height:1.45;margin:0 0 10px}.subtitle{color:#49606c;font-size:16px}
p{margin:18px 0}figure{margin:24px 0}figure img{display:block;width:100%;height:auto}figcaption{font-size:15px;line-height:1.7;background:#edf3f4;padding:12px 16px}
table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:16px;line-height:1.7;margin:22px 0}th,td{padding:12px;vertical-align:top;border-bottom:1px solid #cedade;overflow-wrap:anywhere}th{text-align:left;background:#dcebef}
.note{font-size:15px;line-height:1.8;border-left:4px solid #b38a36;padding:10px 16px;background:#faf6ec}.flow{display:flex;align-items:stretch;gap:8px;flex-wrap:wrap;margin:24px 0}.flow span{flex:1;min-width:120px;background:#e4f1f1;border:1px solid #84b4b7;padding:14px;font-size:16px;position:relative}.flow span:not(:last-child)::after{content:'→';position:absolute;right:-13px;top:40%;background:white;z-index:1}
a{color:#075568;text-underline-offset:3px}a:focus-visible{outline:3px solid #bd6b00;outline-offset:3px}.refs{font-size:13px;color:#526975;margin-top:22px;border-top:1px solid #dce5e8;padding-top:8px}footer{padding:20px 32px 48px;font-size:15px}
@media(max-width:650px){header{padding:24px 18px}h1{font-size:28px}section{padding:28px 18px;margin:16px 0}h2{font-size:24px}table{font-size:14px}td,th{padding:8px}.flow{flex-direction:column;gap:20px}.flow span{width:100%;min-width:0}.flow span:not(:last-child)::after{right:50%;top:auto;bottom:-25px;transform:rotate(90deg)}}
@media print{body{background:white;font-size:11pt}header,footer{display:none}section{break-before:page;border:0;margin:0;padding:0;box-shadow:none}.flow{break-inside:avoid}figure,table{break-inside:avoid}a{color:inherit}}
'''

def link_url(source, files, outdir, key, pdf=False):
    if 'url' in source: return source['url']
    return Path(os.path.relpath(files[key], outdir)).as_posix()

def render_html(spec, base, files, outdir):
    chunks = ['<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
        '<title>'+esc(spec['title'])+'</title><style>'+CSS+'</style>',
        '<header><p>'+esc(spec['subtitle'])+'</p><h1>'+esc(spec['title'])+'</h1><p>'+esc(spec['reader'])+'</p><details><summary>阅读目录（'+str(len(spec['sections']))+'节）</summary><nav aria-label="章节目录">']
    for i,s in enumerate(spec['sections'],1): chunks.append(f'<a href="#{esc(s["id"])}">{i:02} · {esc(s["title"])}</a>')
    chunks.append('</nav></details></header><main>')
    for i,s in enumerate(spec['sections'],1):
        chunks.append(f'<section id="{esc(s["id"])}"><p class="subtitle">{i:02} / {len(spec["sections"]):02}</p><h2>{esc(s["title"])}</h2><p class="subtitle">{esc(s["subtitle"])}</p>')
        for b in s['blocks']:
            t=b['type']
            if t in ('p','note'): chunks.append(f'<p class="{t}">{esc(b["text"])}</p>')
            elif t=='flow': chunks.append('<div class="flow" aria-label="概念关系">'+''.join('<span>'+esc(x)+'</span>' for x in b['items'])+'</div>')
            elif t=='image':
                path=(base/b['src']).resolve(); data=base64.b64encode(path.read_bytes()).decode()
                marks=''.join(f'<span class="marker" aria-hidden="true" style="left:{m["x"]*100}%;top:{m["y"]*100}%">{esc(m["label"])}</span>' for m in b.get('markers',[]))
                chunks.append(f'<figure><div class="picture"><img alt="{esc(b["caption"])}" src="data:{mimetypes.guess_type(path.name)[0]};base64,{data}">{marks}</div><figcaption>{esc(b["caption"])}</figcaption></figure>')
            elif t=='table':
                chunks.append('<table>')
                if b.get('widths'): chunks.append('<colgroup>'+''.join(f'<col style="width:{v*100}%">' for v in b['widths'])+'</colgroup>')
                chunks.append('<thead><tr>'+''.join('<th scope="col">'+esc(x)+'</th>' for x in b['headers'])+'</tr></thead><tbody>')
                chunks.extend('<tr>'+''.join('<td>'+esc(x)+'</td>' for x in row)+'</tr>' for row in b['rows'])
                chunks.append('</tbody></table>')
            elif t=='links':
                chunks.append('<ul>')
                for label,key in b['items']:
                    chunks.append(f'<li><a href="{esc(link_url(spec["sources"][key],files,outdir,key))}">{esc(label)}</a></li>')
                chunks.append('</ul>')
        chunks.append('<p class="refs">原研究定位：'+ '；'.join(f'<a href="{esc(link_url(spec["sources"][k],files,outdir,k))}">{esc(k)}</a>' for k in s['references'])+'</p></section>')
    chunks.append('</main><footer>同稿PDF适合打印与转交；本页图片已内嵌，可离线阅读。原研究链接需要保留原文件夹。</footer></html>')
    (outdir/'index.html').write_text('\n'.join(chunks),encoding='utf8',newline='\n')

def render_pdf(spec, base, files, outdir, font):
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak, KeepTogether, Flowable
    from reportlab.pdfgen.canvas import Canvas
    from functools import partial
    pdfmetrics.registerFont(TTFont('BodyCN',str(font),subfontIndex=0))
    pdfmetrics.registerFontFamily('BodyCN',normal='BodyCN',bold='BodyCN',italic='BodyCN',boldItalic='BodyCN')
    pagew,pageh=A4; width=pagew-80
    styles={
        'title':ParagraphStyle('TitleCN',fontName='BodyCN',fontSize=23,leading=31,textColor=colors.HexColor('#143a49'),spaceAfter=12,wordWrap='CJK'),
        'sub':ParagraphStyle('SubCN',fontName='BodyCN',fontSize=10,leading=16,textColor=colors.HexColor('#526b76'),spaceAfter=16,wordWrap='CJK'),
        'p':ParagraphStyle('Body',fontName='BodyCN',fontSize=11,leading=18,spaceAfter=12,wordWrap='CJK'),
        'note':ParagraphStyle('Note',fontName='BodyCN',fontSize=9,leading=14,spaceBefore=6,spaceAfter=12,textColor=colors.HexColor('#6a552f'),wordWrap='CJK'),
        'caption':ParagraphStyle('Caption',fontName='BodyCN',fontSize=9,leading=14,spaceBefore=7,spaceAfter=14,textColor=colors.HexColor('#405a66'),wordWrap='CJK'),
        'cell':ParagraphStyle('Cell',fontName='BodyCN',fontSize=10,leading=16,wordWrap='CJK'),
        'ref':ParagraphStyle('Ref',fontName='BodyCN',fontSize=8,leading=12,textColor=colors.HexColor('#526b76'),wordWrap='CJK')}
    def para(text,kind='p'): return Paragraph(esc(text),styles[kind])
    class FlowDiagram(Flowable):
        def __init__(self, items):
            super().__init__();self.width=width;self.gap=15
            self.boxw=(width-self.gap*(len(items)-1))/len(items)
            self.paras=[para(str(i+1)+'. '+x,'cell') for i,x in enumerate(items)]
            self.height=max(q.wrap(self.boxw-18,500)[1] for q in self.paras)+22
        def draw(self):
            c=self.canv
            for i,q in enumerate(self.paras):
                x=i*(self.boxw+self.gap)
                c.setFillColor(colors.HexColor('#e4f1f1'));c.setStrokeColor(colors.HexColor('#84b4b7'))
                c.roundRect(x,0,self.boxw,self.height,5,fill=1,stroke=1)
                h=q.wrap(self.boxw-18,self.height)[1];q.drawOn(c,x+9,(self.height-h)/2)
                if i<len(self.paras)-1:
                    a=x+self.boxw+2;b=x+self.boxw+self.gap-2;y=self.height/2
                    c.setStrokeColor(colors.HexColor('#176d78'));c.setLineWidth(1)
                    c.line(a,y,b,y);c.line(b-4,y+3,b,y);c.line(b-4,y-3,b,y)
    class AnnotatedImage(Flowable):
        def __init__(self,path,w,h,marks):
            super().__init__();self.path=path;self.width=w;self.height=h;self.marks=marks
        def draw(self):
            c=self.canv;c.drawImage(str(self.path),0,0,width=self.width,height=self.height,mask='auto')
            for m in self.marks:
                x=m['x']*self.width;y=(1-m['y'])*self.height
                c.setFillColor(colors.white);c.setStrokeColor(colors.HexColor('#176d78'));c.setLineWidth(1.3);c.circle(x,y,8,fill=1,stroke=1)
                c.setFillColor(colors.HexColor('#143a49'));c.setFont('BodyCN',10);c.drawCentredString(x,y-3,m['label'])
    story=[]
    for n,s in enumerate(spec['sections']):
        if n: story.append(PageBreak())
        label=spec.get('short_title',spec['title'])
        story.extend([para(f'{n+1:02} / {len(spec["sections"]):02}  ·  {label}', 'sub'),para(s['title'],'title'),para(s['subtitle'],'sub')])
        for b in s['blocks']:
            t=b['type']
            if t in ('p','note'): story.append(para(b['text'],t))
            elif t=='image':
                from PIL import Image as PILImage
                path=(base/b['src']).resolve()
                with PILImage.open(path) as im: iw,ih=im.size
                w=min(width,470); h=w*ih/iw
                visual=AnnotatedImage(path,w,h,b['markers']) if b.get('markers') else Image(str(path),width=w,height=h)
                story.append(KeepTogether([visual,para(b['caption'],'caption')]))
            elif t=='flow': story.extend([FlowDiagram(b['items']),Spacer(1,14)])
            elif t=='table':
                data=[[para(x,'cell') for x in b['headers']]]+[[para(x,'cell') for x in row] for row in b['rows']]
                widths=[x*width for x in b.get('widths',[1/len(b['headers'])]*len(b['headers']))]
                tb=Table(data,colWidths=widths,hAlign='LEFT',repeatRows=1 if t=='table' else 0)
                tb.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#dcebef')),('LINEBELOW',(0,0),(-1,-1),0.4,colors.HexColor('#c1d3d9')),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9)]))
                story.extend([tb,Spacer(1,14)])
            elif t=='links':
                for label,key in b['items']:
                    source=spec['sources'][key]
                    if 'url' in source:
                        story.append(Paragraph(f'<link href="{esc(source["url"])}" color="#075568">{esc(label)}</link>',styles['p']))
                    else:
                        location=source.get('reader_path',link_url(source,files,outdir,key))
                        story.extend([para(label,'cell'),para('原件：'+location,'ref'),Spacer(1,6)])
        story.extend([Spacer(1,5),para('原研究定位：'+'；'.join(s['references']),'ref')])
    def foot(canvas,doc):
        canvas.setStrokeColor(colors.HexColor('#c8d8dc'));canvas.line(40,42,pagew-40,42)
        canvas.setFont('BodyCN',8);canvas.setFillColor(colors.HexColor('#526b76'))
        canvas.drawString(40,28,spec.get('edition','事实与局限见原研究'))
        canvas.drawRightString(pagew-40,28,str(doc.page))
    doc=SimpleDocTemplate(str(outdir/'reading-guide.pdf'),pagesize=A4,rightMargin=40,leftMargin=40,topMargin=32,bottomMargin=54,title=spec['title'],author=spec.get('author','Research'),pageCompression=1,invariant=1)
    doc.build(story,onFirstPage=foot,onLaterPages=foot,canvasmaker=partial(Canvas,invariant=1))

def main():
    ap=argparse.ArgumentParser();ap.add_argument('spec',type=Path);ap.add_argument('--out',type=Path,required=True)
    ap.add_argument('--format',choices=['both','html','pdf'],default='both');ap.add_argument('--font',type=Path)
    args=ap.parse_args();path=args.spec.resolve(strict=True);base=path.parent
    spec=json.loads(path.read_text(encoding='utf8'));files=validate(spec,base)
    out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    if args.format in ('pdf','both') and (not args.font or not args.font.is_file()):
        raise ValueError('PDF needs a readable --font; HTML can run without ReportLab/font')
    if args.format in ('html','both'): render_html(spec,base,files,out)
    if args.format in ('pdf','both'): render_pdf(spec,base,files,out,args.font)
    expected=['index.html'] if args.format=='html' else ['reading-guide.pdf'] if args.format=='pdf' else ['index.html','reading-guide.pdf']
    receipt={'input_sha256':sha(path),'renderer_sha256':sha(Path(__file__)), 'sections':len(spec['sections']),'reader':spec['reader'],
        'sources':{k:{'path':os.path.relpath(v,base).replace('\\','/'),'sha256':sha(v)} for k,v in files.items()},
        'outputs':{name:sha(out/name) for name in expected},
        'verified':'render_only; not factual audit or human comprehension',
        'pdf_font':str(args.font) if args.format in ('pdf','both') else None,
        'pdf_font_sha256':sha(args.font) if args.format in ('pdf','both') else None,
        'dependency_versions':{name:importlib.metadata.version(name) for name in ('reportlab','Pillow')} if args.format in ('pdf','both') else {}}
    (out/'build-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
    print(json.dumps({'sections':len(spec['sections']),'files':list(receipt['outputs']),'source_files':len(files)},ensure_ascii=False))

if __name__=='__main__': main()
