"""Render an authored visual explanation; no summarization, remote fetch, or inference."""
import argparse,base64,hashlib,html,json,math,re,shutil
from pathlib import Path
from xml.sax.saxutils import escape
COLORS={'ink':'#193541','blue':'#17667a','pale':'#e4f0f2','orange':'#b65726','sand':'#fbebdf','gray':'#50636b','line':'#aac2c8','paper':'#fffdf8'}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def wrap(s,n):
 lines=[]
 for raw in str(s).split('\n'):
  line='';units=0
  for token in re.findall(r'[A-Za-z0-9_]+(?:[-./][A-Za-z0-9_]+)*|.',raw):
   total=sum(1 if ord(c)>255 else .55 for c in token)
   chunks=[token] if total<=n else list(token)
   for chunk in chunks:
    u=sum(1 if ord(c)>255 else .55 for c in chunk)
    if units+u>n and line:lines.append(line);line='';units=0
    line+=chunk;units+=u
  lines.append(line)
 return lines
class Canvas:
 def __init__(self,w):self.w=w;self.h=0;self.ops=[]
 def rect(self,x,y,w,h,fill='pale',stroke=None,r=10):self.ops.append(('rect',x,y,w,h,COLORS.get(fill,fill),COLORS.get(stroke,stroke),r))
 def circle(self,x,y,r,fill='pale'):self.ops.append(('circle',x,y,r,COLORS.get(fill,fill)))
 def ring(self,x,y,r):self.ops.append(('ring',x,y,r))
 def text(self,x,y,s,size=17,color='ink',anchor='start',width=None):
  if anchor=='start':x=max(2,x)
  lines=wrap(s,width or 1000)
  for i,line in enumerate(lines):self.ops.append(('text',x,y+i*size*1.4,line,size,COLORS.get(color,color),anchor))
  return len(lines)*size*1.4
 def line(self,x1,y1,x2,y2,color='blue',arrow=True,dashed=False):self.ops.append(('line',x1,y1,x2,y2,COLORS.get(color,color),arrow,dashed))
 def card(self,x,y,w,label,value,note='',accent=False):
  # Width determines line breaks; font size stays readable in the mobile variant.
  n=(w-28)/17
  label_h=len(wrap(label,n))*16*1.4;value_h=len(wrap(value,(w-28)/18))*18*1.4
  note_h=len(wrap(note,(w-28)/15))*15*1.4 if note else 0
  h=(32 if note else 28)+label_h+value_h+note_h+12
  self.rect(x,y,w,h,'sand' if accent else 'pale')
  used=self.text(x+14,y+26,label,16,'orange' if accent else 'gray',width=n)
  used+=self.text(x+14,y+28+used,value,18,'ink',width=(w-28)/18)
  if note:self.text(x+14,y+32+used,note,15,'gray',width=(w-28)/15)
  return h
 def svg(self):
  parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}" role="img"><style>text{{font-family:"Microsoft YaHei",sans-serif}}</style>']
  for op in self.ops:
   if op[0]=='rect':
    _,x,y,w,h,fill,stroke,r=op;parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"'+(f' stroke="{stroke}"' if stroke else '')+'/>')
   elif op[0]=='circle':
    _,x,y,r,fill=op;parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"/>')
   elif op[0]=='ring':
    _,x,y,r=op;parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="{COLORS["blue"]}" stroke-width="2" stroke-dasharray="5 4"/>')
   elif op[0]=='text':
    _,x,y,s,size,color,anchor=op;parts.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" text-anchor="{anchor}">{escape(s)}</text>')
   else:
    _,x1,y1,x2,y2,color,arrow,dashed=op;parts.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="2"'+(' stroke-dasharray="6 5"' if dashed else '')+'/>')
    if arrow:
     angle=math.atan2(y2-y1,x2-x1);a=9;pts=[(x2,y2),(x2-a*math.cos(angle-.45),y2-a*math.sin(angle-.45)),(x2-a*math.cos(angle+.45),y2-a*math.sin(angle+.45))]
     parts.append('<polygon points="'+' '.join(f'{x},{y}' for x,y in pts)+f'" fill="{color}"/>')
  parts.append('</svg>');return ''.join(parts)
