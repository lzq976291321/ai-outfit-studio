"""Verify real generation requests include the chosen style without calling ChatGPT."""
import json
import unittest
from unittest.mock import patch
import server


class PhotographyStylesTests(unittest.TestCase):
    def test_each_style_reaches_bridge_with_detail_and_user_choices(self):
        styles = json.loads((server.ROOT / 'photography_styles.json').read_text(encoding='utf-8'))
        for name, sections in styles.items():
            with self.subTest(style=name), patch.object(server, 'local_chatgpt', return_value={}) as bridge:
                server.generate({'references': ['data:image/png;base64,iVBORw0KGgo='] * 3,
                                 'hasPerson': True, 'hasPose': True, 'pose': '坐姿 · 侧面',
                                 'style': name, 'extra': '咖啡馆门外'})
                request = bridge.call_args.args[0]
                prompt = request['prompt']
                for text in sections.values():
                    self.assertIn(text, prompt)
                self.assertIn('图片2仅用于人物身份', prompt)
                self.assertIn('图片3仅用于姿势', prompt)
                self.assertIn('坐姿 · 侧面', prompt)
                self.assertIn('咖啡馆门外', prompt)
                self.assertIn('9:16', prompt)
                for other, other_sections in styles.items():
                    if other != name:
                        self.assertNotIn(other_sections['光线'], prompt)
                bridge.assert_called_once()

    def test_unknown_style_never_calls_upstream(self):
        with patch.object(server, 'local_chatgpt') as bridge:
            with self.assertRaisesRegex(ValueError, '摄影风格'):
                server.generate({'references': ['data:image/png;base64,iVBORw0KGgo='], 'style': 'unknown'})
            bridge.assert_not_called()
