from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple


@dataclass(frozen=True)
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8765
    broadcast_hz: float = 10.0


@dataclass(frozen=True)
class TrackingConfig:
    smoothing_alpha: float = 0.35
    deadzone: float = 0.0025
    moving_threshold: float = 0.006
    missing_grace_seconds: float = 0.5
    confirmation_frames: int = 2


@dataclass(frozen=True)
class CameraConfig:
    index: int = 0
    width: int = 1920
    height: int = 1080
    fps: int = 30
    screen_corners: Optional[List[Tuple[float, float]]] = None


@dataclass(frozen=True)
class ModelConfig:
    path: str = "models/best.pt"
    confidence: float = 0.45
    iou: float = 0.5
    image_size: int = 640
    device: str = "mps"
    allowed_classes: Tuple[str, ...] = ("food", "obstacle")


@dataclass(frozen=True)
class AppConfig:
    server: ServerConfig = field(default_factory=ServerConfig)
    tracking: TrackingConfig = field(default_factory=TrackingConfig)
    camera: CameraConfig = field(default_factory=CameraConfig)
    model: ModelConfig = field(default_factory=ModelConfig)
    source: str = "mock"


def load_config(path: Path) -> AppConfig:
    with path.open("r", encoding="utf-8") as config_file:
        raw = json.load(config_file)

    server_raw = raw.get("server", {})
    tracking_raw = raw.get("tracking", {})
    camera_raw = raw.get("camera", {})
    model_raw = raw.get("model", {})
    corners_raw = camera_raw.get("screenCorners")
    corners = None
    if corners_raw is not None:
        if len(corners_raw) != 4 or any(len(point) != 2 for point in corners_raw):
            raise ValueError("camera.screenCorners must contain exactly four [x, y] points")
        corners = [(float(point[0]), float(point[1])) for point in corners_raw]

    config = AppConfig(
        server=ServerConfig(
            host=str(server_raw.get("host", "127.0.0.1")),
            port=int(server_raw.get("port", 8765)),
            broadcast_hz=float(server_raw.get("broadcastHz", 10)),
        ),
        tracking=TrackingConfig(
            smoothing_alpha=float(tracking_raw.get("smoothingAlpha", 0.35)),
            deadzone=float(tracking_raw.get("deadzone", 0.0025)),
            moving_threshold=float(tracking_raw.get("movingThreshold", 0.006)),
            missing_grace_seconds=float(tracking_raw.get("missingGraceSeconds", 0.5)),
            confirmation_frames=int(tracking_raw.get("confirmationFrames", 2)),
        ),
        camera=CameraConfig(
            index=int(camera_raw.get("index", 0)),
            width=int(camera_raw.get("width", 1920)),
            height=int(camera_raw.get("height", 1080)),
            fps=int(camera_raw.get("fps", 30)),
            screen_corners=corners,
        ),
        model=ModelConfig(
            path=str(model_raw.get("path", "models/best.pt")),
            confidence=float(model_raw.get("confidence", 0.45)),
            iou=float(model_raw.get("iou", 0.5)),
            image_size=int(model_raw.get("imageSize", 640)),
            device=str(model_raw.get("device", "mps")),
            allowed_classes=tuple(model_raw.get("allowedClasses", ["food", "obstacle"])),
        ),
        source=str(raw.get("source", "mock")),
    )
    _validate(config)
    return config


def _validate(config: AppConfig) -> None:
    if config.source not in {"mock", "camera"}:
        raise ValueError("source must be 'mock' or 'camera'")
    if not 0 < config.server.broadcast_hz <= 60:
        raise ValueError("server.broadcastHz must be between 0 and 60")
    if not 0 < config.tracking.smoothing_alpha <= 1:
        raise ValueError("tracking.smoothingAlpha must be between 0 and 1")
    if config.tracking.deadzone < 0 or config.tracking.moving_threshold < 0:
        raise ValueError("tracking movement thresholds must not be negative")
    if config.tracking.missing_grace_seconds < 0:
        raise ValueError("tracking.missingGraceSeconds must not be negative")
    if config.tracking.confirmation_frames < 1:
        raise ValueError("tracking.confirmationFrames must be at least 1")
    if not 0 <= config.model.confidence <= 1 or not 0 <= config.model.iou <= 1:
        raise ValueError("model confidence and IoU must be between 0 and 1")
    if any(name not in {"food", "obstacle"} for name in config.model.allowed_classes):
        raise ValueError("model.allowedClasses may only contain 'food' and 'obstacle'")
