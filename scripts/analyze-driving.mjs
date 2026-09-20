import {readFile} from 'node:fs/promises';
import {point, nearest, TRACK_LENGTH} from '../src/track.ts';

// Offline comparison only: expert targets are never sent to the live controller.
const {samples} = JSON.parse(await readFile(process.argv[2], 'utf8'));
const sectors = new Map();
for (const sample of samples) {
  const car = sample.cars[0];
  if (car.speed < 2) continue;
  const n = nearest(car.position.x, car.position.z);
  const look = point(n.u + 12 / TRACK_LENGTH);
  const desired = Math.atan2(look.x - car.position.x, look.z - car.position.z);
  const error = Math.atan2(Math.sin(desired - car.yaw), Math.cos(desired - car.yaw));
  const target = Math.max(-1, Math.min(1, -1.9 * error));
  const sector = Math.floor(n.u * 20);
  const row = sectors.get(sector) ?? {sector, count:0, error:0, maxDistance:0};
  row.count++;
  row.error += Math.abs(target - sample.fly.input.steering);
  row.maxDistance = Math.max(row.maxDistance, n.distance);
  sectors.set(sector, row);
}
console.table([...sectors.values()].sort((a,b)=>a.sector-b.sector)
  .map(({sector,count,error,maxDistance})=>({sector,count,MAE:error/count,maxDistance})));
