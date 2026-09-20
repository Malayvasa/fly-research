import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createPhysicsWorld } from "./physics.ts";
import { Kart, emptyInput } from "./vehicle.ts";
import { gates } from "./track.ts";
import { advanceProgress } from "./race.ts";
await RAPIER.init();
function setup() {
  const w = createPhysicsWorld();
  const m = new THREE.Group();
  m.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 2)));
  const k = new Kart(w, m, 0);
  for (let i = 0; i < 60; i++) {
    k.step(1 / 60, emptyInput(), false);
    w.step();
  }
  return { w, k };
}
test("throttle, reverse, steering, and grounded jump work with Rapier", () => {
  const { w, k } = setup();
  const start = { ...k.body.translation() };
  for (let i = 0; i < 180; i++) {
    k.step(1 / 60, { ...emptyInput(), throttle: 1 }, true);
    w.step();
  }
  assert.ok(k.speed > 10, `forward speed ${k.speed}`);
  assert.ok(
    Math.hypot(
      k.body.translation().x - start.x,
      k.body.translation().z - start.z,
    ) > 15,
  );
  const yaw = k.yaw;
  for (let i = 0; i < 30; i++) {
    k.step(1 / 60, { ...emptyInput(), throttle: 1, steering: 1 }, true);
    w.step();
  }
  assert.ok(k.yaw < yaw, "D turns right");
  k.reset(true);
  for (let i = 0; i < 60; i++) {
    k.step(1 / 60, emptyInput(), false);
    w.step();
  }
  const ground = k.body.translation().y;
  let peak = ground;
  for (let i = 0; i < 90; i++) {
    k.step(1 / 60, { ...emptyInput(), jump: true }, true);
    w.step();
    peak = Math.max(peak, k.body.translation().y);
  }
  assert.ok(peak > ground + 1, `jump peak ${peak}`);
  assert.ok(
    k.body.translation().y < ground + 0.2,
    "holding space does not repeatedly jump",
  );
  for (let i = 0; i < 120; i++) {
    k.step(1 / 60, { ...emptyInput(), brake: 1 }, true);
    w.step();
  }
  assert.ok(k.speed < -1, `reverse speed ${k.speed}`);
  w.free();
});
test("practice controller completes three physical laps without teleporting", () => {
  const { w, k } = setup();
  let time = 0,
    maxDistance = 0;
  for (let i = 0; i < 60 * 180 && k.progress.finishTime === null; i++) {
    k.step(1 / 60, k.npcInput(), true);
    w.step();
    time += 1 / 60;
    advanceProgress(k.progress, k.body.translation(), gates, time);
    maxDistance = Math.max(maxDistance, k.distance);
  }
  console.log({
    time,
    laps: k.progress.lapTimes,
    resets: k.resets,
    maxDistance,
    position: k.body.translation(),
    speed: k.speed,
    nextGate: k.progress.nextGate,
  });
  assert.equal(k.progress.lapTimes.length, 3);
  assert.equal(k.resets, 0);
  assert.ok(maxDistance < 8);
  w.free();
});
