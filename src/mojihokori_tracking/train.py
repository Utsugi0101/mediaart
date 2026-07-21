from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Train or evaluate the installation segmentation model")
    parser.add_argument("data", type=Path, help="Ultralytics dataset YAML")
    parser.add_argument("--model", default="yolo11n-seg.pt")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--image-size", type=int, default=640)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--project", type=Path, default=Path("runs/segmentation"))
    parser.add_argument("--name", default="baseline")
    parser.add_argument("--evaluate-only", action="store_true")
    args = parser.parse_args()
    try:
        from ultralytics import YOLO  # type: ignore
    except ImportError as error:
        raise SystemExit("Install model dependencies with: uv sync --extra vision") from error

    model = YOLO(args.model)
    shared = {
        "data": str(args.data),
        "imgsz": args.image_size,
        "device": args.device,
        "project": str(args.project),
        "name": args.name,
    }
    if args.evaluate_only:
        model.val(**shared)
    else:
        model.train(epochs=args.epochs, seed=args.seed, deterministic=True, **shared)


if __name__ == "__main__":
    main()
