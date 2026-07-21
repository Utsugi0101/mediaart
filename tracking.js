(function exposeTracking(globalScope) {
  "use strict";

  const ALLOWED_KINDS = new Set(["food", "obstacle"]);

  function clampUnit(value) {
    return Math.max(0, Math.min(1, Number(value)));
  }

  function normalizePoint(point) {
    if (!Array.isArray(point) || point.length !== 2) {
      return null;
    }
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return [clampUnit(x), clampUnit(y)];
  }

  function normalizeObject(candidate) {
    if (!candidate || !ALLOWED_KINDS.has(candidate.kind)) {
      return null;
    }
    const x = Number(candidate.x);
    const y = Number(candidate.y);
    const confidence = Number(candidate.confidence);
    if (
      (typeof candidate.id !== "string" && typeof candidate.id !== "number")
      || !Number.isFinite(x)
      || !Number.isFinite(y)
      || !Number.isFinite(confidence)
    ) {
      return null;
    }
    const contour = Array.isArray(candidate.contour)
      ? candidate.contour.map(normalizePoint).filter(Boolean)
      : [];
    return {
      id: String(candidate.id),
      kind: candidate.kind,
      x: clampUnit(x),
      y: clampUnit(y),
      confidence: clampUnit(confidence),
      moving: Boolean(candidate.moving),
      contour: contour.length >= 3 ? contour : [],
    };
  }

  function normalizeTrackingFrame(candidate) {
    if (!candidate || candidate.type !== "tracking-frame" || !Array.isArray(candidate.objects)) {
      return null;
    }
    const timestamp = Number(candidate.timestamp);
    const sequence = Number(candidate.sequence);
    if (!Number.isFinite(timestamp) || !Number.isInteger(sequence) || sequence < 0) {
      return null;
    }
    const objects = candidate.objects.map(normalizeObject).filter(Boolean);
    const ids = new Set();
    const uniqueObjects = [];
    for (const object of objects) {
      if (!ids.has(object.id)) {
        ids.add(object.id);
        uniqueObjects.push(object);
      }
    }
    return {
      type: "tracking-frame",
      timestamp,
      sequence,
      camera: candidate.camera === "ok" ? "ok" : "lost",
      objects: uniqueObjects,
    };
  }

  function defaultWebSocketUrl(locationObject) {
    const protocol = locationObject.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${locationObject.host}/ws`;
  }

  function isPointInPolygon(x, y, polygon) {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
      const currentPoint = polygon[index];
      const previousPoint = polygon[previous];
      const crosses = (
        (currentPoint[1] > y) !== (previousPoint[1] > y)
        && x < (
          ((previousPoint[0] - currentPoint[0]) * (y - currentPoint[1]))
          / (previousPoint[1] - currentPoint[1])
          + currentPoint[0]
        )
      );
      if (crosses) {
        inside = !inside;
      }
    }
    return inside;
  }

  class TrackingClient {
    constructor(options = {}) {
      this.url = options.url || defaultWebSocketUrl(globalScope.location);
      this.onFrame = options.onFrame || (() => {});
      this.onStatus = options.onStatus || (() => {});
      this.reconnectDelay = options.reconnectDelay || 1000;
      this.maximumReconnectDelay = options.maximumReconnectDelay || 10000;
      this.socket = null;
      this.reconnectTimer = null;
      this.stopped = false;
      this.currentDelay = this.reconnectDelay;
      this.lastSequence = -1;
    }

    connect() {
      this.stopped = false;
      this._open();
    }

    stop() {
      this.stopped = true;
      if (this.reconnectTimer !== null) {
        globalScope.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
    }

    _open() {
      if (this.stopped || this.socket) {
        return;
      }
      this.onStatus({ state: "connecting", url: this.url });
      const socket = new globalScope.WebSocket(this.url);
      this.socket = socket;
      socket.addEventListener("open", () => {
        // A reconnected server may have restarted its sequence at zero.
        this.lastSequence = -1;
        this.currentDelay = this.reconnectDelay;
        this.onStatus({ state: "connected", url: this.url });
      });
      socket.addEventListener("message", (event) => {
        let decoded;
        try {
          decoded = JSON.parse(event.data);
        } catch (error) {
          this.onStatus({ state: "invalid-message", error: String(error) });
          return;
        }
        const frame = normalizeTrackingFrame(decoded);
        if (!frame || frame.sequence <= this.lastSequence) {
          return;
        }
        this.lastSequence = frame.sequence;
        this.onFrame(frame);
      });
      socket.addEventListener("close", () => {
        if (this.socket === socket) {
          this.socket = null;
        }
        this.onStatus({ state: "disconnected", url: this.url });
        this._scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        this.onStatus({ state: "error", url: this.url });
      });
    }

    _scheduleReconnect() {
      if (this.stopped || this.reconnectTimer !== null) {
        return;
      }
      const delay = this.currentDelay;
      this.currentDelay = Math.min(this.maximumReconnectDelay, delay * 1.7);
      this.reconnectTimer = globalScope.setTimeout(() => {
        this.reconnectTimer = null;
        this._open();
      }, delay);
    }
  }

  const api = {
    TrackingClient,
    normalizeTrackingFrame,
    defaultWebSocketUrl,
    isPointInPolygon,
  };
  globalScope.MojihokoriTracking = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
