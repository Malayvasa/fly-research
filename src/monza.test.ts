import test from 'node:test';
import assert from 'node:assert/strict';
import {TRACK_LENGTH, point, mapPoint, samples, gates} from './track.ts';
test('Monza has its full official lap length, a closed seam, and bounded minimap', () => {
  assert.ok(Math.abs(TRACK_LENGTH-5793)<.01);
  assert.ok(point(0).distanceTo(point(1))<1e-9);
  assert.ok(gates.length>=230, 'gates remain dense through the chicanes');
  for(const p of samples) {
    const m=mapPoint(p.x,p.z);
    assert.ok(m.x>=-1e-6 && m.x<=84.000001);
    assert.ok(m.y>=-1e-6 && m.y<=60.000001);
  }
});
