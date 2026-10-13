"""Capture a selected public article and original images; not a rendered-page archive."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'runtime'))


def fetch(url, limit):
    if urlparse(url).scheme not in {'http', 'https'}:
        raise ValueError('Only HTTP(S) sources are supported')
    request = Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urlopen(request, timeout=25) as response:
        if urlparse(response.url).scheme not in {'http', 'https'}:
            raise ValueError('Unsupported redirect')
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError('Response exceeds capture size limit')
        return data, response.url, response.headers.get_content_charset() or 'utf-8'


def capture(url, selector, output, download_images, max_images):
    from bs4 import BeautifulSoup
    output = output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError('Preserve existing output; choose an empty directory')
    data, final_url, encoding = fetch(url, 8 * 1024 * 1024)
    soup = BeautifulSoup(data.decode(encoding, errors='replace'), 'html.parser')
    selected = soup.select(selector)
    if len(selected) != 1:
        raise ValueError('Selector must match exactly one article container')
    body = BeautifulSoup(str(selected[0]), 'html.parser')
    for node in body.select('script,style,noscript'):
        node.decompose()
    text = body.get_text('\n', strip=True)
    if not text:
        raise ValueError('Selected content has no text')
    images = body.find_all('img')
    if len(images) > max_images:
        raise ValueError('Image limit exceeded; narrow the selected scope')
    output.mkdir(parents=True, exist_ok=True)
    (output / 'source.html').write_bytes(data)
    (output / 'body.html').write_text(str(body), encoding='utf-8')
    (output / 'body.txt').write_text(text, encoding='utf-8')
    records = []
    for index, image in enumerate(images, 1):
        source = image.get('data-src') or image.get('data-original') or image.get('src')
        record = {'index': index, 'url': urljoin(final_url, source) if source else None,
                  'alt': image.get('alt', ''), 'srcset': image.get('srcset'),
                  'status': 'not_downloaded'}
        if download_images:
            try:
                if not source:
                    raise ValueError('No usable image URL; inspect page/srcset manually')
                payload, resolved, _ = fetch(record['url'], 25 * 1024 * 1024)
                suffix = Path(urlparse(resolved).path).suffix.lower()
                if suffix not in {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'}:
                    suffix = '.img'
                target = output / f'{index:03}{suffix}'
                target.write_bytes(payload)
                record.update(status='downloaded', resolved_url=resolved, path=target.name,
                              bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())
            except Exception as error:
                record.update(status='failed', error=str(error))
        records.append(record)
    canonical = soup.select_one('link[rel="canonical"]')
    manifest = {
        'requested_url': url, 'resolved_url': final_url,
        'canonical_url': urljoin(final_url, canonical['href']) if canonical and canonical.get('href') else final_url,
        'captured_at': datetime.now(timezone.utc).isoformat(), 'selector': selector,
        'title': soup.title.get_text(strip=True) if soup.title else '',
        'metadata': [dict(node.attrs) for node in soup.select('meta[name="author"],meta[property^="article:"]')],
        'source_sha256': hashlib.sha256(data).hexdigest(), 'body_chars': len(text),
        'images': records,
        'links': [{'text': node.get_text(strip=True), 'url': urljoin(final_url, node.get('href', ''))}
                  for node in body.find_all('a', href=True)],
        'boundary': 'Public HTTP source only, not rendered JS/login content or a SingleFile snapshot. Verify author/date, completeness, pagination, lazy media and necessary image meanings before ingest.'
    }
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    failed = sum(record['status'] == 'failed' for record in records)
    print(json.dumps({'output': str(output), 'chars': len(text), 'images': len(records),
                      'downloaded': sum(record['status'] == 'downloaded' for record in records),
                      'failed': failed}, ensure_ascii=False))
    return 2 if failed else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--selector', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--download-images', action='store_true')
    parser.add_argument('--max-images', type=int, default=80)
    args = parser.parse_args()
    raise SystemExit(capture(args.url, args.selector, args.output, args.download_images, args.max_images))
