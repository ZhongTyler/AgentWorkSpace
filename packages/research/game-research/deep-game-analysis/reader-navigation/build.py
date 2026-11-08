"""Add a reversible, offline navigation layer to a reviewed illustrated report."""
import argparse
import hashlib
import html
import json
import re
import importlib.util
from pathlib import Path
from lxml import html as htmltree

BASE = Path(__file__).resolve().parent
_spec=importlib.util.spec_from_file_location('reader_domain_contract',BASE.parent/'dossier.py')
_contract=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_contract)
reader_domains=_contract.reader_domains

def sha(data):
    return hashlib.sha256(data).hexdigest()

def strip_navigation(text):
    if '<!--rn:controls:start-->' not in text:
        return text
    for part in ('controls', 'routebar', 'scripts'):
        text, count = re.subn(rf'<!--rn:{part}:start-->.*?<!--rn:{part}:end-->', '', text, flags=re.S)
        if count != 1:
            raise ValueError(f'Invalid navigation layer: {part}')
    starts = text.count('<!--rn:guide:start-->')
    text, count = re.subn(r'<!--rn:guide:start-->.*?<!--rn:guide:end-->', '', text, flags=re.S)
    if count != starts or '<!--rn:guide:end-->' in text:
        raise ValueError('Invalid navigation guide layer')
    text = text.replace('<!--rn:canvas:start--><div id="reader-canvas">', '')
    return text.replace('</div><!--rn:canvas:end-->', '')

def validate_routes(report, config, original):
    ids = set(re.findall(r'\bid="([^"]+)"', original))
    manifest = json.loads((report / 'manifest.json').read_text(encoding='utf-8'))
    visible=reader_domains(manifest)
    if [r['name'] for r in config['routes']] != [d['name'] for d in visible]:
        raise ValueError('Routes must match the selected reader domains, including order')
    if len({r['id'] for r in config['routes']}) != len(config['routes']):
        raise ValueError('Duplicate route identity')
    if sha(original.encode()) != config['base_html_sha256']:
        raise ValueError('Reviewed report changed; review navigation mappings before rebuilding')
    for route,domain in zip(config['routes'],visible,strict=True):
        if not route['steps']:
            raise ValueError('Empty route')
        for step in route['steps']:
            source = step['source']
            if source['file'] not in manifest['documents']:
                raise ValueError('Source is not a declared report document')
            if source['role'] != ('primary' if source['file']==domain['chapter'] else 'related_section'):
                raise ValueError('Incorrect primary/related source role')
            file = (report / source['file']).resolve()
            if not file.is_relative_to(report.resolve()):
                raise ValueError('Source outside report')
            raw = file.read_bytes()
            if sha(raw) != source['document_sha256']:
                raise ValueError(f'Source changed: {source["file"]}')
            headings = list(re.finditer(r'^#{1,2} .+$', raw.decode('utf-8'), re.M))
            sections = []
            for i, match in enumerate(headings):
                end = headings[i+1].start() if i+1 < len(headings) else len(raw.decode('utf-8'))
                sections.append((re.sub(r'^#+ ', '', match.group()).strip(), sha(raw.decode('utf-8')[match.start():end].strip().encode())))
            if (source['heading'], source['section_sha256']) not in sections:
                raise ValueError('Invalid source section')
            for target in (step['target'], source['detail_target']):
                if target not in ids:
                    raise ValueError(f'Missing target {target}')
            if not step['focus'].strip():
                raise ValueError('Missing reading focus')
    for link in config.get('common_links',[]):
        if link['target'] not in ids:
            raise ValueError('Missing common navigation target')

