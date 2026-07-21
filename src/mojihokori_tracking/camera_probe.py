from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="List OpenCV camera indexes that return a frame")
    parser.add_argument("--maximum-index", type=int, default=10)
    args = parser.parse_args()
    try:
        import cv2  # type: ignore
    except ImportError as error:
        raise SystemExit("Install camera dependencies with: uv sync --extra vision") from error

    found = False
    for index in range(args.maximum_index + 1):
        capture = cv2.VideoCapture(index, cv2.CAP_AVFOUNDATION)
        ok, frame = capture.read()
        if ok:
            found = True
            height, width = frame.shape[:2]
            print(f"camera index={index} frame={width}x{height}")
        capture.release()
    if not found:
        raise SystemExit("No camera returned a frame. Check Camo/OBS permissions and virtual camera output.")


if __name__ == "__main__":
    main()
