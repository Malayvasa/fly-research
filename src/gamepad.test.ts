import test from "node:test";
import assert from "node:assert/strict";
import { ControllerInput, deadzone, type Pad } from "./gamepad.ts";
function pad(
  values: Record<number, number> = {},
  axes = [0, 0],
  index = 0,
): Pad {
  return {
    index,
    connected: true,
    mapping: "standard",
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({
      value: values[i] ?? 0,
      pressed: (values[i] ?? 0) > 0.5,
      touched: false,
    })),
  };
}
test("analog steering removes drift and preserves proportional travel", () => {
  assert.equal(deadzone(0.1), 0);
  assert.equal(deadzone(-0.14), 0);
  assert.equal(deadzone(1), 1);
  assert.equal(deadzone(-1), -1);
  const { input } = new ControllerInput().poll([pad({ 7: 0.52 }, [0.57, 0])]);
  assert.ok(Math.abs(input.steering - 0.5) < 1e-9);
  assert.ok(Math.abs(input.throttle - 0.5) < 1e-9);
});
test("brake overrides throttle and trigger noise is ignored", () => {
  const c = new ControllerInput();
  assert.equal(c.poll([pad({ 6: 0.03, 7: 1 })]).input.throttle, 1);
  const { input } = c.poll([pad({ 6: 1, 7: 1 })]);
  assert.equal(input.throttle, 0);
  assert.equal(input.brake, 1);
});
test("held jump and pause buttons fire once until released", () => {
  const c = new ControllerInput();
  assert.equal(c.poll([pad({ 0: 1, 9: 1 })]).actions.pause, true);
  const held = c.poll([pad({ 0: 1, 9: 1 })]);
  assert.equal(held.actions.pause, false);
  assert.equal(held.input.jump, false);
  c.poll([pad()]);
  assert.equal(c.poll([pad({ 0: 1 })]).input.jump, true);
});
test("disconnect clears driving input and reconnect accepts input again", () => {
  const c = new ControllerInput();
  c.poll([pad({ 7: 1 })]);
  const lost = c.poll([]);
  assert.equal(lost.disconnected, true);
  assert.equal(lost.connected, false);
  assert.deepEqual(lost.input, {
    steering: 0,
    throttle: 0,
    brake: 0,
    jump: false,
  });
  assert.equal(c.poll([]).disconnected, false);
  assert.equal(c.poll([pad({ 7: 1 })]).input.throttle, 1);
});
test("standard pads are selected stably and unmapped pads are ignored", () => {
  const c = new ControllerInput();
  assert.equal(c.poll([{ ...pad(), mapping: "" }]).connected, false);
  c.poll([pad({}, [0, 0], 2)]);
  assert.equal(c.poll([pad({ 7: 1 }), pad({}, [0, 0], 2)]).input.throttle, 0);
});
test("menu navigation supports d-pad, stick, and circle with edge detection", () => {
  const c = new ControllerInput();
  assert.equal(c.poll([pad({ 12: 1 })]).actions.up, true);
  assert.equal(c.poll([pad({ 12: 1 })]).actions.up, false);
  const actions = c.poll([pad({ 1: 1 }, [0, 0.8])]).actions;
  assert.equal(actions.down, true);
  assert.equal(actions.back, true);
});

test("menu direction repeats after a delay and stops on release", () => {
  const c = new ControllerInput();
  assert.equal(c.poll([pad({}, [0, 0.5])], 0).actions.down, true);
  assert.equal(c.poll([pad({}, [0, 0.5])], 100).actions.down, false);
  assert.equal(c.poll([pad({}, [0, 0.5])], 380).actions.down, true);
  assert.equal(c.poll([pad({}, [0, 0.5])], 400).actions.down, false);
  assert.equal(c.poll([pad({}, [0, 0.5])], 530).actions.down, true);
  assert.equal(c.poll([pad()], 600).actions.down, false);
  assert.equal(c.poll([pad({ 12: 1 })], 620).actions.up, true);
});
