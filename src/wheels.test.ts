import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { WheelRig } from "./wheels.ts";

test("wheel rig preserves source axle and scale while rolling and steering", () => {
  const parent = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.5));
  mesh.position.set(0.35, 0.3, 0.64);
  mesh.scale.setScalar(0.8);
  parent.add(mesh);
  const rig = new WheelRig(mesh, 1.3);
  parent.add(rig.pivot);
  for (const roll of [0, Math.PI / 2, Math.PI, 12]) {
    rig.update(0.3, roll, 0.32);
    assert.deepEqual(rig.pivot.position.toArray(), [0.35, 0.3, 0.64]);
    assert.deepEqual(mesh.scale.toArray(), [0.8, 0.8, 0.8]);
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(
      mesh.getWorldQuaternion(new THREE.Quaternion()),
    );
    assert.ok(
      axis.distanceTo(new THREE.Vector3(Math.cos(0.3), 0, -Math.sin(0.3))) <
        1e-10,
    );
  }
  rig.update(0, 0, 2);
  assert.ok(Math.abs(rig.pivot.position.y - 0.3) * 1.3 <= 0.060001);
});
