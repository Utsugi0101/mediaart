import unittest

from mojihokori_tracking.sources import MockSource


class MockSourceTests(unittest.TestCase):
    def test_scenario_includes_empty_and_multiple_object_frames(self):
        source = MockSource(start_time=100.0)
        self.assertEqual(source.read(now=101.0), [])
        self.assertEqual([item.kind for item in source.read(now=103.0)], ["food"])
        self.assertEqual(
            [item.kind for item in source.read(now=111.0)],
            ["food", "obstacle", "food"],
        )


if __name__ == "__main__":
    unittest.main()
