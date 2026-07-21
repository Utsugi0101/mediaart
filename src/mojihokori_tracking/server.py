from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Optional, Set

from aiohttp import WSMsgType, web

from .config import AppConfig, load_config
from .protocol import TrackingFrame
from .sources import CameraModelSource, MockSource
from .stabilizer import TrackStabilizer


LOGGER = logging.getLogger("mojihokori.tracking")
DEFAULT_ROOT = Path(__file__).resolve().parents[2]


class TrackingRuntime:
    def __init__(self, config: AppConfig, source):
        self.config = config
        self.source = source
        self.stabilizer = TrackStabilizer(config.tracking)
        self.clients: Set[web.WebSocketResponse] = set()
        self.latest: Optional[dict] = None
        self.sequence = 0
        self.camera_status = "starting"
        self.last_error: Optional[str] = None
        self.started_at = time.time()

    async def run(self) -> None:
        interval = 1.0 / self.config.server.broadcast_hz
        while True:
            cycle_started = time.monotonic()
            try:
                detections = await asyncio.to_thread(self.source.read)
                objects = self.stabilizer.update(detections, cycle_started, camera_ok=True)
                self.camera_status = "ok"
                self.last_error = None
            except asyncio.CancelledError:
                raise
            except Exception as error:  # keep the artwork running on camera/model failure
                message = f"{type(error).__name__}: {error}"
                if message != self.last_error:
                    LOGGER.error("Tracking input failed; freezing the last stable frame: %s", message)
                self.last_error = message
                self.camera_status = "lost"
                objects = self.stabilizer.update([], cycle_started, camera_ok=False)

            self.sequence += 1
            frame = TrackingFrame(
                timestamp=int(time.time() * 1000),
                sequence=self.sequence,
                camera=self.camera_status,
                objects=objects,
            )
            self.latest = frame.to_dict()
            await self.broadcast(self.latest)
            elapsed = time.monotonic() - cycle_started
            await asyncio.sleep(max(0.0, interval - elapsed))

    async def broadcast(self, message: dict) -> None:
        if not self.clients:
            return
        payload = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
        stale = []
        for client in self.clients:
            try:
                await client.send_str(payload)
            except (ConnectionError, RuntimeError):
                stale.append(client)
        for client in stale:
            self.clients.discard(client)

    def status(self) -> dict:
        return {
            "source": self.config.source,
            "camera": self.camera_status,
            "sequence": self.sequence,
            "clients": len(self.clients),
            "objectCount": len(self.latest["objects"]) if self.latest else 0,
            "lastError": self.last_error,
            "uptimeSeconds": round(time.time() - self.started_at, 1),
        }


def create_app(config: AppConfig, static_root: Path, source=None) -> web.Application:
    if source is None:
        source = MockSource() if config.source == "mock" else CameraModelSource(config.camera, config.model)
    runtime = TrackingRuntime(config, source)
    app = web.Application()
    app["runtime"] = runtime
    app["static_root"] = static_root.resolve()

    async def index_handler(request: web.Request) -> web.StreamResponse:
        return web.FileResponse(app["static_root"] / "index.html")

    async def asset_handler(request: web.Request) -> web.StreamResponse:
        filename = request.match_info["filename"]
        if filename not in {"style.css", "tracking.js", "state-store.js", "sketch.js"}:
            raise web.HTTPNotFound()
        return web.FileResponse(app["static_root"] / filename)

    async def p5_handler(request: web.Request) -> web.StreamResponse:
        path = app["static_root"] / "node_modules" / "p5" / "lib" / "p5.min.js"
        if not path.is_file():
            raise web.HTTPNotFound(text="Run npm install to make p5.js available offline")
        return web.FileResponse(path)

    async def status_handler(request: web.Request) -> web.Response:
        return web.json_response(runtime.status())

    async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
        socket = web.WebSocketResponse(heartbeat=20)
        await socket.prepare(request)
        runtime.clients.add(socket)
        if runtime.latest is not None:
            await socket.send_json(runtime.latest)
        try:
            async for message in socket:
                if message.type == WSMsgType.ERROR:
                    LOGGER.warning("WebSocket closed with error: %s", socket.exception())
        finally:
            runtime.clients.discard(socket)
        return socket

    async def start_runtime(application: web.Application) -> None:
        application["tracking_task"] = asyncio.create_task(runtime.run())

    async def stop_runtime(application: web.Application) -> None:
        task = application["tracking_task"]
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        runtime.source.close()

    app.router.add_get("/", index_handler)
    app.router.add_get("/{filename:style\\.css|tracking\\.js|state-store\\.js|sketch\\.js}", asset_handler)
    app.router.add_get("/p5.min.js", p5_handler)
    app.router.add_get("/api/status", status_handler)
    app.router.add_get("/ws", websocket_handler)
    app.on_startup.append(start_runtime)
    app.on_cleanup.append(stop_runtime)
    return app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Mojihokori tracking and artwork server")
    parser.add_argument("--config", type=Path, default=Path("config/tracking.json"))
    parser.add_argument("--source", choices=("mock", "camera"), help="Override the configured input")
    parser.add_argument("--host", help="Override the configured bind host")
    parser.add_argument("--port", type=int, help="Override the configured port")
    parser.add_argument("--static-root", type=Path, default=DEFAULT_ROOT)
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args()
    config = load_config(args.config)
    if args.source or args.host or args.port:
        from dataclasses import replace

        server = replace(
            config.server,
            host=args.host or config.server.host,
            port=args.port or config.server.port,
        )
        config = replace(config, source=args.source or config.source, server=server)
    app = create_app(config, args.static_root)
    LOGGER.info(
        "Starting %s source at http://%s:%s/?mode=exhibit",
        config.source,
        config.server.host,
        config.server.port,
    )
    web.run_app(app, host=config.server.host, port=config.server.port)


if __name__ == "__main__":
    main()
