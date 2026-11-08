"""Read explicit text selections with one aggregate output bound; no file writes."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path

def encoded(value): return json.dumps(value, ensure_ascii=False, separators=(',', ':'))

def select(raw, start=1, end=None, pointer=None):
    text = raw.decode('utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
    if '\x00' in text: raise ValueError('Binary input; use a media tool')
    if pointer is None: return ''.join(text.splitlines(keepends=True)[start - 1:end])
    value = json.loads(text)
    if pointer and not pointer.startswith('/'): raise ValueError('JSON pointer must start with /')
    for token in pointer.split('/')[1:] if pointer else []:
        key = token.replace('~1', '/').replace('~0', '~')
        if isinstance(value, list):
            if not key.isdigit(): raise ValueError('Invalid array index')
            value = value[int(key)]
        else: value = value[key]
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)

def collect(paths, *, max_chars=6000, start=1, end=None, pointer=None,
            offset=0, expected_sha=None, max_source_bytes=16 * 1024 * 1024):
    if not 800 <= max_chars <= 100000: raise ValueError('max_chars must be 800..100000')
    if not 1 <= len(paths) <= 12: raise ValueError('Select 1..12 explicit files')
    if start < 1 or (end is not None and end < start) or offset < 0: raise ValueError('Invalid range')
    if (offset or expected_sha) and len(paths) != 1: raise ValueError('Resume one file at a time')
    if offset and not expected_sha: raise ValueError('Resume requires --expect-sha256')
    if pointer is not None and (start != 1 or end is not None): raise ValueError('Choose lines or JSON pointer')
    paths = [str(Path(p).resolve()) for p in paths]
    result = {'coverage': 'partial', 'budget_chars': max_chars, 'files': [], 'pending_files': paths[:]}
    if len(encoded(result)) > max_chars: raise ValueError('Metadata exceeds budget; select fewer files')
    for name in paths:
        path = Path(name)
        if path.stat().st_size > max_source_bytes: raise ValueError('Source exceeds max_source_bytes: ' + name)
        raw = path.read_bytes(); identity = hashlib.sha256(raw).hexdigest()
        if expected_sha and identity != expected_sha: raise ValueError('Source changed; restart the selection')
        text = select(raw, start, end, pointer)
        if offset > len(text): raise ValueError('Offset exceeds selected text')
        row = {'path': name, 'sha256': identity, 'selection': {'lines': [start, end]} if pointer is None else {'json_pointer': pointer},
               'offset': offset, 'next_offset': offset, 'selected_chars': len(text), 'complete': False, 'text': ''}
        candidate = {**result, 'files': [*result['files'], row], 'pending_files': result['pending_files'][1:]}
        if len(encoded(candidate)) > max_chars: break
        low, high = 0, min(len(text) - offset, max_chars)
        while low < high:
            n = (low + high + 1) // 2
            row.update(text=text[offset:offset + n], next_offset=offset + n)
            if len(encoded(candidate)) <= max_chars: low = n
            else: high = n - 1
        row.update(text=text[offset:offset + low], next_offset=offset + low, complete=offset + low == len(text))
        result = candidate
        if not row['complete']: break
    if not result['pending_files'] and all(r['complete'] for r in result['files']): result['coverage'] = 'complete'
    assert len(encoded(result)) <= max_chars
    return result

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('paths', nargs='+', type=Path)
    p.add_argument('--max-chars', type=int, default=6000)
    p.add_argument('--start-line', type=int, default=1); p.add_argument('--end-line', type=int)
    p.add_argument('--json-pointer'); p.add_argument('--offset', type=int, default=0)
    p.add_argument('--expect-sha256'); p.add_argument('--max-source-bytes', type=int, default=16 * 1024 * 1024)
    a = p.parse_args()
    try: print(encoded(collect(a.paths, max_chars=a.max_chars, start=a.start_line, end=a.end_line,
                              pointer=a.json_pointer, offset=a.offset, expected_sha=a.expect_sha256,
                              max_source_bytes=a.max_source_bytes)))
    except (OSError, ValueError, KeyError, IndexError, TypeError) as e:
        print(encoded({'coverage': 'not_read', 'error': str(e)[:400]})); return 2
    return 0

if __name__ == '__main__': raise SystemExit(main())