def build(report):
    config = json.loads((report / 'reader/navigation.json').read_text(encoding='utf-8'))
    target = report / 'reader/index.html'
    raw = target.read_bytes()
    original = strip_navigation(raw.decode('utf-8'))
    validate_routes(report, config, original)
    esc = lambda s: html.escape(str(s), quote=True)
    domains = ''.join('<details class="rn-domain" data-domain="'+esc(r['id'])+'"><summary><span>'+esc(r['name'])+'</span><span class="rn-domain-count">'+str(len(r['steps']))+'节</span></summary><div class="rn-route-intro"><p>'+esc(r['intro'])+'</p></div><ol>'+''.join(f'<li><a href="#{esc(s["target"])}" data-route="{esc(r["id"])}" data-step="{i}" data-target="{esc(s["target"])}"><span class="rn-step-number">{i+1}</span><span><strong>{esc(s["title"])}</strong></span></a></li>' for i,s in enumerate(r['steps']))+'</ol></details>' for r in config['routes'])
    common = '<div class="rn-common"><h3>使用与后续</h3>'+''.join(f'<a href="#{esc(link["target"])}">{esc(link["title"])}</a>' for link in config.get('common_links',[]))+'</div>'
    controls = f'''<style id="rn-styles">{(BASE/'navigation.css').read_text(encoding='utf-8')}</style>
<button id="rn-toggle" aria-controls="rn-panel" aria-expanded="false" hidden>☰ 阅读导航</button>
<aside id="rn-panel" aria-label="阅读导航" hidden>
<div class="rn-panel-head"><div><span class="rn-kicker">{esc(config['title'])}</span><h2>阅读导航</h2></div><button id="rn-close" aria-label="收起阅读导航">收起 ×</button></div>
<div class="rn-modes" role="group" aria-label="侧栏布局"><button data-mode="overlay" aria-pressed="false">悬浮覆盖</button><button data-mode="docked" aria-pressed="false">与正文并排</button></div>
<div class="rn-assist-control"><label for="rn-assist"><input type="checkbox" id="rn-assist" aria-controls="reader-canvas">领域辅助</label><span id="rn-reading-status" aria-live="polite">目录阅读</span></div>
<div class="rn-tabs" role="tablist" aria-label="阅读方式"><button id="rn-tab-toc" role="tab" aria-selected="true" aria-controls="rn-toc" tabindex="0">目录</button><button id="rn-tab-domains" role="tab" aria-selected="false" aria-controls="rn-domains" tabindex="-1">领域</button></div>
<div class="rn-scroll"><div id="rn-toc" role="tabpanel" aria-labelledby="rn-tab-toc"></div><div id="rn-domains" role="tabpanel" aria-labelledby="rn-tab-domains" hidden><p class="rn-panel-intro">展开一个领域，按编号阅读。图解、论证和案例都在本报告内。</p>{domains}{common}</div></div>
<div class="rn-panel-foot"><label><input id="rn-autoclose" type="checkbox"> 跳转后收起侧栏</label><span>Esc 可收起</span></div></aside>'''
    bar = '''<nav id="rn-routebar" aria-label="当前领域阅读路线" hidden>
<div class="rn-route-head"><div class="rn-route-position"><span id="rn-route-label"></span><strong id="rn-route-title"></strong></div><label id="rn-route-perspective-label">本节视角<select id="rn-route-perspective" aria-label="切换本节的领域路线"></select></label></div>
<button id="rn-route-return" hidden>返回当前路线</button>
<div class="rn-route-bottom"><button id="rn-prev"><span>← 上一节</span><strong id="rn-prev-title"></strong></button><progress id="rn-route-progress" aria-label="当前路线位置"></progress><button id="rn-next"><span>下一节 →</span><strong id="rn-next-title"></strong></button></div></nav>'''
    manifest = json.loads((report / 'manifest.json').read_text(encoding='utf-8'))
    source_labels = {s['id']: s.get('label', s['id']) for s in manifest['sources']}
    # Guide cards are presentation metadata, reversibly inserted before the
    # existing sections. Research HTML remains byte-identical after stripping.
    tree = htmltree.fromstring(original, parser=htmltree.HTMLParser(huge_tree=True, no_network=True))
    guided = original
    guide_count = 0
    for section in tree.xpath('//section[@data-scene]'):
        target_id = section.get('id')
        covering = [r for r in config['routes'] if any(s['target'] == target_id for s in r['steps'])]
        if not covering:
            continue
        options = ''.join('<option value="'+esc(r['id'])+'">'+esc(r['name'])+'</option>' for r in covering)
        references = []
        for link in section.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," refs ")]//a'):
            label = link.text_content().strip()
            references.append('<a href="'+esc(link.get('href'))+'">'+esc(source_labels.get(label,label))+'</a>')
        evidence = '<details><summary>查看本节依据</summary><div class="rn-guide-sources">'+''.join(references)+'</div></details>' if references else ''
        title = covering[0]['steps'][next(i for i,s in enumerate(covering[0]['steps']) if s['target']==target_id)]['title']
        card = (f'<!--rn:guide:start--><aside id="rn-guide-{esc(target_id)}" class="rn-guide-card" data-target="{esc(target_id)}" aria-label="本节领域导读" hidden>'
                f'<div class="rn-guide-heading"><label for="rn-perspective-{esc(target_id)}">从<select id="rn-perspective-{esc(target_id)}" class="rn-guide-perspective" aria-label="{esc(title)}的阅读领域">{options}</select>读这一节</label>'
                '<div class="rn-guide-actions"><button data-reader-action="route">查看路线</button><button data-reader-action="exit">关闭领域辅助</button></div></div>'
                '<p class="rn-guide-focus"></p>'+evidence+'</aside><!--rn:guide:end-->')
        needle = re.search(r'<section\b[^>]*\bid="'+re.escape(target_id)+r'"[^>]*>', guided).group()
        if guided.count(needle) != 1:
            raise ValueError('Ambiguous guide target: '+target_id)
        guided = guided.replace(needle,card+needle,1)
        guide_count += 1
    scripts = '<script type="application/json" id="rn-config">'+json.dumps({'report_id':config['report_id'], 'source_labels':source_labels},ensure_ascii=False).replace('<','\\u003c')+'</script><script type="application/json" id="rn-routes">'+json.dumps(config['routes'],ensure_ascii=False).replace('<','\\u003c')+'</script><script id="rn-script">'+(BASE/'navigation.js').read_text(encoding='utf-8')+'</script>'
    for needle in ('<header id="book-cover">','<main>','</main>','</html>'):
        if original.count(needle) != 1:
            raise ValueError(f'Ambiguous insertion point {needle}')
    output = guided.replace('<header id="book-cover">', '<!--rn:controls:start-->'+controls+'<!--rn:controls:end--><!--rn:canvas:start--><div id="reader-canvas"><header id="book-cover">')
    output = output.replace('<main>', '<main><!--rn:routebar:start-->'+bar+'<!--rn:routebar:end-->')
    output = output.replace('</main>', '</main></div><!--rn:canvas:end-->')
    output = output.replace('</html>', '<!--rn:scripts:start-->'+scripts+'<!--rn:scripts:end--></html>')
    if strip_navigation(output) != original:
        raise ValueError('Existing research content changed')
    target.write_bytes(output.encode('utf-8'))
    return {'report_id':config['report_id'], 'base_sha256':sha(original.encode()),'html_sha256':sha(output.encode()),'content_byte_preserved':True,'domains':len(config['routes']),'steps':sum(len(r['steps']) for r in config['routes']),'guides':guide_count,'reading_modes_version':2}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('report',type=Path,nargs='+')
    parser.add_argument('--receipt',type=Path,required=True)
    args = parser.parse_args()
    results = [build(p.resolve()) for p in args.report]
    args.receipt.write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(results))
