from __future__ import annotations

import math
import time
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

from .config import CameraConfig, ModelConfig
from .protocol import Detection, Point


def _ellipse_contour(x: float, y: float, radius_x: float, radius_y: float) -> List[Point]:
    return [
        (
            x + math.cos(step * math.tau / 16) * radius_x,
            y + math.sin(step * math.tau / 16) * radius_y,
        )
        for step in range(16)
    ]


class MockSource:
    """A repeating add/move/remove scenario for camera-free integration tests."""

    def __init__(self, start_time: Optional[float] = None):
        self.start_time = time.monotonic() if start_time is None else start_time

    def read(self, now: Optional[float] = None) -> List[Detection]:
        current = time.monotonic() if now is None else now
        phase = (current - self.start_time) % 24.0
        detections: List[Detection] = []

        if 2.0 <= phase < 20.0:
            angle = phase * 0.18
            x = 0.32 + math.cos(angle) * 0.09
            y = 0.56 + math.sin(angle) * 0.07
            detections.append(
                Detection("mock-food-1", "food", x, y, 0.98, _ellipse_contour(x, y, 0.025, 0.035))
            )

        if 6.0 <= phase < 18.0:
            x = 0.7
            y = 0.43 + math.sin(phase * 0.24) * 0.025
            detections.append(
                Detection(
                    "mock-obstacle-1",
                    "obstacle",
                    x,
                    y,
                    0.97,
                    _ellipse_contour(x, y, 0.075, 0.055),
                )
            )

        if 10.0 <= phase < 16.0:
            x = 0.5
            y = 0.27
            detections.append(
                Detection("mock-food-2", "food", x, y, 0.96, _ellipse_contour(x, y, 0.024, 0.032))
            )

        return detections

    def close(self) -> None:
        return None


class CameraModelSource:
    """Ultralytics instance segmentation over an OpenCV camera device."""

    def __init__(self, camera: CameraConfig, model: ModelConfig):
        try:
            import cv2  # type: ignore
            import numpy as np  # type: ignore
            from ultralytics import YOLO  # type: ignore
        except ImportError as error:
            raise RuntimeError(
                "Camera mode requires the vision extra: uv sync --extra vision"
            ) from error

        model_path = Path(model.path)
        if not model_path.is_file():
            raise RuntimeError(f"Model weights not found: {model_path}")

        self.cv2 = cv2
        self.np = np
        self.camera_config = camera
        self.model_config = model
        self.capture = cv2.VideoCapture(camera.index, cv2.CAP_AVFOUNDATION)
        self.capture.set(cv2.CAP_PROP_FRAME_WIDTH, camera.width)
        self.capture.set(cv2.CAP_PROP_FRAME_HEIGHT, camera.height)
        self.capture.set(cv2.CAP_PROP_FPS, camera.fps)
        if not self.capture.isOpened():
            raise RuntimeError(f"Could not open camera index {camera.index}")
        self.model = YOLO(str(model_path))
        self.homography = self._build_homography(camera.screen_corners)

    def _build_homography(self, corners: Optional[Sequence[Point]]):
        if corners is None:
            return None
        source = self.np.asarray(corners, dtype=self.np.float32)
        target = self.np.asarray(
            [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
            dtype=self.np.float32,
        )
        return self.cv2.getPerspectiveTransform(source, target)

    def _normalize_points(self, points, frame_width: int, frame_height: int):
        values = self.np.asarray(points, dtype=self.np.float32).reshape(-1, 1, 2)
        if self.homography is not None:
            normalized = self.cv2.perspectiveTransform(values, self.homography).reshape(-1, 2)
        else:
            normalized = values.reshape(-1, 2)
            normalized[:, 0] /= max(frame_width, 1)
            normalized[:, 1] /= max(frame_height, 1)
        return self.np.clip(normalized, 0.0, 1.0)

    def read(self) -> List[Detection]:
        ok, frame = self.capture.read()
        if not ok:
            raise RuntimeError("Camera frame could not be read")

        results = self.model.track(
            frame,
            persist=True,
            verbose=False,
            conf=self.model_config.confidence,
            iou=self.model_config.iou,
            imgsz=self.model_config.image_size,
            device=self.model_config.device,
        )
        result = results[0]
        if result.boxes is None or result.masks is None:
            return []

        frame_height, frame_width = frame.shape[:2]
        class_ids = result.boxes.cls.detach().cpu().tolist()
        confidences = result.boxes.conf.detach().cpu().tolist()
        track_ids = (
            result.boxes.id.detach().cpu().tolist()
            if result.boxes.id is not None
            else list(range(len(class_ids)))
        )
        detections = []
        for index, polygon in enumerate(result.masks.xy):
            kind = str(result.names[int(class_ids[index])])
            if kind not in self.model_config.allowed_classes:
                continue
            simplified = self.cv2.approxPolyDP(
                self.np.asarray(polygon, dtype=self.np.float32),
                epsilon=2.0,
                closed=True,
            ).reshape(-1, 2)
            normalized = self._normalize_points(simplified, frame_width, frame_height)
            if len(normalized) < 3:
                continue
            center = normalized.mean(axis=0)
            contour = tuple((float(point[0]), float(point[1])) for point in normalized)
            detections.append(
                Detection(
                    raw_id=int(track_ids[index]),
                    kind=kind,
                    x=float(center[0]),
                    y=float(center[1]),
                    confidence=float(confidences[index]),
                    contour=contour,
                )
            )
        return detections

    def close(self) -> None:
        self.capture.release()
