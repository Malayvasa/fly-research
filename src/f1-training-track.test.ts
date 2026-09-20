import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
for(const [track,length] of [['monza',5793],['silverstone',5891],['spa',7004],['interlagos',4309],['red-bull-ring',4318]] as const){
 test(`${track} training geometry retains metre scale and ordered gates`,()=>{
  const output=execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',`import {TRACK_LENGTH,gates,samples} from './src/track.ts';console.log(JSON.stringify({length:TRACK_LENGTH,gates:gates.length,finite:samples.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z))}));`],{cwd:process.cwd(),env:{...process.env,FLY_TRACK:track},encoding:'utf8'});
  const value=JSON.parse(output);assert.ok(Math.abs(value.length-length)<2);assert.equal(value.gates,Math.ceil(value.length/25));assert.equal(value.finite,true);
 });
}
