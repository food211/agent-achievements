import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { calculateDockedBounds, nearestDock } = require("../apps/companion/src/geometry.cjs");

const work = { x: 100, y: 50, width: 1200, height: 800 };
const pet = { width: 76, height: 82 };

test("detects every screen edge inside the snap threshold", () => {
  assert.deepEqual(nearestDock({ x: 110, y: 250, ...pet }, work, 34), { edge: "left", offset: 200 });
  assert.deepEqual(nearestDock({ x: 1214, y: 250, ...pet }, work, 34), { edge: "right", offset: 200 });
  assert.deepEqual(nearestDock({ x: 450, y: 62, ...pet }, work, 34), { edge: "top", offset: 350 });
  assert.deepEqual(nearestDock({ x: 450, y: 756, ...pet }, work, 34), { edge: "bottom", offset: 350 });
  assert.equal(nearestDock({ x: 400, y: 300, ...pet }, work, 34), null);
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

