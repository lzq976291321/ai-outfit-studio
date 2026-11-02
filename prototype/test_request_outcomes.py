"""Local bridge failures stay explicit; no login file or real bridge is used."""
import subprocess
import unittest
from unittest.mock import patch
import server


class RequestOutcomeTests(unittest.TestCase):
    def test_timeout_is_unknown(self):
        with patch.object(server.subprocess, 'run', side_effect=subprocess.TimeoutExpired('node', 260)):
            with self.assertRaises(server.LocalGenerationError) as context:
                server.local_chatgpt({})
        self.assertEqual(context.exception.output['outcome'], 'unknown')
        self.assertEqual(context.exception.output['errorCode'], 'LOCAL_TIMEOUT')

    def test_unparseable_bridge_result_is_unknown(self):
        with patch.object(server.subprocess, 'run', return_value=subprocess.CompletedProcess('node', 0, 'truncated')):
            with self.assertRaises(server.LocalGenerationError) as context:
                server.local_chatgpt({})
        self.assertEqual(context.exception.output['outcome'], 'unknown')

    def test_backend_allows_four_generations_and_releases_capacity(self):
        slots = server.GENERATIONS
        acquired = 0
        try:
            for _ in range(4):
                self.assertTrue(slots.acquire(blocking=False))
                acquired += 1
            self.assertFalse(slots.acquire(blocking=False))
        finally:
            for _ in range(acquired):
                slots.release()
        self.assertTrue(slots.acquire(blocking=False))
        slots.release()
