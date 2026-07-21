from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Sequence, Tuple, Union


TrackId = Union[int, str]
Point = Tuple[float, float]


def clamp_unit(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


@dataclass(frozen=True)
class Detection:
    raw_id: TrackId
    kind: str
    x: float
    y: float
    confidence: float
    contour: Sequence[Point] = field(default_factory=tuple)


@dataclass(frozen=True)
class TrackedObject:
    id: str
    kind: str
    x: float
    y: float
    confidence: float
    moving: bool
    contour: Sequence[Point] = field(default_factory=tuple)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "x": clamp_unit(self.x),
            "y": clamp_unit(self.y),
            "confidence": clamp_unit(self.confidence),
            "moving": self.moving,
            "contour": [
                [clamp_unit(point[0]), clamp_unit(point[1])]
                for point in self.contour
            ],
        }


@dataclass(frozen=True)
class TrackingFrame:
    timestamp: int
    sequence: int
    camera: str
    objects: Sequence[TrackedObject]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": "tracking-frame",
            "timestamp": self.timestamp,
            "sequence": self.sequence,
            "camera": self.camera,
            "objects": [tracked.to_dict() for tracked in self.objects],
        }
