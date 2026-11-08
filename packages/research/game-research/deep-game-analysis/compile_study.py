"""Compile an authored study with the existing renderer and navigation layer.

No research, source fetching, semantic decisions, PDF or Knowledge catalog writes.
"""
from __future__ import annotations
import base64
import hashlib
import html
import importlib.util
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
RENDERER = HERE.parents[1] / '.agents/skills/human-research-expression/scripts/render_report.py'

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

renderer = load_module('study_renderer', RENDERER)
navigation = load_module('study_navigation', HERE / 'reader-navigation/build.py')
dossier = load_module('study_dossier', HERE / 'dossier.py')

def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

def local(root, relative):
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise ValueError('Expected a nonempty relative report path')
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('Path escapes report: ' + relative)
    return path

def inputs(report):
    study = read(report / 'study.json')
    manifest = read(report / 'manifest.json')
    routes = read(report / 'reader/navigation.json')
    for field in ('title', 'subtitle', 'edition', 'reader', 'sources', 'sections'):
        if not study.get(field):
            raise ValueError('study.json requires ' + field)
    ids, titles = set(), set()
    for section in study['sections']:
        for field in ('id', 'title', 'subtitle', 'reader_goals', 'references', 'blocks'):
            if not section.get(field):
                raise ValueError('section ' + str(section.get('id')) + ' requires ' + field)
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*', section['id']):
            raise ValueError('Section id must be a portable HTML/filename identity')
        if section['title'] in titles:
            raise ValueError('Duplicate section title would make source mapping ambiguous')
        ids.add(section['id']); titles.add(section['title'])
        for block in section['blocks']:
            if block['type'] == 'image':
                local(report, block['src'])
    # Local raw-source links would break the single-file human reader.
    for source in study['sources'].values():
        if 'path' in source:
            raise ValueError('This single-file study compiler requires HTTPS source links; keep raw archives in the manifest')
    renderer.validate(study, report)
    if [r['name'] for r in routes['routes']] != [d['name'] for d in dossier.reader_domains(manifest)]:
        raise ValueError('Routes differ from the authored reader selection')
    for route in routes['routes']:
        if not route.get('steps'):
            raise ValueError('Empty domain route')
        for step in route['steps']:
            if step['target'] not in ids or not step.get('focus', '').strip():
                raise ValueError('Route target/focus missing')
            if step['source']['file'] != 'README.md' or step['source']['heading'] not in titles:
                raise ValueError('This compiler maps same-source README sections; use the original adapter for other carriers')
    assets = {a['id']: a for a in manifest['assets']}
    if len(assets) != len(manifest['assets']):
        raise ValueError('Duplicate asset id')
    for asset in assets.values():
        if digest(local(report, asset['path'])) != asset['sha256']:
            raise ValueError('Asset changed; verify its evidence before rebuilding: ' + asset['id'])
    sources = {s['id']: s for s in manifest['sources']}
    for key, source in study['sources'].items():
        if key not in sources or sources[key].get('url') != source.get('url'):
            raise ValueError('Study source differs from declared manifest source: ' + key)
    accepted_media = {a['path'] for a in assets.values() if a.get('accepted') is True}
    for section in study['sections']:
        for block in section['blocks']:
            if block['type'] == 'image' and block['src'] not in accepted_media:
                raise ValueError('Image is not a declared accepted asset: ' + block['src'])
        for video in section.get('videos', []):
            asset = assets.get(video)
            if not asset or asset['role'] != 'video_segment' or not asset.get('accepted'):
                raise ValueError('Video is not a declared accepted segment: ' + str(video))
    if manifest.get('allowed_root') != '.':
        raise ValueError('Compiler requires a self-contained report with allowed_root="."')
    errors = []
    dossier.check_domain_baseline(manifest, report, report, errors)
    dossier.evidence_graph(manifest, errors)
    if errors: raise ValueError('; '.join(errors))
    return study, manifest, routes, assets

