import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { pose, TRACK_LENGTH } from "./track.ts";
export function createPhysicsWorld() {
  const world = new RAPIER.World({ x: 0, y: -18, z: 0 });
  world.timestep = 1 / 60;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(4000, 0.5, 4000)
      .setTranslation(0, -0.5, 0)
      .setFriction(0.6),
  );
  const segments = Math.ceil(TRACK_LENGTH / 2.5);
  for (let i = 0; i < segments; i++)
    for (const side of [-1, 1]) {
      const p = pose(i / segments, side * 10.1);
      const q = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        p.yaw,
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.2, 0.45, 1.45)
          .setTranslation(p.position.x, 0.45, p.position.z)
          .setRotation(q)
          .setRestitution(0.2),
      );
    }
  return world;
}
