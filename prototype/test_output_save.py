"""Output-only auto-save regression checks; no model calls or user-folder writes."""
import base64
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import server

PNG = b'\x89PNG\r\n\x1a\n' + b'fixture-payload'
RESULT = {'image': 'data:image/png;base64,' + base64.b64encode(PNG).decode()}


class SaveOutputTests(unittest.TestCase):
    def test_mobile_never_writes_on_host(self):
        with TemporaryDirectory() as root, patch.object(server, 'SAVE_DIR', Path(root) / 'outputs'):
            self.assertEqual(server.save_generated_result(RESULT, 'mobile'), RESULT)
            self.assertFalse(server.SAVE_DIR.exists())

    def test_concurrent_outputs_are_exact_unique_and_contained(self):
        with TemporaryDirectory() as root, patch.object(server, 'SAVE_DIR', Path(root) / 'outputs'):
            with ThreadPoolExecutor(2) as pool:
                results = list(pool.map(lambda _: server.save_generated_result(RESULT, 'desktop-local', '../../试穿'), range(2)))
            paths = [Path(r['savedTo']) for r in results]
            self.assertNotEqual(*paths)
            for path in paths:
                self.assertEqual(path.parent, server.SAVE_DIR)
                self.assertEqual(path.read_bytes(), PNG)
            self.assertEqual(len(list(server.SAVE_DIR.iterdir())), 2)

    def test_collision_does_not_overwrite_or_remove_existing_file(self):
        with TemporaryDirectory() as root, patch.object(server, 'SAVE_DIR', Path(root)), patch.object(server.secrets, 'token_hex', return_value='same'), patch.object(server.time, 'strftime', return_value='fixed'):
            first = server.save_generated_result(RESULT, 'desktop-local')
            second = server.save_generated_result(RESULT, 'desktop-local')
            self.assertIn('saveError', second)
            self.assertEqual(Path(first['savedTo']).read_bytes(), PNG)
            self.assertEqual(second['image'], RESULT['image'])

    def test_write_failure_preserves_generated_image(self):
        with TemporaryDirectory() as root:
            blocked = Path(root) / 'file'; blocked.write_text('existing')
            with patch.object(server, 'SAVE_DIR', blocked):
                output = server.save_generated_result(RESULT, 'desktop-local')
            self.assertIn('saveError', output)
            self.assertEqual(output['image'], RESULT['image'])
            self.assertEqual(blocked.read_text(), 'existing')

    def test_invalid_output_is_not_saved(self):
        with TemporaryDirectory() as root, patch.object(server, 'SAVE_DIR', Path(root) / 'outputs'):
            output = server.save_generated_result({'image': 'data:image/png;base64,YmFk'}, 'desktop-local')
            self.assertIn('saveError', output)
            self.assertFalse(server.SAVE_DIR.exists())


if __name__ == '__main__':
    unittest.main()
