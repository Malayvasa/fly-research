import test from 'node:test';
import assert from 'node:assert/strict';
import {FlyController} from './fly-controller.ts';

const sample = (overrides = {}) => ({sequence: 0, frameId: 0, forwardHz: 1, leftHz: 0, rightHz: 0, ...overrides});
const stopped = {steering: 0, throttle: 0, brake: 0, jump: false};

test('neural steering follows right-minus-left and can invert for calibration', () => {
  for (const invertSteering of [false, true]) {
    const c = new FlyController({smoothingSeconds: 0, invertSteering});
    assert.ok(c.accept(sample({rightHz: 5}), 100));
    assert.equal(c.step(0.02, 100).steering, invertSteering ? -1 : 1);
    assert.ok(c.accept(sample({sequence: 1, leftHz: 5}), 120));
    assert.equal(c.step(0.02, 120).steering, invertSteering ? 1 : -1);
  }
});

test('missing, expired and disconnected signals release all controls without reversing', () => {
  const c = new FlyController({smoothingSeconds: 0});
  assert.deepEqual(c.step(0.02, 0), stopped);
  c.accept(sample({rightHz: 50}), 100);
  assert.ok(c.step(0.02, 349).throttle > 0);
  assert.deepEqual(c.step(0.02, 350), stopped);
  c.reset();
  assert.deepEqual(c.step(0.02, 351), stopped);
  assert.ok(c.accept(sample(), 352), 'new session can restart sequence numbering');
  assert.deepEqual(c.step(0.02, 352, false), stopped);
});

test('bad and reordered packets cannot refresh the watchdog', () => {
  const c = new FlyController();
  c.accept(sample({sequence: 2, frameId: 2}), 100);
  for (const s of [null, {}, sample({sequence: 2}), sample({sequence: 1}),
    sample({sequence: 3, frameId: 1}), sample({sequence: 3, forwardHz: NaN}),
    sample({sequence: 3, rightHz: 51}), sample({sequence: 3, leftHz: -1})]) {
    assert.equal(c.accept(s, 340), false);
  }
  assert.deepEqual(c.step(0.02, 350), stopped);
});

test('fixed and neural throttle remain bounded with explicit rates in Hz', () => {
  const c = new FlyController({smoothingSeconds: 0, throttleMode: 'neural'});
  c.accept(sample({forwardHz: 0.4}), 0);
  assert.equal(c.step(0.02, 0).throttle, 0);
  c.accept(sample({sequence: 1, forwardHz: 50}), 20);
  assert.equal(c.step(0.02, 20).throttle, 0.5);
  const fixed = new FlyController({smoothingSeconds: 0});
  fixed.accept(sample({forwardHz: 0}), 0);
  assert.equal(fixed.step(0.02, 0).throttle, 0.3);
});

test('smoothing is independent of the vehicle update frequency', () => {
  const a = new FlyController();
  const b = new FlyController();
  a.accept(sample({rightHz: 5}), 0);
  b.accept(sample({rightHz: 5}), 0);
  const x = a.step(0.1, 100);
  let y = stopped;
  for (let i = 1; i <= 10; i++) y = b.step(0.01, i * 10);
  assert.ok(Math.abs(x.steering - y.steering) < 1e-12);
  assert.ok(Math.abs(x.throttle - y.throttle) < 1e-12);
});

test('small differentials remain in the dead zone and invalid timing returns neutral', () => {
  const c = new FlyController({smoothingSeconds: 0});
  c.accept(sample({rightHz: 0.01}), 100);
  assert.equal(c.step(0.02, 100).steering, 0);
  assert.deepEqual(c.step(NaN, 100), stopped);
  assert.deepEqual(c.step(0.02, 99), stopped);
  assert.throws(() => new FlyController({staleMs: 0}), RangeError);
  assert.throws(() => new FlyController({forwardFullScaleHz: 0.1}), RangeError);
});
