const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TrackingClient,
  normalizeTrackingFrame,
  defaultWebSocketUrl,
  isPointInPolygon,
} = require("../../tracking.js");

test("normalizes a variable-length tracking frame", () => {
  const frame = normalizeTrackingFrame({
    type: "tracking-frame",
    timestamp: 1234,
    sequence: 9,
    camera: "ok",
    objects: [
      {
        id: "food-1",
        kind: "food",
        x: 1.2,
        y: -0.1,
        confidence: 0.91,
        moving: true,
        contour: [[0, 0], [1, 0], [1, 1]],
      },
      {
        id: "stone-1",
        kind: "obstacle",
        x: 0.5,
        y: 0.4,
        confidence: 0.88,
        moving: false,
        contour: [],
      },
    ],
  });

  assert.equal(frame.objects.length, 2);
  assert.equal(frame.objects[0].x, 1);
  assert.equal(frame.objects[0].y, 0);
  assert.equal(frame.objects[0].contour.length, 3);
});

test("drops unknown classes, invalid objects, and duplicate IDs", () => {
  const frame = normalizeTrackingFrame({
    type: "tracking-frame",
    timestamp: 1234,
    sequence: 1,
    camera: "lost",
    objects: [
      { id: "x", kind: "hand", x: 0.5, y: 0.5, confidence: 1 },
      { id: "food", kind: "food", x: 0.2, y: 0.2, confidence: 1 },
      { id: "food", kind: "food", x: 0.8, y: 0.8, confidence: 1 },
      { id: "broken", kind: "food", x: "no", y: 0, confidence: 1 },
    ],
  });

  assert.equal(frame.camera, "lost");
  assert.deepEqual(frame.objects.map((object) => object.id), ["food"]);
  assert.equal(frame.objects[0].x, 0.2);
});

test("rejects invalid envelopes", () => {
  assert.equal(normalizeTrackingFrame(null), null);
  assert.equal(normalizeTrackingFrame({ type: "other", objects: [] }), null);
  assert.equal(normalizeTrackingFrame({ type: "tracking-frame", objects: [] }), null);
});

test("derives ws and wss URLs", () => {
  assert.equal(
    defaultWebSocketUrl({ protocol: "http:", host: "localhost:8765" }),
    "ws://localhost:8765/ws",
  );
  assert.equal(
    defaultWebSocketUrl({ protocol: "https:", host: "example.test" }),
    "wss://example.test/ws",
  );
});

test("tests points against an arbitrary obstacle contour", () => {
  const polygon = [[0, 0], [4, 0], [4, 3], [0, 3]];
  assert.equal(isPointInPolygon(2, 1, polygon), true);
  assert.equal(isPointInPolygon(5, 1, polygon), false);
});

test("accepts a sequence that restarts after reconnecting", () => {
  class FakeWebSocket {
    constructor() {
      this.listeners = new Map();
      FakeWebSocket.instance = this;
    }

    addEventListener(name, callback) {
      this.listeners.set(name, callback);
    }

    emit(name, value = {}) {
      this.listeners.get(name)(value);
    }

    close() {}
  }

  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  const received = [];
  const client = new TrackingClient({
    url: "ws://example.test/ws",
    onFrame: (frame) => received.push(frame.sequence),
  });
  client.lastSequence = 99;
  client.connect();
  FakeWebSocket.instance.emit("open");
  FakeWebSocket.instance.emit("message", {
    data: JSON.stringify({
      type: "tracking-frame",
      timestamp: 1,
      sequence: 0,
      camera: "ok",
      objects: [],
    }),
  });
  client.stop();
  globalThis.WebSocket = originalWebSocket;

  assert.deepEqual(received, [0]);
});
