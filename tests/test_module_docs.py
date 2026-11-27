from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import module_docs


class LocalizedPanorama(unittest.TestCase):
    def test_chinese_caption_preserved_and_changed_graph_rejected(self):
        rendered = module_docs.block({'skills': {'name': 'Skills', 'related': []}}, 'skills')
        localized = rendered.replace(
            '虚线表示可选协作。具体用途与接口见 module.json 和协作说明。 / Dashed edges indicate optional cooperation. See module.json and the cooperation guide.',
            '虚线表示可选协作，具体用途与接口见 module.json 和协作说明。')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'README.md'
            path.write_text(localized, encoding='utf8')
            module_docs.replace(path, rendered, check=True)
            module_docs.replace(path, rendered)
            self.assertEqual(localized, path.read_text('utf8'))
            path.write_text(localized.replace('skills["Skills"]', 'skills["Other"]'), encoding='utf8')
            with self.assertRaisesRegex(ValueError, 'Stale panorama'):
                module_docs.replace(path, rendered, check=True)
