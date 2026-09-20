import test from 'node:test';
import assert from 'node:assert/strict';
import {FlyRecovery} from './fly-recovery.ts';

test('low assisted throttle recovers a sustained stall once per six seconds', () => {
  const recovery = new FlyRecovery();
  for (let i = 0; i < 59; i++) assert.equal(recovery.observe(0.1, 0.1, 0.3, true), false);
  let triggered = false;
  for (let i = 0; i < 2; i++) triggered ||= recovery.observe(0.1, 0.1, 0.3, true);
  assert.equal(triggered, true);
  assert.equal(recovery.count, 1);
  assert.equal(recovery.observe(0.1, 0.1, 0.3, true), false);
});

test('motion, inactivity, no throttle and invalid observations cancel accumulated stall', () => {
  for (const interrupt of [[0.1,1,0.3,true],[0.1,0,0.3,false],[0.1,0,0,true],[NaN,0,0.3,true]] as const) {
    const recovery = new FlyRecovery();
    for(let i=0;i<50;i++) recovery.observe(0.1,0,0.3,true);
    assert.equal(recovery.observe(...interrupt),false);
    for(let i=0;i<20;i++) assert.equal(recovery.observe(0.1,0,0.3,true),false);
    assert.equal(recovery.count,0);
  }
});
