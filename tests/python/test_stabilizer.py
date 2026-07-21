import unittest

from mojihokori_tracking.config import TrackingConfig
from mojihokori_tracking.protocol import Detection
from mojihokori_tracking.stabilizer import TrackStabilizer


class StabilizerTests(unittest.TestCase):
    def setUp(self):
        self.stabilizer = TrackStabilizer(
            TrackingConfig(
                smoothing_alpha=0.5,
                deadzone=0.01,
                moving_threshold=0.1,
                missing_grace_seconds=0.5,
                confirmation_frames=2,
            )
        )

    def test_confirms_and_smooths_a_track(self):
        first = Detection(7, "food", 0.2, 0.3, 0.9, ((0.1, 0.2), (0.3, 0.2), (0.2, 0.4)))
        self.assertEqual(self.stabilizer.update([first], now=1.0), [])
        objects = self.stabilizer.update(
            [Detection(7, "food", 0.4, 0.5, 0.95, first.contour)],
            now=2.0,
        )
        self.assertEqual(len(objects), 1)
        self.assertEqual(objects[0].id, "track-food-7")
        self.assertAlmostEqual(objects[0].x, 0.3)
        self.assertAlmostEqual(objects[0].y, 0.4)
        self.assertTrue(objects[0].moving)

    def test_short_loss_is_held_and_camera_loss_does_not_expire(self):
        detection = Detection("stone", "obstacle", 0.5, 0.5, 1.0)
        self.stabilizer.update([detection], now=1.0)
        self.stabilizer.update([detection], now=1.1)
        self.assertEqual(len(self.stabilizer.update([], now=1.4)), 1)
        self.assertEqual(len(self.stabilizer.update([], now=5.0, camera_ok=False)), 1)
        self.assertEqual(self.stabilizer.update([], now=5.0, camera_ok=True), [])

    def test_ignores_non_simulation_classes(self):
        hand = Detection("hand", "hand", 0.5, 0.5, 1.0)
        self.assertEqual(self.stabilizer.update([hand], now=1.0), [])


if __name__ == "__main__":
    unittest.main()
