from pathlib import Path
import tempfile
import unittest
from read_context import collect, encoded

class BoundedReadTests(unittest.TestCase):
    def test_total_bound_lossless_resume_and_stale_identity(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd() / '.tmp') as directory:
            a = Path(directory) / 'a.md'; b = Path(directory) / 'b.md'
            text = '中文\\引号"\n' * 900
            a.write_text(text, encoding='utf-8'); b.write_text('second file', encoding='utf-8')
            result = collect([a, b], max_chars=900)
            self.assertLessEqual(len(encoded(result)), 900)
            self.assertEqual(result['coverage'], 'partial'); self.assertEqual(result['pending_files'], [str(b)])
            row = result['files'][0]; pieces = [row['text']]
            while not row['complete']:
                result = collect([a], max_chars=900, offset=row['next_offset'], expected_sha=row['sha256'])
                self.assertLessEqual(len(encoded(result)), 900)
                row = result['files'][0]; pieces.append(row['text'])
            self.assertEqual(''.join(pieces), text)
            a.write_text('changed', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Source changed'): collect([a], expected_sha=row['sha256'])

    def test_field_selection_lines_and_invalid_range(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd() / '.tmp') as directory:
            a = Path(directory) / 'a.json'; a.write_text('{"a/b":{"~x":["chosen", "other"]}}', encoding='utf-8')
            self.assertEqual(collect([a], pointer='/a~1b/~0x/0')['files'][0]['text'], 'chosen')
            a.write_bytes(b'one\r\ntwo\r\nthree\r\n')
            self.assertEqual(collect([a], start=2, end=2)['files'][0]['text'], 'two\n')
            with self.assertRaises(ValueError): collect([a], offset=999)
            with self.assertRaises(ValueError): collect([a], max_source_bytes=1)

if __name__ == '__main__': unittest.main()
