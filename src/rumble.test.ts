import test from "node:test";
import assert from "node:assert/strict";
import { RaceRumble, type RumbleMotor } from "./rumble.ts";
const motion = { speed: 20, verticalSpeed: 0, grounded: true, throttle: 1 };
function setup() {
  const calls: {
    strongMagnitude: number;
    weakMagnitude: number;
    duration: number;
  }[] = [];
  let resets = 0;
  const motor: RumbleMotor = {
    effects: ["dual-rumble"],
    playEffect: async (_, p) => {
      calls.push(p);
    },
    reset: async () => {
      resets++;
    },
  };
  return { r: new RaceRumble(), motor, calls, resets: () => resets };
}
test("engine rumble is bounded and throttled, pause stops it immediately", () => {
  const { r, motor, calls, resets } = setup();
  r.update(0, motor, true, motion);
  r.update(20, motor, true, motion);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].weakMagnitude > 0.5);
  assert.ok(calls[0].strongMagnitude > 0.35);
  r.update(21, motor, false, motion);
  assert.equal(resets(), 1);
  r.update(100, motor, false, motion);
  assert.equal(resets(), 1);
});
test("impact pulse overrides engine without being overwritten next frame", () => {
  const { r, motor, calls } = setup();
  r.update(0, motor, true, motion);
  r.update(16, motor, true, { ...motion, speed: 10 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].strongMagnitude, 1);
  r.update(32, motor, true, { ...motion, speed: 10 });
  assert.equal(calls.length, 2);
});
test("landing gives stronger feedback and disconnect resets output", () => {
  const { r, motor, calls, resets } = setup();
  r.update(0, motor, true, { ...motion, grounded: false, verticalSpeed: -6 });
  assert.equal(calls.length, 0);
  r.update(16, motor, true, motion);
  assert.ok(calls[0].strongMagnitude > 0.7);
  r.update(20, null, true, motion);
  assert.equal(resets(), 1);
});
test("unsupported and rejected rumble never interrupt gameplay or retry each frame", async () => {
  const { r, motor, calls } = setup();
  motor.effects = [];
  r.update(0, motor, true, motion);
  assert.equal(calls.length, 0);
  motor.effects = ["dual-rumble"];
  let attempts = 0;
  motor.playEffect = async () => {
    attempts++;
    throw new Error("unsupported");
  };
  r.update(20, motor, true, motion);
  await Promise.resolve();
  r.update(200, motor, true, motion);
  assert.equal(attempts, 1);
});

test("countdown beeps pulse once, survive idle frames, and GO is stronger", () => {
  const { r, motor, calls, resets } = setup();
  const idle = { ...motion, speed: 0, throttle: 0 };
  r.update(0, motor, true, idle, 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].duration, 160);
  r.update(16, motor, true, idle);
  assert.equal(calls.length, 1);
  assert.equal(resets(), 0);
  r.update(1000, motor, true, idle, 4);
  assert.equal(calls.length, 2);
  r.update(5000, motor, true, idle, 0);
  assert.ok(calls[2].strongMagnitude > calls[0].strongMagnitude);
  assert.equal(calls[2].duration, 350);
  r.update(5016, motor, false, idle);
  assert.equal(resets(), 1);
});