def section_markdown(section, study, assets):
    text = ['## ' + section['title'], '', section['subtitle'], '']
    for b in section['blocks']:
        kind = b['type']
        if kind in ('p', 'note'): text += [b['text'], '']
        elif kind == 'flow': text += [' → '.join(b['items']), '']
        elif kind == 'image': text += [f'![{b["caption"]}]({b["src"]})', '']
        elif kind == 'table':
            text += ['| ' + ' | '.join(b['headers']) + ' |', '| ' + ' | '.join(['---'] * len(b['headers'])) + ' |']
            text += ['| ' + ' | '.join(str(x) for x in row) + ' |' for row in b['rows']] + ['']
        elif kind == 'links':
            text += [f'[{label}]({study["sources"][key]["url"]})' for label, key in b['items']] + ['']
    for video in section.get('videos', []):
        caption = section.get('video_captions', {}).get(video, '视频资料；核验范围与限制随本节说明')
        text += [f'[{caption}]({assets[video]["path"]})', '']
    return '\n'.join(text).strip() + '\n'

def text_report(study, routes, assets):
    """One text master: opening, domain/system navigation, then full chapters.

    Reuse authored route order and section identities; do not invent domain prose.
    """
    sections = study['sections']
    by_id = {s['id']: s for s in sections}
    def link(sid):
        if sid not in by_id:
            raise ValueError('Text navigation has unknown section: ' + sid)
        return '[' + by_id[sid]['title'] + '](units/' + sid + '.md)'
    lines = ['## 阅读导航', '', '[图解阅读版](reader/index.html)；本页保留完整文字研究，可按领域选读，也可沿章节顺读。', '',
             '### 按领域查阅', '', '选择一个领域，按箭头顺序阅读。共享章节在多个领域引用，正文只维护一份。', '',
             ]
    guided = routes.get('guidance_version') == 1
    if not guided:
        lines += ['| 领域 | 建议阅读顺序 |', '| --- | --- |']
    for route in routes['routes']:
        targets = [s['target'] for s in route['steps']]
        if not targets or len(targets) != len(set(targets)):
            raise ValueError('Text domain route is empty or repeats a section: ' + route['name'])
        if guided:
            lines += ['#### ' + route['name'], '', route['intro'], '']
            for step in route['steps']:
                lines += ['- **' + link(step['target']) + '**。' + step['focus']]
            lines.append('')
        else:
            lines.append('| ' + route['name'] + ' | ' + ' → '.join(link(sid) for sid in targets) + ' |')
    lines += ['', '### 按系统与章节顺读', '']
    layout = study.get('text_toc', study.get('toc_layout'))
    if layout:
        if layout.get('type') != 'grouped':
            raise ValueError('Text TOC requires grouped layout')
        order = list(layout.get('leading', []))
        for sid in layout.get('leading', []): lines.append('- ' + link(sid))
        for group in layout['groups']:
            order += group['sections']
            lines.append('- **' + group['title'] + '**：' + ' → '.join(link(sid) for sid in group['sections']))
        order += layout.get('trailing', [])
        for sid in layout.get('trailing', []): lines.append('- ' + link(sid))
        if order != [s['id'] for s in sections]:
            raise ValueError('Text TOC must cover every section exactly in authored order')
    else:
        lines += ['- ' + link(s['id']) for s in sections]
    bodies = [section_markdown(s, study, assets) for s in sections]
    return '# ' + study['title'] + '\n\n> ' + study['edition'] + '\n\n' + bodies[0] + '\n' + '\n'.join(lines) + '\n\n' + '\n'.join(bodies[1:])


def verify_compiled(report, study, assets):
    bodies = {s['id']: section_markdown(s, study, assets) for s in study['sections']}
    expected = text_report(study, read(report / 'reader/navigation.json'), assets)
    if (report / 'README.md').read_bytes() != expected.encode('utf-8'):
        raise ValueError('Source study and generated README differ; build the current draft first')
    projection = read(report / 'evidence/unit-projections.json')
    if projection['source_study_sha256'] != digest(report / 'study.json') or projection['source_readme_sha256'] != digest(report / 'README.md'):
        raise ValueError('Same-source projection identity is stale')
    if {u['section_id'] for u in projection['units']} != set(bodies) or len(projection['units']) != len(bodies):
        raise ValueError('Projection does not cover the authored sections exactly')
    for unit in projection['units']:
        if unit['source_section_sha256'] != hashlib.sha256(bodies[unit['section_id']].encode()).hexdigest() or digest(local(report, unit['path'])) != unit['sha256']:
            raise ValueError('Generated unit differs from the current source: ' + unit['section_id'])
    verify_explanation_bindings(report, study, bodies)


