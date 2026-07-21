const test = require("node:test");
const assert = require("node:assert/strict");

const { localDateKey } = require("../../state-store.js");

test("uses a local calendar date instead of UTC", () => {
  const date = new Date(2026, 6, 17, 1, 2, 3);
  assert.equal(localDateKey(date), "2026-07-17");
});
