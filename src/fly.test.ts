import test from "node:test";
import assert from "node:assert/strict";
import { FlyDriver } from "./fly.ts";

test("fly stays anchored, pauses, and reacts in both steering directions", () => {
  const fly = new FlyDriver();
  const body = fly.root.children[0];
  fly.root.position.set(0, 0.22, -0.1);
  for (let i = 0; i < 60; i++) fly.update(1 / 60, 15, 1, 0, true);
  assert.ok(body.rotation.z > 0.15);
  const pose = body.rotation.toArray();
  fly.update(0, 0, -1, -5, false);
  assert.deepEqual(body.rotation.toArray(), pose);
  for (let i = 0; i < 60; i++) fly.update(1 / 60, 15, -1, 0, true);
  assert.ok(body.rotation.z < -0.15);
  assert.deepEqual(fly.root.position.toArray(), [0, 0.22, -0.1]);
  fly.update(1 / 60, 15, 0, -6, false);
  fly.update(1 / 60, 15, 0, 0, true);
  assert.ok(Number.isFinite(body.position.y));
  assert.ok(Math.abs(body.position.y) < 0.12);
});

test("wings flap more at speed, react asymmetrically to turns, and freeze on pause", () => {
  const sample = (speed: number, steering: number, grounded = true) => {
    const fly = new FlyDriver();
    const left = fly.root.getObjectByName("wing-left")!;
    const right = fly.root.getObjectByName("wing-right")!;
    const angles: number[] = [];
    for (let i = 0; i < 240; i++) {
      fly.update(1 / 60, speed, steering, 0, grounded);
      if (i > 120) angles.push(left.rotation.z);
    }
    return {
      fly,
      left,
      right,
      range: Math.max(...angles) - Math.min(...angles),
    };
  };
  const idle = sample(0, 0),
    fast = sample(27, 0),
    turn = sample(27, 1),
    air = sample(0, 0, false);
  assert.ok(fast.range > idle.range * 5);
  assert.ok(air.range > idle.range * 5);
  assert.ok(Math.abs(turn.left.rotation.y + turn.right.rotation.y) > 0.1);
  const pose = turn.left.rotation.toArray();
  turn.fly.update(0, 0, 0, 0, true);
  assert.deepEqual(turn.left.rotation.toArray(), pose);
});

test("ordinary NPC steering produces a visible lean and returns to neutral", () => {
  const fly = new FlyDriver();
  const body = fly.root.children[0];
  for (let i = 0; i < 30; i++) fly.update(1 / 60, 19, 0.15, 0, true);
  assert.ok(body.rotation.z > 0.28, "visible lean on gentle corners");
  assert.ok(body.position.x < -0.05, "weight shift follows lean");
  for (let i = 0; i < 90; i++) fly.update(1 / 60, 19, 0, 0, true);
  assert.ok(Math.abs(body.rotation.z) < 0.001);
  assert.ok(Math.abs(body.position.x) < 0.001);
});
