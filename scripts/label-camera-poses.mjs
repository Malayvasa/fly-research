import {readFile, writeFile} from 'node:fs/promises';
import {point, nearest, TRACK_LENGTH} from '../src/track.ts';

const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (!input.metadata && process.argv[4]) {
  const results = JSON.parse(await readFile(process.argv[4], 'utf8'));
  input.metadata = results.samples.findLast(sample => sample.fly.metadata)?.fly.metadata;
}
if (!input.metadata) throw new Error('Session metadata is missing');
const frames = input.frames.map(frame => {
  const u = nearest(frame.position.x, frame.position.z).u;
  const look = point(u + 12 / TRACK_LENGTH);
  const desired = Math.atan2(look.x - frame.position.x, look.z - frame.position.z);
  const error = Math.atan2(Math.sin(desired - frame.yaw), Math.cos(desired - frame.yaw));
  return {...frame, u, steering: Math.max(-1, Math.min(1, -1.9 * error))};
});
await writeFile(process.argv[3], JSON.stringify({...input, frames}));
console.log(`Labeled ${frames.length} camera poses offline`);