def verify_explanation_bindings(report, study, bodies):
    """Bind reviewed human explanations to the text master; not a semantic PASS."""
    selected = {s['id']: s['explanation_targets'] for s in study['sections'] if s.get('explanation_targets')}
    ref = study.get('explanation_bindings')
    if not selected and not ref:
        if (report / 'evidence/explanation-bindings.json').exists():
            raise ValueError('Existing explanation bindings cannot be dropped from the text master')
        return
    if not selected or not ref: raise ValueError('Explanation mappings require both text sections and binding file')
    binding = read(local(report, ref))
    if binding.get('source_study_sha256') != digest(report / 'study.json') or binding.get('source_readme_sha256') != digest(report / 'README.md'):
        raise ValueError('Text/reader explanation binding is stale')
    entries = binding.get('sections', [])
    if len(entries) != len(selected) or {e['section_id'] for e in entries} != set(selected):
        raise ValueError('Explanation mapping does not cover the selected text sections')
    reader = (report / 'reader/index.html').read_text(encoding='utf-8')
    for entry in entries:
        sid = entry['section_id']
        if entry['source_section_sha256'] != hashlib.sha256(bodies[sid].encode()).hexdigest() or entry['reader_targets'] != selected[sid]:
            raise ValueError('Explanation source or target mapping changed: ' + sid)
        start = reader.index('<section data-scene="' + sid + '" id="' + sid + '"')
        section = reader[start:reader.index('</section>', start)]
        if any(section.count('id="' + target + '"') != 1 for target in entry['reader_targets']):
            raise ValueError('Mapped reader explanation missing: ' + sid)

def grouped_toc(study, source):
    """Reuse accepted light groups in the common path when explicitly selected."""
    layout = study.get('toc_layout')
    if layout is None: return source
    sections = {s['id']: s for s in study['sections']}
    order = layout['leading'] + [sid for g in layout['groups'] for sid in g['sections']] + layout['trailing']
    if layout['type'] != 'grouped' or order != [s['id'] for s in study['sections']]:
        raise ValueError('TOC grouping must cover each current section once, in reading order')
    if len({g['id'] for g in layout['groups']}) != len(layout['groups']) or any(not g['title'].strip() or not g['sections'] for g in layout['groups']):
        raise ValueError('TOC groups need unique identities, readable titles and members')
    esc = html.escape
    link = lambda sid: '<a href="#' + esc(sid) + '">' + esc(sections[sid]['title']) + '</a>'
    toc = '<nav id="contents" aria-label="章节目录">' + ''.join(link(sid) for sid in layout['leading'])
    for group in layout['groups']:
        toc += '<div class="toc-group" data-toc-group="' + esc(group['id']) + '"><h3>' + esc(group['title']) + '</h3>' + ''.join(link(sid) for sid in group['sections']) + '</div>'
    toc += ''.join(link(sid) for sid in layout['trailing']) + '</nav>'
    source, count = re.subn(r'<nav id="contents" aria-label="章节目录">.*?</nav>', lambda _: toc, source, count=1, flags=re.S)
    if count != 1: raise ValueError('Expected exactly one native TOC to group')
    css = '#contents{display:block}#contents>a{display:block;margin:10px 0}.toc-group{border:1px solid #b7c8ce;background:#f8fbfb;border-radius:10px;padding:14px;margin:14px 0}.toc-group h3{font-size:18px;margin:0 0 10px}.toc-group a{display:block;margin:6px 0;padding:6px 10px;background:transparent;border:0}.toc-group a:focus-visible{outline:3px solid #bd6b00}'
    return source.replace('</style>', css + '</style>', 1)


