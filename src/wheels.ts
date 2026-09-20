import * as THREE from "three";

/** Steering lives on a parent pivot; rolling never tilts the steering axis. */
export class WheelRig {
  pivot = new THREE.Group();
  restRotation: THREE.Quaternion;
  constructor(publicMesh: THREE.Object3D, x: number, z: number) {
    this.mesh = publicMesh;
    this.restRotation = publicMesh.quaternion.clone();
    this.pivot.position.set(x, -0.4, z);
    this.pivot.add(publicMesh);
    publicMesh.position.set(0, 0, 0);
  }
  mesh: THREE.Object3D;
  update(steering: number, roll: number, suspensionLength: number) {
    this.pivot.rotation.y = steering;
    this.pivot.position.y = -0.1 - suspensionLength;
    this.mesh.quaternion
      .copy(this.restRotation)
      .multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          roll,
        ),
      );
  }
}
