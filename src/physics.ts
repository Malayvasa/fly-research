import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { pose } from "./track.ts";
export function createPhysicsWorld() {
  const world = new RAPIER.World({ x: 0, y: -18, z: 0 });
  world.timestep = 1 / 60;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(600, 0.5, 600)
      .setTranslation(0, -0.5, 0)
      .setFriction(0.6),
  );
  for (let i = 0; i < 240; i++)
    for (const side of [-1, 1]) {
      const p = pose(i / 240, side * 10.1);
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