def compile_report(report, presentation=None):
    study, manifest, routes, assets = inputs(report)
    bodies = {s['id']: section_markdown(s, study, assets) for s in study['sections']}
    full = text_report(study, routes, assets)
    (report / 'README.md').write_text(full, encoding='utf-8', newline='\n')
    projection = []
    for section in study['sections']:
        body = bodies[section['id']]
        path = local(report, 'units/' + section['id'] + '.md')
        path.parent.mkdir(exist_ok=True)
        context = study.get('unit_context', study['title'] + '；' + study['edition'])
        unit = '> ' + context + '\n\n' + body
        media_paths = [b['src'] for b in section['blocks'] if b['type'] == 'image']
        media_paths += [assets[v]['path'] for v in section.get('videos', [])]
        for media in media_paths: unit = unit.replace('](' + media + ')', '](../' + media + ')')
        unit += '\n本节由同一源稿生成。完整阅读见[报告](../README.md)。\n'
        path.write_text(unit, encoding='utf-8', newline='\n')
        projection.append({'section_id': section['id'], 'title': section['title'], 'path': path.relative_to(report).as_posix(), 'source_section_sha256': hashlib.sha256(body.encode()).hexdigest(), 'sha256': digest(path)})
    projected = report / 'evidence/unit-projections.json'
    write_json(projected, {'source_study_sha256': digest(report / 'study.json'), 'source_readme_sha256': digest(report / 'README.md'), 'units': projection})
    out = report / 'reader'; out.mkdir(exist_ok=True)
    renderer.render_html(study, report, renderer.validate(study, report), out)
    hp = out / 'index.html'; source = hp.read_text(encoding='utf-8')
    source = source.replace('<header>', '<header id="book-cover">', 1)
    source = source.replace('<nav aria-label="章节目录">', '<nav id="contents" aria-label="章节目录">', 1)
    for section in study['sections']:
        sid = section['id']
        source = source.replace('<section id="' + sid + '">', '<section data-scene="' + sid + '" id="' + sid + '">', 1)
        heading = '<h2>' + html.escape(section['title'], quote=True) + '</h2>'
        source = source.replace(heading, '<h2 id="' + sid + '-heading">' + html.escape(section['title'], quote=True) + '</h2>', 1)
        if section.get('videos'):
            start = source.index('<section data-scene="' + sid + '"'); end = source.index('</section>', start)
            videos = ''
            for video in section['videos']:
                data = base64.b64encode(local(report, assets[video]['path']).read_bytes()).decode('ascii')
                caption = section.get('video_captions', {}).get(video, '视频资料；核验范围与限制随本节说明')
                videos += '<figure><video controls muted playsinline preload="none" src="data:video/mp4;base64,' + data + '"></video><figcaption>' + html.escape(caption) + '</figcaption></figure>'
            source = source[:end] + videos + source[end:]
    source = source.replace('同稿PDF适合打印与转交；本页图片已内嵌，可离线阅读。原研究链接需要保留原文件夹。', '图片和所列视频已内嵌，可离线阅读；公开出处需联网。')
    source = source.replace('</style>', 'video{display:block;width:100%;max-height:560px}table{display:block;overflow-x:auto}figure img{object-fit:contain}</style>', 1)
    if presentation is not None: source = presentation(study, source)
    elif study.get('toc_layout') is not None: source = grouped_toc(study, source)
    hp.write_text(source, encoding='utf-8', newline='\n')
    documents = set(manifest['documents']) | {'README.md'} | {u['path'] for u in projection}
    manifest['documents'] = sorted(documents)
    manifest['document_hashes'] = {p: digest(local(report, p)) for p in manifest['documents']}
    if study.get('toc_layout') is not None: manifest['reader_study_sha256'] = digest(report / 'study.json')
    for asset in manifest['assets']:
        if asset['path'] == 'evidence/unit-projections.json': asset['sha256'] = digest(projected)
    write_json(report / 'manifest.json', manifest)
    title_to_section = {s['title']: s for s in study['sections']}
    for route, domain in zip(routes['routes'], dossier.reader_domains(manifest), strict=True):
        for step in route['steps']:
            binding = step['source']; section = title_to_section[binding['heading']]
            binding.update(document_sha256=digest(report / 'README.md'), section_sha256=hashlib.sha256(bodies[section['id']].strip().encode()).hexdigest(), detail_target=section['id'] + '-heading', role='primary' if domain['chapter'] == 'README.md' else 'related_section')
    routes['base_html_sha256'] = digest(hp)
    write_json(out / 'navigation.json', routes)
    nav_result = navigation.build(report)
    checked = dossier.checks(manifest, report)
    if checked['status'] != 'pass': raise ValueError('Dossier check failed: ' + '; '.join(checked['errors']))
    return {'sections': len(study['sections']), 'units': len(projection), 'domains': len(routes['routes']), 'navigation': nav_result, 'dossier': checked}
