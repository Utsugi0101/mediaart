import json
import tempfile
import unittest
from pathlib import Path

from mojihokori_tracking.config import load_config


class ConfigTests(unittest.TestCase):
    def test_loads_camel_case_json(self):
        payload = {
            "source": "mock",
            "server": {"broadcastHz": 12},
            "tracking": {"confirmationFrames": 3},
            "camera": {"screenCorners": [[0, 0], [100, 0], [100, 50], [0, 50]]},
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            config = load_config(path)

        self.assertEqual(config.source, "mock")
        self.assertEqual(config.server.broadcast_hz, 12)
        self.assertEqual(config.tracking.confirmation_frames, 3)
        self.assertEqual(config.camera.screen_corners[2], (100.0, 50.0))

    def test_rejects_an_unbounded_class(self):
        payload = {"model": {"allowedClasses": ["food", "hand"]}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_config(path)


if __name__ == "__main__":
    unittest.main()
