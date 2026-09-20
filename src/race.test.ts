import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createProgress,
  advanceProgress,
  crossesGate,
  resetProgressPosition,
  formatTime,
} from "./race.ts";
const gates = [
  { x: 0, z: 0, dx: 1, dz: 0, halfWidth: 5 },
  { x: 10, z: 0, dx: 1, dz: 0, halfWidth: 5 },
  { x: 20, z: 0, dx: 1, dz: 0, halfWidth: 5 },
];
test("gate crossing requires forward direction and track width", () => {
  assert.equal(crossesGate({ x: -1, z: 0 }, { x: 1, z: 0 }, gates[0]), true);
  assert.equal(crossesGate({ x: 1, z: 0 }, { x: -1, z: 0 }, gates[0]), false);
  assert.equal(crossesGate({ x: -1, z: 7 }, { x: 1, z: 7 }, gates[0]), false);
});
test("finish-line oscillation and skipped checkpoints do not award laps", () => {
  const p = createProgress({ x: -1, z: 0 });
  advanceProgress(p, { x: 1, z: 0 }, gates, 1);
  advanceProgress(p, { x: -1, z: 0 }, gates, 2);
  advanceProgress(p, { x: 1, z: 0 }, gates, 3);
  assert.equal(p.lapTimes.length, 0);
  assert.equal(p.nextGate, 1);
});
test("three ordered laps produce individual splits and an immutable finish time", () => {
  const p = createProgress({ x: 0, z: 0 });
  for (let lap = 0; lap < 3; lap++) {
    for (const i of [1, 2, 0]) {
      p.previous = { x: gates[i].x - 1, z: 0 };
      advanceProgress(
        p,
        { x: gates[i].x + 1, z: 0 },
        gates,
        lap * 30 + (i === 0 ? 30 : i * 10),
      );
    }
  }
  assert.deepEqual(p.lapTimes, [30, 30, 30]);
  assert.equal(p.finishTime, 90);
  advanceProgress(p, { x: 50, z: 0 }, gates, 120);
  assert.equal(p.finishTime, 90);
});
test("recovery updates position without checkpoint credit", () => {
  const p = createProgress({ x: 0, z: 0 });
  resetProgressPosition(p, { x: 11, z: 0 });
  advanceProgress(p, { x: 12, z: 0 }, gates, 3);
  assert.equal(p.passed, 0);
});
test("timing formats minutes and milliseconds", () => {
  assert.equal(formatTime(65.432), "1:05.432");
  assert.equal(formatTime(null), "—");
});
