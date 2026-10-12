// Run with: node --test tests/browser/splitter.test.js
//
// The arithmetic of a draggable divider, apart from any page. One helper
// serves a divider on either axis and a pane on either side of it, so the
// cases that can be got backwards are the ones no single caller exercises: a
// pane after its divider, and the vertical keys.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampSize,
  keyedSize,
  movedSize,
  storedSize,
} from "../../web/splitter.js";
import { memoryStorage } from "./source.js";

const bounds = { min: 280, max: 640 };

test("a size is held inside its bounds as a whole pixel", () => {
  assert.equal(clampSize(100, bounds), 280);
  assert.equal(clampSize(900, bounds), 640);
  assert.equal(clampSize(400.6, bounds), 401);
});

test("the minimum wins when a window leaves no room for both bounds", () => {
  assert.equal(clampSize(400, { min: 280, max: 120 }), 280);
});

test("a pane after its divider shrinks as the divider advances", () => {
  assert.equal(movedSize(300, 40, "before"), 340);
  assert.equal(movedSize(300, 40, "after"), 260);
});

test("each axis answers to its own arrow keys and ignores the other's", () => {
  assert.equal(keyedSize("ArrowRight", "x", "before", 300, bounds), 316);
  assert.equal(keyedSize("ArrowLeft", "x", "before", 300, bounds), 284);
  assert.equal(keyedSize("ArrowUp", "x", "before", 300, bounds), null);
  assert.equal(keyedSize("ArrowUp", "y", "after", 300, bounds), 316);
  assert.equal(keyedSize("ArrowDown", "y", "after", 300, bounds), 284);
  assert.equal(keyedSize("ArrowLeft", "y", "after", 300, bounds), null);
});

test("a key press stops at the bounds, and Home and End go to them", () => {
  assert.equal(keyedSize("ArrowLeft", "x", "before", 285, bounds), 280);
  assert.equal(keyedSize("ArrowRight", "x", "before", 635, bounds), 640);
  assert.equal(keyedSize("Home", "x", "before", 400, bounds), 280);
  assert.equal(keyedSize("End", "x", "before", 400, bounds), 640);
  assert.equal(keyedSize("a", "x", "before", 400, bounds), null);
});

test("only a positive stored length counts as a saved size", () => {
  const storage = memoryStorage();
  assert.equal(storedSize("size", storage), null);
  for (const value of ["0", "-40", "wide", "NaN"]) {
    storage.setItem("size", value);
    assert.equal(storedSize("size", storage), null, value);
  }
  storage.setItem("size", "412");
  assert.equal(storedSize("size", storage), 412);
  assert.equal(storedSize("size", null), null, "storage the browser blocks");
});
