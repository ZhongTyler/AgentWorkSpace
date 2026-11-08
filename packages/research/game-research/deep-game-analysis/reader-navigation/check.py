"""Static report/navigation integrity. No browser or semantic approval implied."""
import argparse
import json
import re
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from lxml import html
from build import sha, strip_navigation, validate_routes

class AttributeCheck(HTMLParser):
    def __init__(self,source):
        super().__init__();self.repeated=[];self.feed(source)
    def handle_starttag(self,tag,attrs):
        if sum(k=='id' for k,_ in attrs)>1:self.repeated.append(tag)

def check(report, *, trusted_large_report=False):
    raw=(report/'reader/index.html').read_bytes()
    text=raw.decode('utf-8'); original=strip_navigation(text)
    config=json.loads((report/'reader/navigation.json').read_text(encoding='utf-8'))
    validate_routes(report,config,original)
    # Only generated local reports opt in to large embedded-image input.
    tree=html.fromstring(raw, parser=html.HTMLParser(huge_tree=trusted_large_report, no_network=True))
    old=html.fromstring(original, parser=html.HTMLParser(huge_tree=trusted_large_report, no_network=True))
    ids=Counter(tree.xpath('//@id'))
    source_checks=[]
    for route in config['routes']:
        for i,step in enumerate(route['steps']):
            source=step['source']; heading=tree.get_element_by_id(source['detail_target']).text_content().strip()
            # Formatting whitespace may have been collapsed by the report renderer.
            normalized=lambda s:re.sub(r'\s+','',s.replace('`',''))
            source_checks.append({'domain':route['name'],'step':i+1,'title':step['title'],'target':step['target'],
                'source':source['file'],'heading':source['heading'],'detail_target':source['detail_target'],
                'rendered_heading_matches':normalized(heading)==normalized(source['heading'])})
    bad_links=[a for a in tree.xpath('//a/@href') if a.startswith('#') and a[1:] not in ids]
    external=[(e.tag,e.get(k)) for e in tree.iter() for k in ('src','poster') if e.get(k) and not e.get(k).startswith('data:')]
    local=[a for a in tree.xpath('//a/@href') if not a.startswith(('#','data:','https://','http://'))]
    serialize=lambda e:html.tostring(e,encoding='utf-8',with_tail=False)
    guides = tree.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," rn-guide-card ")]')
    guide_checks = []
    for guide in guides:
        target = guide.get('data-target')
        expected = [r['id'] for r in config['routes'] if any(s['target']==target for s in r['steps'])]
        following = guide.xpath('following-sibling::*[1]')
        guide_checks.append(bool(following) and following[0].get('id') == target
                            and guide.xpath('.//select/option/@value') == expected)
    route_links = tree.xpath('//*[@id="rn-panel"]//a[@data-route]')
    expected_links = [(r['id'],s['target']) for r in config['routes'] for s in r['steps']]
    checks={
        'original_exact_bytes_recoverable':sha(original.encode())==config['base_html_sha256'],
        'original_scene_document_nodes_unchanged':[serialize(e) for e in tree.xpath('//*[@data-scene or @data-document]')]==[serialize(e) for e in old.xpath('//*[@data-scene or @data-document]')],
        'images_unchanged':tree.xpath('//img/@src')==old.xpath('//img/@src'),
        'original_scripts_unchanged':[e.text for e in tree.xpath('//script[not(starts-with(@id,"rn-"))]')]==[e.text for e in old.xpath('//script')],
        'all_scripts_parsed_completely':[s.replace('\r\n','\n').replace('\r','\n') for s in re.findall(r'<script\b[^>]*>(.*?)</script\s*>',text,re.I|re.S)]==[(e.text or '') for e in tree.xpath('//script')],
        'no_duplicate_ids':not any(n>1 for n in ids.values()),
        'no_repeated_id_attributes':not AttributeCheck(text).repeated,
        'no_broken_internal_links':not bad_links,
        'self_contained_resources':not external,
        'no_local_file_links':not local,
        'one_main_canvas':len(tree.xpath('//main'))==1 and ids['reader-canvas']==1,
        'all_source_headings_match':all(s['rendered_heading_matches'] for s in source_checks),
        'guide_domains_match_following_sections':all(guide_checks) and len(guides)==len({s['target'] for r in config['routes'] for s in r['steps']}),
        'sidebar_and_controller_routes_match':[(a.get('data-route'),a.get('data-target')) for a in route_links]==expected_links,
        'embedded_routes_match_authored_data':json.loads(tree.get_element_by_id('rn-routes').text)==config['routes'],
        'fallback_original_contents':ids['contents']==1 and all('hidden' in tree.get_element_by_id(i).attrib for i in ['rn-panel','rn-routebar','rn-toggle']),
    }
    return {'report_id':config['report_id'],'html_sha256':sha(raw),'base_sha256':config['base_html_sha256'],
            'domains':len(config['routes']),'steps':len(source_checks),'checks':checks,'issues':{'bad_links':bad_links,'external':external,'local':local,'headings':[s for s in source_checks if not s['rendered_heading_matches']]},'pass':all(checks.values()),'sources':source_checks,
            'browser':{'status':'not_verified','reason':'CUA blocked file:// navigation; no alternate route used'},'reader_effect':'not_measured'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('report',type=Path,nargs='+');p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    results=[check(r.resolve()) for r in a.report]
    a.output.write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps([{k:v for k,v in r.items() if k not in ('sources',)} for r in results],ensure_ascii=False))
    raise SystemExit(0 if all(r['pass'] for r in results) else 1)