def diagram(visual,w=620):
 c=Canvas(w);kind=visual['kind'];d=visual['data'];mobile=w<450;gap=16
 if kind in ('flow','timeline','cycle'):
  if kind=='cycle' and not mobile and len(d)==4:
   cw=(w-64)/2;positions=[(0,0),(w-cw,0),(w-cw,190),(0,190)]
   c.line(cw+2,54,w-cw-3,54);c.line(w-cw/2,130,w-cw/2,186)
   c.line(w-cw-2,244,cw+3,244);c.line(cw/2,186,cw/2,132)
   bottom=0
   for i,(n,(x,y)) in enumerate(zip(d,positions)):bottom=max(bottom,y+c.card(x,y,cw,n['label'],n['value'],n.get('note',''),i==0))
   c.h=bottom+14
  elif kind=='timeline' and not mobile:
   y=8
   for i,n in enumerate(d):
    note_lines=len(wrap(n.get('note',''),(w-182)/16));value_lines=len(wrap(n['value'],(w-182)/19));rowh=max(76,30+value_lines*27+note_lines*23)
    c.circle(16,y+20,7,'orange' if i==0 else 'blue')
    if i<len(d)-1:c.line(16,y+29,16,y+rowh+8,'line',False)
    c.text(38,y+25,n['label'],16,'blue',width=7)
    used=c.text(170,y+26,n['value'],19,width=(w-182)/19)
    c.text(170,y+32+used,n.get('note',''),16,'gray',width=(w-182)/16);y+=rowh+10
   c.h=y
  elif mobile:
   y=6;last_number_y=None
   for i,n in enumerate(d):
    cw=w-50;x=40;h=c.card(x,y,cw,n['label'],n['value'],n.get('note',''),i==0)
    if i:c.line(16,last_number_y+14,16,y+6)
    c.text(16,y+26,str(i+1),16,'blue','middle');last_number_y=y+26;y+=h+24
   c.h=y-12
  else:
   cols=min(3,len(d));cw=(w-gap*(cols-1))/cols;y=4
   for offset in range(0,len(d),cols):
    heights=[]
    for j,n in enumerate(d[offset:offset+cols]):
     x=j*(cw+gap);h=c.card(x,y,cw,n['label'],n['value'],n.get('note',''),offset+j==0);heights.append(h)
     if j:c.line(x-gap+2,y+36,x-3,y+36)
    y+=max(heights)+32
    if offset+cols<len(d):c.text(w/2,y-10,'↓ 继续看下一行',14,'gray','middle')
   if kind=='cycle':c.text(w/2,y+2,'战斗结局 → 重新约束下一次路线',16,'orange','middle');y+=30
   c.h=y-12
 elif kind=='factorial':
  y=24
  for label,count,unit,total in d['rows']:
   c.text(4,y,label,17);y+=37
   start=24;step=42 if mobile else 47
   for j in range(count):c.circle(start+j*step,y,17);c.text(start+j*step,y+6,str(unit),17,'blue','middle')
   c.text(w-8,y+7,'＝'+str(total),23,'blue','end');y+=30
   c.rect(4,y,w-12,13,'pale',r=3);c.rect(4,y,(w-12)*total/d['max'],13,'blue',r=3);y+=48
  c.text(4,y,d['unit'],14,'gray',width=(w-12)/14);c.h=y+65
 elif kind=='bars':
  y=22;barw=w-110
  for label,value in d['rows']:
   c.text(0,y,label,17);y+=17;c.rect(0,y,barw,18,'pale',r=3);c.rect(0,y,barw*value/d.get('max',100),18,'blue',r=3);c.text(barw+12,y+16,f'{value:g}'+('%' if kind=='bars' else ''),17,'blue');y+=50
  c.text(0,y,d['unit'],14,'gray',width=w/14);c.h=y+45
 elif kind=='compare':
  stacked=mobile or len(d['lanes'])>2
  widths=[w] if stacked else [(w-gap)/2]*2;y=10;bottom=0
  for i,(title,items) in enumerate(d['lanes']):
   x=0 if stacked else i*(widths[0]+gap);cw=widths[0];top=y if stacked else 10;start=top
   h=c.text(x+14,top+27,title,18,'blue',width=(cw-28)/18);top+=h+30
   for j,item in enumerate(items):
    if not d.get('ordered',False):c.circle(x+18,top-6,2.5,'blue')
    top+=c.text(x+30,top,item,17,'ink',width=(cw-44)/17)+16
    if d.get('ordered',False) and j<len(items)-1:c.line(x+22,top-10,x+22,top+4);top+=28
   # Border is added first in the final primitive sequence so it never covers text.
   c.ops.insert(0,('rect',x,start,cw,top-start+8,COLORS['pale'],None,10));bottom=max(bottom,top+8)
   if stacked:y=top+26
  label_height=c.text(0,bottom+28,d.get('label',''),14,'gray',width=w/14)
  c.h=bottom+28+label_height+8
 elif kind=='branches':
  start=d['start'];h=c.card(0,0,w,start[0],start[1]);y=h+30
  branches=d['branches'];cols=1 if mobile else len(branches);cw=(w-gap*(cols-1))/cols;bottom=y
  for i,n in enumerate(branches):
   x=0 if mobile else i*(cw+gap);yy=bottom+24 if mobile and i else y
   if not mobile:c.line(w/2,h+2,x+cw/2,yy-4)
   hh=c.card(x,yy,cw,*n,accent=i==0);bottom=max(bottom,yy+hh)
  c.h=bottom+8
 elif kind=='network':
  if mobile:
   h=c.card(0,0,w,*d['center'],accent=True);y=h+28
   for i,n in enumerate(d['nodes']):
    c.line(18,y-18,18,y+15);c.text(18,y+30,'↔',17,'blue','middle');hh=c.card(40,y,w-40,n[0],n[1]);y+=hh+18
   c.h=y
  else:
   cw=190;points=[(0,0),(w-cw,0),(0,165),(w-cw,165),((w-cw)/2,330)]
   for x,y in points:c.line(w/2,235,x+cw/2,y+55,arrow=False)
   c.card((w-180)/2,185,180,*d['center'],accent=True)
   for n,(x,y) in zip(d['nodes'],points):c.card(x,y,cw,*n)
   c.h=455
 elif kind=='account':
  y=26
  for i,(label,value,note) in enumerate(d['rows']):
   c.text(0,y,label,17);c.text(w-8,y,str(value),24,'blue','end');y+=16
   c.rect(0,y,w,22,'pale',r=3);c.rect(0,y,w*value/d['max'],22,'blue',r=3);y+=48
   y+=c.text(0,y,note,16,'gray',width=w/16)+10
  c.text(0,y,d['unit'],14,'gray',width=w/14);c.h=y+40
 elif kind=='split':
  # Object identity and quantity are the point; circles are enemies, not estimates of hidden intervals.
  if mobile:
   pos=[(w/2,55),(w/2,180)];children=[(w*.26,330),(w*.74,330)];c.h=460
  else:pos=[(90,95),(300,95)];children=[(w-85,40),(w-85,180)];c.h=305
  def connect(a,b,ra,rb):
   dx,dy=b[0]-a[0],b[1]-a[1];distance=math.hypot(dx,dy)
   c.line(a[0]+dx*ra/distance,a[1]+dy*ra/distance,b[0]-dx*rb/distance,b[1]-dy*rb/distance)
  connect(pos[0],pos[1],40,40)
  for xy in children:connect(pos[1],xy,40,35)
  for (x,y),value in zip(pos,[d['parent'],d['before']]):c.circle(x,y,40);c.text(x,y+8,str(value),27,'blue','middle')
  for (x,y),value in zip(children,d['children']):c.circle(x,y,35,'sand');c.text(x,y+8,str(value),25,'orange','middle')
  if mobile:
   c.text(10,112,d['labels'][0],16,width=(w-20)/16);c.text(10,240,d['labels'][1],16,width=(w-20)/16);c.text(10,395,d['labels'][2],16,width=(w-20)/16)
  else:
   c.text(0,165,d['labels'][0],16,width=12);c.text(210,165,d['labels'][1],16,width=12);c.text(410,245,d['labels'][2],16,width=12)
 elif kind=='stance':
  nodes=[d['first'],d['second'],d['return']];y=0
  for i,n in enumerate(nodes):
   hh=c.card(0,y,w,n[0],n[1],n[2],accent=i==1);y+=hh+32
   if i<2:c.line(w/2,y-29,w/2,y-5)
  c.h=y
 elif kind=='hits':
  y=210 if mobile else 150;xs=[w*.17,w*.5,w*.83]
  for i,(x,label) in enumerate(zip(xs,d['targets'])):c.circle(x,y,38);c.text(x,y+7,label,17,'ink','middle')
  for i,target in enumerate(d['hits']):
   x=22+i*(w-44)/2;yy=24+(i%2)*40;c.circle(x,yy,15,'sand');c.text(x,yy+6,str(i+1),16,'orange','middle');c.line(x,yy+17,xs[target],y-42,'orange')
  c.text(0,y+76,d['label'],16,'gray',width=w/16);c.h=y+120
 elif kind=='hud':
  c.rect(0,0,w,330,'#f3f3ed',stroke='line',r=12)
  c.rect(12,12,w-24,66,'pale');c.text(24,38,d['zones'][0][0],18,'blue');c.text(24,62,d['zones'][0][1],15,'ink',width=(w-48)/15)
  midx=w*.42 if not mobile else 14;midw=w*.55 if not mobile else w-28
  c.rect(midx,108,midw,90,'sand');c.text(midx+12,137,d['zones'][1][0],18,'orange');c.text(midx+12,165,d['zones'][1][1],16,width=(midw-24)/16)
  c.rect(12,240,w-24,78,'pale');c.text(24,267,d['zones'][2][0],18,'blue');c.text(24,294,d['zones'][2][1],15,width=(w-48)/15);c.h=344
 elif kind=='orbs':
  c.text(4,24,'集中＋2：同一对象的单位产出增加',17,'blue',width=(w-12)/17);y=90
  for i,(name,value) in enumerate(d['production']):
   x=(i+0.5)*w/3;c.circle(x,y,32);c.text(x,y+6,value,18,'blue','middle');c.text(x,y+62,name,16,'ink','middle')
  y+=100;y+=c.text(4,y,d['stored'],16,'orange',width=(w-12)/16)+34
  y+=c.text(4,y,d['capacity'],17,'blue',width=(w-12)/17)+24
  for j in range(3):c.ring(35+j*66,y+10,24)
  c.text(245 if not mobile else 218,y+16,'空槽 ≠ 球',16,'orange',width=(w-225)/16);y+=65
  y+=c.text(4,y,d['generated'],17,width=(w-12)/17)+25
  y+=c.text(4,y,d['scope'],14,'gray',width=(w-12)/14)+16;c.h=y
 elif kind=='matrix':
  headers=d['headers'];rows=d['rows'];cols=len(headers)
  if mobile:
   y=0
   for row in rows:
    y+=c.text(12,y+25,row[0],18,'blue',width=(w-24)/18)+22
    for j,val in enumerate(row[1:],1):
     y+=c.text(12,y,headers[j]+'：'+str(val),16,'ink',width=(w-24)/16)+12
    c.line(0,y,w,y,'line',False);y+=15
   c.h=y
  else:
   widths=[w*.22]+[w*.78/(cols-1)]*(cols-1);y=0;c.rect(0,0,w,42,'blue',r=4);x=0
   for j,title in enumerate(headers):c.text(x+10,27,title,16,'#ffffff',width=(widths[j]-20)/16);x+=widths[j]
   y=42
   for row in rows:
    height=max(len(wrap(str(v),(widths[j]-20)/16)) for j,v in enumerate(row))*23+22;x=0
    for j,v in enumerate(row):c.text(x+10,y+24,v,16,'blue' if j==0 else 'ink',width=(widths[j]-20)/16);x+=widths[j]
    y+=height;c.line(0,y,w,y,'line',False)
   c.h=y+10
 else:raise ValueError('Unknown visual kind '+kind)
 return c
