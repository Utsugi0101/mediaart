from __future__ import annotations

import argparse
import time
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Capture evenly spaced training frames from a camera")
    parser.add_argument("output", type=Path, help="Dataset session directory under data/raw")
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--count", type=int, default=300)
    parser.add_argument("--interval", type=float, default=0.5)
    args = parser.parse_args()
    if args.count < 1 or args.interval < 0:
        raise SystemExit("--count must be positive and --interval must not be negative")
    try:
        import cv2  # type: ignore
    except ImportError as error:
        raise SystemExit("Install camera dependencies with: uv sync --extra vision") from error

    args.output.mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(args.camera, cv2.CAP_AVFOUNDATION)
    if not capture.isOpened():
        raise SystemExit(f"Could not open camera index {args.camera}")
    try:
        for frame_index in range(args.count):
            ok, frame = capture.read()
            if not ok:
                raise SystemExit("Camera stopped returning frames")
            filename = args.output / f"frame-{frame_index:05d}.jpg"
            if not cv2.imwrite(str(filename), frame):
                raise SystemExit(f"Could not write {filename}")
            print(filename)
            if frame_index + 1 < args.count:
                time.sleep(args.interval)
    finally:
        capture.release()


if __name__ == "__main__":
    main()
