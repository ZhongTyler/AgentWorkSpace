from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ReadmeLanguages(unittest.TestCase):
    def test_language_links_commands_and_local_targets(self):
        chinese = (ROOT / 'README.md').read_text(encoding='utf-8')
        english = (ROOT / 'README.en.md').read_text(encoding='utf-8')
        self.assertIn('[English](README.en.md)', chinese)
        self.assertIn('[简体中文](README.md)', english)
        self.assertEqual(re.findall(r'```text\n(.*?)```', chinese, re.S), re.findall(r'```text\n(.*?)```', english, re.S))
        for text in (chinese, english):
            for link in re.findall(r'\]\(([^)]+)\)', text):
                if '://' not in link and not link.startswith('#'):
                    self.assertTrue((ROOT / link.split('#')[0]).exists(), link)
            self.assertIn('fetch --packages travel research --apply', text)
            self.assertIn('fetch --all --apply', text)
            self.assertIn('AWS-Travel', text)
            self.assertIn('AWS-Knowledge', text)


if __name__ == '__main__':
    unittest.main(verbosity=2)