def render(spec,out,font,symbol_font):
 from reportlab.pdfbase import pdfmetrics
 from reportlab.pdfbase.ttfonts import TTFont
 from reportlab.lib.colors import HexColor
 from reportlab.lib.styles import ParagraphStyle
 from reportlab.lib.pagesizes import A4
 from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,PageBreak,Image,KeepTogether,Flowable
 from reportlab.platypus.tableofcontents import TableOfContents
 chapters=spec.get('chapters',[]);structured=bool(chapters);by_id={s['id']:s for s in spec['scenes']};chapter_by_id={c['id']:c for c in chapters}
 if structured:
  expected=[s['id'] for s in spec['scenes'] if s.get('role')=='book-overview']
  if len(expected)!=1:raise ValueError('Structured report needs one whole-book overview')
  for c in chapters:
   expected += [c['overview_id'],*c['detail_ids'],c['summary_id']]
   for key,role in [(c['overview_id'],'chapter-overview'),(c['summary_id'],'chapter-summary')]+[(k,'detail') for k in c['detail_ids']]:
    if key not in by_id or by_id[key].get('role')!=role or by_id[key].get('chapter_id')!=c['id']:raise ValueError('Chapter membership mismatch: '+key)
  ending=[s['id'] for s in spec['scenes'] if s.get('role')=='book-conclusion']
  if len(ending)!=1:raise ValueError('Structured report needs one whole-book conclusion')
  expected += ending
  if expected != [s['id'] for s in spec['scenes']] or len(set(expected))!=len(expected):raise ValueError('Whole-part-whole order or unique identity mismatch')
 pdfmetrics.registerFont(TTFont('VisualCN',str(font)));pdfmetrics.registerFont(TTFont('VisualSymbols',str(symbol_font)))
 pdfmetrics.registerFontFamily('VisualCN',normal='VisualCN',bold='VisualCN',italic='VisualCN',boldItalic='VisualCN')
 missing=set()
 def font_for(ch):return 'VisualCN' if pdfmetrics.getFont('VisualCN').face.charToGlyph.get(ord(ch)) else 'VisualSymbols'
 def check_chars(text):
  for ch in text:
   if ord(ch)>32 and not pdfmetrics.getFont(font_for(ch)).face.charToGlyph.get(ord(ch)):missing.add(ch)
 check_chars(json.dumps(spec,ensure_ascii=False));assert not missing,repr(missing)
 def xmltext(text):
  return ''.join(escape(ch) if font_for(ch)=='VisualCN' else '<font name="VisualSymbols">'+escape(ch)+'</font>' for ch in str(text))
 W=A4[0]-88
 class Graphic(Flowable):
  def __init__(self,g):Flowable.__init__(self);self.g=g;self.width=W;self.height=g.h*W/g.w
  def draw(self):
   c=self.canv;s=W/self.g.w;c.saveState();c.scale(s,s)
   for op in self.g.ops:
    if op[0]=='rect':
     _,x,y,w,h,fill,stroke,r=op;c.setFillColor(HexColor(fill));c.setStrokeColor(HexColor(stroke or fill));c.roundRect(x,self.g.h-y-h,w,h,r,stroke=bool(stroke),fill=1)
    elif op[0]=='circle':
     _,x,y,r,fill=op;c.setFillColor(HexColor(fill));c.circle(x,self.g.h-y,r,stroke=0,fill=1)
    elif op[0]=='ring':
     _,x,y,r=op;c.setStrokeColor(HexColor(COLORS['blue']));c.setDash([5,4]);c.circle(x,self.g.h-y,r,stroke=1,fill=0);c.setDash([])
    elif op[0]=='text':
     _,x,y,text,size,color,anchor=op;c.setFillColor(HexColor(color));length=sum(pdfmetrics.stringWidth(ch,font_for(ch),size) for ch in text);x=x-length/2 if anchor=='middle' else x-length if anchor=='end' else x
     for ch in text:c.setFont(font_for(ch),size);c.drawString(x,self.g.h-y,ch);x+=pdfmetrics.stringWidth(ch,font_for(ch),size)
    else:
     _,x1,y1,x2,y2,color,arrow,dashed=op;c.setStrokeColor(HexColor(color));c.setFillColor(HexColor(color));c.setLineWidth(2);c.setDash([6,5] if dashed else []);c.line(x1,self.g.h-y1,x2,self.g.h-y2)
     if arrow:
      angle=math.atan2(y2-y1,x2-x1);a=9;p=c.beginPath();p.moveTo(x2,self.g.h-y2);p.lineTo(x2-a*math.cos(angle-.45),self.g.h-y2+a*math.sin(angle-.45));p.lineTo(x2-a*math.cos(angle+.45),self.g.h-y2+a*math.sin(angle+.45));p.close();c.drawPath(p,stroke=0,fill=1)
   c.restoreState()
 styles={name:ParagraphStyle(name,fontName='VisualCN',fontSize=size,leading=lead,textColor=HexColor(color),spaceAfter=space,wordWrap='CJK') for name,size,lead,color,space in [('title',23,32,COLORS['ink'],14),('body',11.5,19,COLORS['ink'],12),('note',9.5,16,COLORS['gray'],8),('toc',9.5,14,COLORS['blue'],4),('key',12,20,COLORS['blue'],12)]}
 styles['toc-parent']=ParagraphStyle('toc-parent',parent=styles['toc'],fontSize=11,leading=18,spaceBefore=9,spaceAfter=4)
 styles['toc-child']=ParagraphStyle('toc-child',parent=styles['toc'],leftIndent=18,firstLineIndent=0,leading=15,spaceAfter=3)
 def p(text,style='body'):return Paragraph(xmltext(text),styles[style])
 class Doc(SimpleDocTemplate):
  def afterFlowable(self,f):
   if hasattr(f,'anchor'):
    if not hasattr(self,'page_map'):self.page_map={}
    if getattr(f,'chapter_parent',None):
     c=f.chapter_parent;label=f'第{c["number"]}章　{c["title"]}';self.canv.bookmarkPage(c['id']);self.canv.addOutlineEntry(label,c['id'],0);self.page_map[c['id']]=self.page;self.notify('TOCEntry',(0,label,self.page,c['id']))
    self.canv.bookmarkPage(f.anchor);self.canv.addOutlineEntry(f.label,f.anchor,getattr(f,'outline_level',0));self.page_map[f.anchor]=self.page
    if getattr(f,'toc_entry',False):self.notify('TOCEntry',(getattr(f,'outline_level',0),f.label,self.page,f.anchor))
 if structured:
  story=[];toc=TableOfContents();toc.levelStyles=[styles['toc-parent'],styles['toc-child']]
 else:
  story=[p(spec['title'],'title'),p(spec['edition'],'note'),p(spec['intro']),p('按问题读图，按需核证','key')]
  for i,s in enumerate(spec['scenes'],1):
   q=Paragraph(f'<link href="#{s["id"]}" color="{COLORS["blue"]}">{i:02}　{xmltext(s["title"])}</link>',styles['toc']);story.append(q)
 # TOC can span pages naturally, while each explanation starts on a fresh page.
 assets=out/'assets';assets.mkdir(parents=True,exist_ok=True);source_hashes={};views={};htmlparts=[]
 for index,s in enumerate(spec['scenes'],1):
  if not structured or index>1:story.append(PageBreak())
  if structured and index==1:story.extend([p(spec['title'],'title'),p(spec['edition'],'note')])
  role=s.get('role','detail');chapter=chapter_by_id.get(s.get('chapter_id'));child_number=s.get('section_number')
  phase={'book-overview':'全篇总览','chapter-overview':'本章总览','detail':'分项图解','chapter-summary':'本章小结','book-conclusion':'全篇总结'}[role]
  eyebrow=((f'{child_number} · 分项图解' if child_number else phase)+'　'+(f'第{chapter["number"]}章 · {chapter["title"]}' if chapter else s['group'])) if structured else f'{index:02} / {len(spec["scenes"]):02}　{s["group"]}'
  story.append(p(eyebrow,'note'))
  h=p(s['title'],'title');h.anchor=s['id'];h.label=(f'{child_number}　{s["title"]}' if role=='detail' else ('总览｜' if role=='chapter-overview' else '小结｜' if role=='chapter-summary' else '')+s['title']) if structured else s['title']
  h.outline_level=1 if structured and chapter else 0;h.toc_entry=structured
  if role=='chapter-overview':h.chapter_parent=chapter
  story.extend([h,p(s['lead'])])
  wide=diagram(s['visual']);narrow=diagram(s['visual'],340);views[s['id']]={'wide_height':wide.h,'mobile_height':narrow.h}
  for name,g in [('wide',wide),('mobile',narrow)]:
   (assets/f'{s["id"]}-{name}.svg').write_text(g.svg(),encoding='utf8',newline='\n')
  story.extend([Graphic(wide),Spacer(1,14),p(s['takeaway'],'key')])
  pic=''
  if s.get('image_path'):
   from PIL import Image as PILImage
   path=Path(s['image_path']);assert sha(path)==s['image_sha256'];source_hashes[str(path)]=sha(path)
   dest=assets/(s['id']+path.suffix);shutil.copyfile(path,dest)
   with PILImage.open(path) as im:iw,ih=im.size
   scale=min(W/iw,155/ih);visual=Image(str(path),iw*scale,ih*scale)
   story.append(KeepTogether([visual,Spacer(1,4),p(s.get('image_caption','原研究已核画面'),'note')]))
   pic=f'<figure class="evidence-image"><a href="assets/{dest.name}" class="zoom"><img src="assets/{dest.name}" alt="{html.escape(s.get("image_caption","原研究画面"))}"></a><figcaption>{html.escape(s.get("image_caption","原研究画面"))}</figcaption></figure>'
  for note in s['limits']:story.append(p('边界：'+note,'note'))
  short_names={'system01':'整体玩法与系统','system02':'战斗与角色','system03':'数值与资源','system04':'关卡与难度','system05':'交互文案与表现','system06':'制作与方法','evidence':'证据附录','validation':'验证记录','reuse':'实际复用','audit-revision':'审计历史'}
  labels=[('案例E'+r[4:]) if r.startswith('case') else short_names.get(r,spec['reference_titles'][r]) for r in s['refs']]
  story.append(p('依据：'+' · '.join(labels)+('　结论编号：'+'、'.join(s['claims']) if s['claims'] else ''),'note'))
  links=' '.join(f'<a href="{html.escape(spec["evidence_reader"])}#{r}">{html.escape(spec["reference_titles"][r])}</a>' for r in s['refs'])
  local_nav='<a class="back" href="#contents">回目录</a>'
  if structured:
   if chapter:
    if role=='chapter-overview':
     paths=[(key,f'{by_id[key]["section_number"]}　{by_id[key]["title"]}') for key in chapter['detail_ids']]+[(chapter['summary_id'],'本章小结')]
     local_nav='<details class="chapter-roadmap"><summary>本章图解与小结</summary><ol>'+''.join(f'<li><a href="#{key}">{html.escape(label)}</a></li>' for key,label in paths)+'</ol></details>'+local_nav
     story.append(Paragraph(f'<link href="#{chapter["summary_id"]}" color="{COLORS["blue"]}">直达本章小结</link> · <link href="#contents" color="{COLORS["blue"]}">本章分项见阅读目录</link>',styles['note']))
    elif role=='chapter-summary':
     nxt=chapters[chapter['number']] if chapter['number']<len(chapters) else None
     key,label=(nxt['overview_id'],'下一章总览：'+nxt['title']) if nxt else ('book-conclusion','进入全篇总结')
     local_nav=f'<nav class="reading-links" aria-label="章间阅读"><a href="#{chapter["overview_id"]}">回看本章总览</a><a href="#{key}">{html.escape(label)}</a></nav>'+local_nav
     story.append(Paragraph(f'<link href="#{key}" color="{COLORS["blue"]}">{xmltext(label)}</link>',styles['note']))
    else:local_nav=f'<nav class="reading-links" aria-label="本章归纳"><a href="#{chapter["overview_id"]}">回本章总览</a><a href="#{chapter["summary_id"]}">看本章小结</a></nav>'+local_nav
   elif role=='book-overview':local_nav=f'<nav class="reading-links" aria-label="开始阅读"><a href="#{chapters[0]["overview_id"]}">从第一章开始</a><a href="#contents">看分层目录</a></nav>'
   else:local_nav='<nav class="reading-links"><a href="#book-overview">回看全篇总览</a><a href="#contents">回阅读目录</a></nav>'
  level=3 if structured and chapter else 2
  htmlparts.append(f'<section id="{s["id"]}" data-scene data-role="{role}"><p class="eyebrow">{html.escape(eyebrow)}</p><h{level} class="scene-title">{html.escape(s["title"])}</h{level}><p class="lead">{html.escape(s["lead"])}</p><figure class="diagram"><div class="wide">{wide.svg()}</div><div class="mobile">{narrow.svg()}</div></figure><p class="takeaway">{html.escape(s["takeaway"])}</p>{pic}<aside>'+''.join('<p>'+html.escape(n)+'</p>' for n in s['limits'])+f'</aside><details><summary>核对本节依据与详细记录</summary><p>{links}</p><p>编号：'+html.escape('、'.join(s['claims']))+'</p><p>链接进入已排版的证据底本，常规读图不需要离开本页。</p></details>'+local_nav+'</section>')
  if structured and role=="book-overview":
   heading=p("阅读目录","title");heading.anchor="contents";heading.label="阅读目录";story.extend([PageBreak(),heading,toc])
 def footer(c,doc):
  c.setFont('VisualCN',8);c.setFillColor(HexColor(COLORS['gray']));c.drawString(44,27,spec['short_title']+' · 回目录');c.drawRightString(A4[0]-44,27,str(doc.page));c.linkRect('','contents',(42,22,245,39),thickness=0)
 if not structured:story[0].anchor='contents';story[0].label='目录'
 pdf=out/'visual-study.pdf';doc=Doc(str(pdf),pagesize=A4,leftMargin=44,rightMargin=44,topMargin=38,bottomMargin=48,title=spec['title'],author='Research',invariant=1)
 if structured:doc.multiBuild(story,onFirstPage=footer,onLaterPages=footer)
 else:doc.build(story,onFirstPage=footer,onLaterPages=footer)
 css='''*{box-sizing:border-box}body{margin:0;background:#efeee8;color:#193541;font:18px/1.8 system-ui,"Microsoft YaHei",sans-serif}header,main{max-width:920px;margin:auto}header{padding:36px}h1{font-size:38px;line-height:1.35}h2{font-size:30px;line-height:1.45;margin:10px 0 18px}section{padding:36px 44px;background:#fffdf8;margin:22px 0;scroll-margin-top:12px}.eyebrow{font-size:14px;color:#50636b}.lead{max-width:44em}.diagram{margin:26px 0}.diagram svg{width:100%;height:auto;display:block}.mobile{display:none}.takeaway{border-left:4px solid #17667a;padding:12px 16px;background:#e4f0f2;font-size:20px}aside{font-size:15px;line-height:1.75;color:#50636b}aside p{margin:8px 0}a{color:#17667a;text-underline-offset:3px}a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #b65726;outline-offset:4px}summary{cursor:pointer;padding:10px 0}details{font-size:15px;border-top:1px solid #aac2c8;margin-top:18px;overflow-wrap:anywhere}details a{display:block;padding:5px}nav a{display:block;padding:7px 0}.evidence-image{margin:20px 0}.evidence-image img{max-width:100%;height:auto}figcaption{font-size:14px;color:#50636b}.back{display:inline-block;font-size:14px;margin-top:18px}dialog{max-width:96vw;max-height:94vh;border:0;padding:16px}dialog img{max-width:88vw;max-height:76vh}dialog::backdrop{background:#152e38cc}button{font:inherit;padding:10px 20px}.top{position:fixed;right:12px;bottom:12px;padding:8px 14px;background:white;border:1px solid #aac2c8;font-size:14px}@media(max-width:600px){header{padding:22px}h1{font-size:29px}h2{font-size:25px}section{padding:24px 20px;margin:12px 0}.wide{display:none}.mobile{display:block}.takeaway{font-size:18px}.diagram svg{max-width:420px;margin:auto}}@media print{body{background:white}.top,details,dialog{display:none}section{break-before:page;margin:0;padding:0}}'''
 toc=''.join(f'<a href="#{s["id"]}">{i:02}　{html.escape(s["title"])}</a>' for i,s in enumerate(spec['scenes'],1))
 if structured:
  toc='<a href="#book-overview">开篇总览</a><ol class="book-toc">'
  for c in chapters:
   childlinks=f'<li><a href="#{c["overview_id"]}">{html.escape(by_id[c["overview_id"]]["title"])}</a></li>'
   childlinks+=''.join(f'<li><a href="#{key}">{html.escape(by_id[key]["section_number"]+"　"+by_id[key]["title"])}</a></li>' for key in c['detail_ids'])
   childlinks+=f'<li><a href="#{c["summary_id"]}">{html.escape(by_id[c["summary_id"]]["title"])}</a></li>'
   toc+=f'<li><a href="#{c["id"]}">第{c["number"]}章　{html.escape(c["title"])}</a><details class="toc-chapter"><summary>总览 → {len(c["detail_ids"])}个分项图解 → 小结</summary><ol>{childlinks}</ol></details></li>'
  toc+='</ol><a href="#book-conclusion">全篇总结</a>'
  parts={s['id']:part for s,part in zip(spec['scenes'],htmlparts)}
  nested=[parts['book-overview'],f'<nav class="contents" id="contents" aria-label="分层研究目录"><h2>阅读目录</h2>{toc}</nav>']
  for c in chapters:
   nested.append(f'<article data-chapter="{c["id"]}" id="{c["id"]}"><div class="chapter-heading"><p>第{c["number"]}章</p><h2>{html.escape(c["title"])}</h2><p>{html.escape(c["question"])}</p></div>')
   nested.extend(parts[key] for key in [c['overview_id'],*c['detail_ids'],c['summary_id']]);nested.append('</article>')
  nested.append(parts['book-conclusion']);htmlparts=nested
  css+='''.scene-title{font-size:30px;line-height:1.45;margin:10px 0 18px}.chapter-heading{background:#193541;color:#fffdf8;padding:30px 44px;margin-top:36px}.chapter-heading p{margin:8px 0}.contents{background:#fffdf8;padding:30px 44px;margin:22px 0}.book-toc{list-style:none;padding-left:0}.book-toc>li{margin:18px 0}.toc-chapter ol,.chapter-roadmap ol{list-style:none;padding-left:20px}.toc-chapter{margin:4px 0}.chapter-roadmap a{display:block;padding:6px 0}.reading-links{display:flex;gap:20px;flex-wrap:wrap;font-size:15px;margin:18px 0}article>section{margin-top:12px}.contents a{font-size:17px}.contents details a{font-size:15px}@media(max-width:600px){.scene-title{font-size:25px}.chapter-heading,.contents{padding:24px 20px}.book-toc{padding-left:20px}}'''
 markup=f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(spec["title"])}</title><style>{css}</style><header id="contents"><p class="eyebrow">{html.escape(spec["edition"])}</p><h1>{html.escape(spec["title"])}</h1><p>{html.escape(spec["intro"])}</p><details><summary>按问题选择阅读</summary><nav>{toc}</nav></details></header><main>'+''.join(htmlparts)+'</main><a href="#contents" class="top">目录</a><dialog aria-label="查看研究原画面"><button autofocus>关闭</button><div><img alt=""></div></dialog><script>const dlg=document.querySelector("dialog");let opener;document.querySelectorAll(".zoom").forEach(a=>a.addEventListener("click",e=>{if(!dlg.showModal)return;e.preventDefault();opener=a;let im=a.querySelector("img");dlg.querySelector("img").src=im.src;dlg.querySelector("img").alt=im.alt;dlg.showModal()}));dlg.querySelector("button").onclick=()=>dlg.close();dlg.addEventListener("close",()=>opener?.focus());</script></html>'
 if structured:
  start=markup.index('<header id="contents">');end=markup.index('</header>',start)+len('</header>')
  markup=markup[:start]+f'<header id="book-cover"><p class="eyebrow">{html.escape(spec["edition"])}</p><h1>{html.escape(spec["title"])}</h1><p>{html.escape(spec["intro"])}</p><a href="#contents">跳到分层目录</a></header>'+markup[end:]
 (out/'index.html').write_text(markup,encoding='utf8',newline='\n')
 return {'images':source_hashes,'diagram_layouts':views,'page_map':getattr(doc,'page_map',{}),'chapters':chapters,'output_sha256':{p.name:sha(p) for p in (pdf,out/'index.html')},'effect':'Production only; target-reader understanding unverified.'}
def main():
 ap=argparse.ArgumentParser();ap.add_argument('story',type=Path);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--font',type=Path,required=True);ap.add_argument('--symbol-font',type=Path,required=True);a=ap.parse_args()
 spec=json.loads(a.story.read_text(encoding='utf8'));a.out.mkdir(parents=True,exist_ok=True)
 for p,h in spec['source_hashes'].items():assert sha(Path(p))==h,'Changed source '+p
 result=render(spec,a.out,a.font,a.symbol_font);result.update({'story_sha256':sha(a.story),'renderer_sha256':sha(Path(__file__)),'font_sha256':sha(a.font),'symbol_font_sha256':sha(a.symbol_font)})
 (a.out/'build-receipt.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n');print(json.dumps({'scenes':len(spec['scenes']),'outputs':result['output_sha256']}))
if __name__=='__main__':main()
