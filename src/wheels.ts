import * as THREE from "three";

/** Preserve model axle locations; steer and roll on separate transforms. */
export class WheelRig {
  pivot = new THREE.Group();
  private restRotation: THREE.Quaternion;
  private restY: number;
  private modelScale: number;
  private mesh: THREE.Object3D;
  private rollRotation = new THREE.Quaternion();
  private axle = new THREE.Vector3(1, 0, 0);
  constructor(mesh: THREE.Object3D, modelScale: number) {
    this.mesh = mesh;
    this.modelScale = modelScale;
    this.restRotation = mesh.quaternion.clone();
    this.pivot.position.copy(mesh.position);
    this.restY = mesh.position.y;
    this.pivot.add(mesh);
    mesh.position.set(0, 0, 0);
  }
  update(steering: number, roll: number, suspensionLength: number) {
    this.pivot.rotation.y = steering;
    // Bound cosmetic travel to keep each source wheel seated in its own arch.
    this.pivot.position.y =
      this.restY +
      THREE.MathUtils.clamp(0.32 - suspensionLength, -0.06, 0.06) /
        this.modelScale;
    this.mesh.quaternion
      .copy(this.restRotation)
      .multiply(this.rollRotation.setFromAxisAngle(this.axle, roll));
  }
}
