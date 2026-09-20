import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLearnedSpeed} from './fly-speed.ts';
const input={steering:.3,throttle:.5,brake:0,jump:false};
test('learned speed accelerates toward 90 km/h and brakes for a learned corner target',()=>{
 const accelerating=applyLearnedSpeed(input,25,20,true);
 assert.equal(accelerating.throttle,1);assert.equal(accelerating.brake,0);assert.equal(accelerating.steering,.3);
 const corner=applyLearnedSpeed(input,14,25,true);
 assert.equal(corner.throttle,0);assert.equal(corner.brake,1);assert.equal(corner.steering,.3);
 const overspeed=applyLearnedSpeed(input,25,27,true);
 assert.equal(overspeed.throttle,0);assert.ok(overspeed.brake>0);
});
test('missing, invalid or inactive speed predictions cannot drive',()=>{
 const stopped={steering:0,throttle:0,brake:0,jump:false};
 for(const target of [null,NaN,Infinity,-1,26])assert.deepEqual(applyLearnedSpeed(input,target,10,true),stopped);
 assert.deepEqual(applyLearnedSpeed(input,25,10,false),stopped);
 assert.deepEqual(applyLearnedSpeed(input,25,NaN,true),stopped);
});
