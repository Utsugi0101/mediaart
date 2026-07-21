from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Sequence, Tuple

from .config import TrackingConfig
from .protocol import Detection, Point, TrackedObject, clamp_unit


@dataclass
class _TrackState:
    raw_id: object
    kind: str
    x: float
    y: float
    confidence: float
    contour: Tuple[Point, ...]
    first_seen: float
    last_seen: float
    seen_frames: int = 1
    moving: bool = False


class TrackStabilizer:
    """Smooths detector tracks and keeps confirmed objects through short occlusions."""

    def __init__(self, config: TrackingConfig):
        self.config = config
        self._tracks: Dict[Tuple[str, str], _TrackState] = {}

    def update(
        self,
        detections: Iterable[Detection],
        now: float,
        camera_ok: bool = True,
    ) -> List[TrackedObject]:
        if not camera_ok:
            return self.snapshot()

        seen_keys = set()
        for detection in detections:
            if detection.kind not in {"food", "obstacle"}:
                continue
            key = (detection.kind, str(detection.raw_id))
            seen_keys.add(key)
            current = self._tracks.get(key)
            if current is None:
                self._tracks[key] = _TrackState(
                    raw_id=detection.raw_id,
                    kind=detection.kind,
                    x=clamp_unit(detection.x),
                    y=clamp_unit(detection.y),
                    confidence=clamp_unit(detection.confidence),
                    contour=self._normalize_contour(detection.contour),
                    first_seen=now,
                    last_seen=now,
                )
                continue

            elapsed = max(now - current.last_seen, 1e-6)
            target_x = clamp_unit(detection.x)
            target_y = clamp_unit(detection.y)
            distance = ((target_x - current.x) ** 2 + (target_y - current.y) ** 2) ** 0.5
            if distance >= self.config.deadzone:
                alpha = self.config.smoothing_alpha
                current.x += (target_x - current.x) * alpha
                current.y += (target_y - current.y) * alpha
                current.contour = self._smooth_contour(
                    current.contour,
                    self._normalize_contour(detection.contour),
                    alpha,
                )
            current.moving = distance / elapsed >= self.config.moving_threshold
            current.confidence = clamp_unit(detection.confidence)
            current.last_seen = now
            current.seen_frames += 1

        expired = [
            key
            for key, track in self._tracks.items()
            if key not in seen_keys
            and now - track.last_seen > self.config.missing_grace_seconds
        ]
        for key in expired:
            del self._tracks[key]

        return self.snapshot()

    def snapshot(self) -> List[TrackedObject]:
        confirmed = []
        for key in sorted(self._tracks):
            track = self._tracks[key]
            if track.seen_frames < self.config.confirmation_frames:
                continue
            confirmed.append(
                TrackedObject(
                    id=f"track-{track.kind}-{track.raw_id}",
                    kind=track.kind,
                    x=track.x,
                    y=track.y,
                    confidence=track.confidence,
                    moving=track.moving,
                    contour=track.contour,
                )
            )
        return confirmed

    @staticmethod
    def _normalize_contour(contour: Sequence[Point]) -> Tuple[Point, ...]:
        return tuple((clamp_unit(point[0]), clamp_unit(point[1])) for point in contour)

    @staticmethod
    def _smooth_contour(
        current: Tuple[Point, ...],
        target: Tuple[Point, ...],
        alpha: float,
    ) -> Tuple[Point, ...]:
        if not target:
            return current
        if len(current) != len(target):
            return target
        return tuple(
            (
                old[0] + (new[0] - old[0]) * alpha,
                old[1] + (new[1] - old[1]) * alpha,
            )
            for old, new in zip(current, target)
        )
