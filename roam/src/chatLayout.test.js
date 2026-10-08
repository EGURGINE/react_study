import test from "node:test";
import assert from "node:assert/strict";
import {
  validChatLayout,
  fitChatLayout,
  defaultChatLayout,
  changeChatLayout,
} from "./chatLayout.js";

const bounds = { left: 10, top: 122, right: 1270, bottom: 660 };
test("chat movement stops at the content edges without covering the header or losing controls", () => {
  const start = defaultChatLayout(bounds);
  const topLeft = changeChatLayout(start, -10000, -10000, "move", bounds);
  assert.equal(topLeft.x, bounds.left);
  assert.equal(topLeft.y, bounds.top);
  const bottomRight = changeChatLayout(start, 10000, 10000, "move", bounds);
  assert.equal(bottomRight.x + bottomRight.width, bounds.right);
  assert.equal(bottomRight.y + bottomRight.height, bounds.bottom);
  assert.equal(bottomRight.width, start.width);
  assert.equal(bottomRight.height, start.height);
});
test("resizing respects minimum size and keeps its top-left corner fixed at the far edges", () => {
  const start = { x: 780, y: 220, width: 322, height: 340 };
  const grown = changeChatLayout(start, 10000, 10000, "resize", bounds);
  assert.deepEqual(grown, { x: 780, y: 220, width: 490, height: 440 });
  const small = changeChatLayout(start, -10000, -10000, "resize", bounds);
  assert.deepEqual(small, { x: 780, y: 220, width: 280, height: 250 });
});
test("saved desktop windows remain fully reachable on mobile and short viewports", () => {
  const saved = { x: 1000, y: 800, width: 800, height: 700 };
  for (const view of [
    { left: 10, top: 90, right: 380, bottom: 790 },
    { left: 10, top: 100, right: 260, bottom: 310 },
  ]) {
    const fitted = fitChatLayout(saved, view);
    assert.ok(fitted.x >= view.left && fitted.y >= view.top);
    assert.ok(fitted.x + fitted.width <= view.right);
    assert.ok(fitted.y + fitted.height <= view.bottom);
    assert.ok(fitted.width > 0 && fitted.height > 0);
  }
});
test("defaults and reset fit both desktop and mobile content areas", () => {
  for (const mobile of [false, true]) {
    const layout = defaultChatLayout(bounds, mobile);
    assert.equal(layout.width, 322);
    assert.equal(layout.height, 340);
    assert.deepEqual(fitChatLayout(layout, bounds), layout);
  }
});
test("invalid stored preferences are rejected before reaching inline styles", () => {
  for (const value of [
    null,
    {},
    [],
    { x: 0, y: 0, width: -1, height: 200 },
    { x: "20", y: 0, width: 300, height: 300 },
    { x: NaN, y: 0, width: 300, height: 300 },
    { x: 0, y: 0, width: Infinity, height: 300 },
  ]) {
    assert.ok(!validChatLayout(value));
  }
  assert.ok(validChatLayout({ x: -100, y: 2000, width: 400, height: 350 }));
});
