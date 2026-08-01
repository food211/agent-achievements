import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { calculateDockedBounds, calculateDraggedBounds, equalBounds, nearestDock } = require("../apps/companion/src/geometry.cjs");

const work = { x: 100, y: 50, width: 1200, height: 800 };
const pet = { width: 76, height: 82 };

test("detects every screen edge inside the snap threshold", () => {
  assert.deepEqual(nearestDock({ x: 110, y: 250, ...pet }, work, 34), { edge: "left", offset: 200 });
  assert.deepEqual(nearestDock({ x: 1214, y: 250, ...pet }, work, 34), { edge: "right", offset: 200 });
  assert.deepEqual(nearestDock({ x: 450, y: 62, ...pet }, work, 34), { edge: "top", offset: 350 });
  assert.deepEqual(nearestDock({ x: 450, y: 756, ...pet }, work, 34), { edge: "bottom", offset: 350 });
  assert.equal(nearestDock({ x: 400, y: 300, ...pet }, work, 34), null);
});

test("the companion can exclude the bottom edge from snapping", () => {
  assert.equal(nearestDock({ x: 450, y: 756, ...pet }, work, 34, ["left", "right", "top"]), null);
  assert.deepEqual(nearestDock({ x: 1214, y: 740, ...pet }, work, 34, ["left", "right", "top"]), { edge: "right", offset: 690 });
});

test("a snapped trophy leaves exactly the configured peek visible", () => {
  assert.equal(calculateDockedBounds(work, pet, { edge: "left", offset: 200 }, true, 17).x, 41);
  assert.equal(calculateDockedBounds(work, pet, { edge: "right", offset: 200 }, true, 17).x, 1283);
  assert.equal(calculateDockedBounds(work, pet, { edge: "top", offset: 350 }, true, 17).y, -15);
  assert.equal(calculateDockedBounds(work, pet, { edge: "bottom", offset: 350 }, true, 17).y, 833);
});

test("dock offsets are clamped so the trophy cannot be lost", () => {
  assert.equal(calculateDockedBounds(work, pet, { edge: "left", offset: 9999 }, false, 17).y, 768);
  assert.equal(calculateDockedBounds(work, pet, { edge: "top", offset: -500 }, false, 17).x, 100);
});

test("identical bounds do not trigger a programmatic move", () => {
  assert.equal(equalBounds({ x: 10, y: 20, width: 76, height: 82 }, { x: 10, y: 20, width: 76, height: 82 }), true);
  assert.equal(equalBounds({ x: 10, y: 20, width: 76, height: 82 }, { x: 11, y: 20, width: 76, height: 82 }), false);
});

test("dragging follows the global cursor from the original window position", () => {
  assert.deepEqual(
    calculateDraggedBounds({ x: 500, y: 300, width: 76, height: 82 }, { x: 530, y: 330 }, { x: 610, y: 390 }),
    { x: 580, y: 360, width: 76, height: 82 }
  );
});
