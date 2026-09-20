import * as THREE from "three";
import { WheelRig } from "./wheels.ts";
import RAPIER from "@dimforge/rapier3d-compat";
import { nearest, point, pose, tangent, TRACK_LENGTH, gates } from "./track.ts";
import {
  createProgress,
  resetProgressPosition,
  type RacerProgress,
} from "./race.ts";
export type VehicleInput = {
  steering: number;
  throttle: number;
  brake: number;
  jump: boolean;
};
export const emptyInput = (): VehicleInput => ({
  steering: 0,
  throttle: 0,
  brake: 0,
  jump: false,
});
export class Kart {
  body: RAPIER.RigidBody;
  controller: RAPIER.DynamicRayCastVehicleController;
  visual = new THREE.Group();
  model: THREE.Group;
  wheels: WheelRig[] = [];
  steeringAngle = 0;
  grounded = false;
  jumpCount = 0;
  camera = new THREE.PerspectiveCamera(58, 1, 0.1, 600);
  progress: RacerProgress;
  yaw = 0;
  steer = 0;
  speed = 0;
  offtrack = 0;
  stuck = 0;
  resets = 0;
  jumpHeld = false;
  jumpCooldown = 0;
  distance = 0;
  nearU = 0;
  input = emptyInput();
  lastPosition = new THREE.Vector3();
  renderPosition = new THREE.Vector3();
  world: RAPIER.World;
  lane: number;
  constructor(world: RAPIER.World, model: THREE.Group, lane: number) {
    this.world = world;
    this.lane = lane;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 1, 0)
        .enabledRotations(false, true, false)
        .setLinearDamping(0.18)
        .setAngularDamping(8)
        .setCcdEnabled(true),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.65, 0.22, 1.02)
        .setMass(28)
        .setFriction(0.1)
        .setRestitution(0.15),
      this.body,
    );
    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    for (const z of [0.85, -0.85])
      for (const x of [-0.69, 0.69]) {
        this.controller.addWheel(
          { x, y: -0.1, z },
          { x: 0, y: -1, z: 0 },
          { x: -1, y: 0, z: 0 },
          0.32,
          0.3,
        );
        const i = this.controller.numWheels() - 1;
        this.controller.setWheelSuspensionStiffness(i, 35);
        this.controller.setWheelSuspensionCompression(i, 4.4);
        this.controller.setWheelSuspensionRelaxation(i, 5);
        this.controller.setWheelMaxSuspensionForce(i, 10000);
        this.controller.setWheelFrictionSlip(i, 3.5);
        this.controller.setWheelSideFrictionStiffness(i, 1.8);
      }
    this.model = model.clone();
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    this.model.scale.setScalar(3.5 / size.z);
    this.model.position.y = -0.56 - box.min.y * this.model.scale.x;
    const wheelMeshes: THREE.Object3D[] = [];
    this.model.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name.startsWith("kart-")) {
        o.material = (o.material as THREE.MeshStandardMaterial).clone();
        (o.material as THREE.MeshStandardMaterial).color.set(
          lane > 0 ? 0xc4df8c : 0xefa58b,
        );
      }
      if (o.name.startsWith("wheel-")) wheelMeshes.push(o);
    });
    // Match named source wheels to Rapier's front-right/front-left/rear-right/rear-left order.
    for (const name of [
      "wheel-front-right",
      "wheel-front-left",
      "wheel-back-right",
      "wheel-back-left",
    ]) {
      const wheel = wheelMeshes.find((o) => o.name === name);
      if (!wheel) continue;
      const parent = wheel.parent!;
      const rig = new WheelRig(wheel, this.model.scale.x);
      this.wheels.push(rig);
      parent.add(rig.pivot);
    }
    this.visual.add(this.model);
    this.progress = createProgress({ x: 0, z: 0 });
    this.reset(true);
  }
  reset(fresh = false) {
    const u = fresh ? 0.98 : ((this.progress.nextGate + gates.length - 1) % gates.length) / gates.length + 0.004;
    const p = pose(u, this.lane);
    this.yaw = p.yaw;
    this.body.setTranslation(
      { x: p.position.x, y: 0.7, z: p.position.z },
      true,
    );
    this.body.setRotation(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        this.yaw,
      ),
      true,
    );
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.speed = 0;
    this.steer = 0;
    this.offtrack = 0;
    this.stuck = 0;
    this.jumpHeld = false;
    this.jumpCooldown = 0;
    this.nearU = u;
    if (fresh) {
      this.progress = createProgress(p.position);
      this.resets = 0;
    } else {
      resetProgressPosition(this.progress, p.position);
      this.resets++;
    }
    this.lastPosition.set(p.position.x, 0.7, p.position.z);
    this.renderPosition.copy(this.lastPosition);
    this.visual.position.copy(this.lastPosition);
    this.visual.rotation.y = this.yaw;
    this.updateCamera(1, true);
  }
  npcInput(): VehicleInput {
    const p = this.body.translation(),
      n = nearest(p.x, p.z),
      look = point(n.u + (8 + Math.abs(this.speed) * 0.48) / TRACK_LENGTH);
    const desired = Math.atan2(look.x - p.x, look.z - p.z);
    const error = Math.atan2(
      Math.sin(desired - this.yaw),
      Math.cos(desired - this.yaw),
    );
    // Preview curvature and plan a braking envelope before entering each bend.
    // The car still uses exactly the same engine, brakes and traction as the human.
    let target = 26.5;
    for (const distance of [0, 6, 12, 20, 30, 44]) {
      const u = n.u + distance / TRACK_LENGTH;
      const before = tangent(u - 3 / TRACK_LENGTH);
      const after = tangent(u + 3 / TRACK_LENGTH);
      const curvature =
        Math.acos(THREE.MathUtils.clamp(before.dot(after), -1, 1)) / 6;
      const cornerSpeed = THREE.MathUtils.clamp(
        Math.sqrt(11 / Math.max(curvature, 0.001)),
        12,
        26.5,
      );
      target = Math.min(
        target,
        Math.sqrt(
          cornerSpeed * cornerSpeed + 2 * 7 * Math.max(0, distance - 5),
        ),
      );
    }
    // Back off if a collision or grass excursion leaves us pointing away from the road.
    target = Math.min(target, 26.5 / (1 + Math.abs(error) * 0.8));
    if (n.distance > 6.5) target = Math.min(target, 13);
    const speedError = target - this.speed;
    const braking = speedError < -0.7;
    return {
      steering: THREE.MathUtils.clamp(-error * 1.9, -1, 1),
      throttle: braking
        ? 0
        : THREE.MathUtils.clamp(0.2 + speedError * 0.45, 0, 1),
      brake: braking ? THREE.MathUtils.clamp(-speedError * 0.22, 0, 1) : 0,
      jump: false,
    };
  }

  step(dt: number, input: VehicleInput, active: boolean) {
    this.lastPosition.copy(this.body.translation());
    this.input = input;
    const v = this.body.linvel(),
      q = this.body.rotation();
    this.yaw = Math.atan2(
      2 * (q.w * q.y + q.x * q.z),
      1 - 2 * (q.y * q.y + q.z * q.z),
    );
    const forward = new THREE.Vector3(
      Math.sin(this.yaw),
      0,
      Math.cos(this.yaw),
    );
    this.speed = v.x * forward.x + v.z * forward.z;
    const n = nearest(this.body.translation().x, this.body.translation().z);
    this.nearU = n.u;
    this.distance = n.distance;
    this.steer = THREE.MathUtils.damp(
      this.steer,
      active ? input.steering : 0,
      8,
      dt,
    );
    let engine = 0,
      brake = 0;
    if (active) {
      if (input.throttle) engine = this.speed < 27 ? 110 * input.throttle : 0;
      else if (input.brake) {
        if (this.speed > 1) brake = 9 * input.brake;
        else engine = this.speed > -8 ? -65 * input.brake : 0;
      }
    } else brake = 20;
    if (n.distance > 8.1) {
      engine *= 0.5;
      this.body.setLinearDamping(1.7);
    } else this.body.setLinearDamping(0.18);
    this.steeringAngle =
      -this.steer *
      THREE.MathUtils.lerp(0.44, 0.28, Math.min(Math.abs(this.speed) / 27, 1));
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelEngineForce(i, engine);
      this.controller.setWheelBrake(i, brake);
      this.controller.setWheelSteering(i, i < 2 ? this.steeringAngle : 0);
    }
    this.controller.updateVehicle(dt);
    // Arcade yaw assist keeps keyboard handling readable; suspension and contacts remain physical.
    const grounded = Array.from({ length: 4 }, (_, i) =>
      this.controller.wheelIsInContact(i),
    ).some(Boolean);
    this.grounded = grounded;
    if (grounded) {
      const turn =
        -this.steer *
        Math.min(Math.abs(this.speed) * 0.085, 1.65) *
        Math.sign(this.speed);
      this.body.setAngvel({ x: 0, y: turn, z: 0 }, true);
    }
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    if (
      active &&
      input.jump &&
      !this.jumpHeld &&
      grounded &&
      this.jumpCooldown === 0
    ) {
      const vel = this.body.linvel();
      this.body.setLinvel({ x: vel.x, y: 7.2, z: vel.z }, true);
      this.jumpCooldown = 0.6;
      this.jumpCount++;
    }
    this.jumpHeld = input.jump;
    if (active) {
      this.offtrack = n.distance > 24 ? this.offtrack + dt : 0;
      this.stuck =
        input.throttle > 0.5 && Math.abs(this.speed) < 0.5
          ? this.stuck + dt
          : 0;
      if (this.offtrack > 2 || this.body.translation().y < -5 || this.stuck > 6)
        this.reset();
    }
  }
  render(dt: number, alpha: number, wide = false) {
    const p = this.body.translation();
    this.renderPosition.lerpVectors(
      this.lastPosition,
      new THREE.Vector3(p.x, p.y, p.z),
      alpha,
    );
    this.visual.position.copy(this.renderPosition);
    this.visual.quaternion.copy(this.body.rotation());
    this.model.rotation.z = THREE.MathUtils.damp(
      this.model.rotation.z,
      this.steer * Math.min(Math.abs(this.speed) / 26, 1) * 0.055,
      7,
      dt,
    );
    for (let i = 0; i < this.wheels.length; i++) {
      this.wheels[i].update(
        this.controller.wheelSteering(i) ?? 0,
        this.controller.wheelRotation(i) ?? 0,
        this.controller.wheelSuspensionLength(i) ?? 0.32,
      );
    }
    this.updateCamera(dt, false, wide);
  }
  updateCamera(dt: number, snap = false, wide = false) {
    const p = this.renderPosition,
      behind = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const desired = p
      .clone()
      .addScaledVector(
        behind,
        (wide ? 17 : 10.5) + Math.min(Math.abs(this.speed) * 0.02, 0.55),
      );
    desired.y = (wide ? 10 : 6.8) + p.y * 0.3;
    this.camera.position.lerp(desired, snap ? 1 : 1 - Math.exp(-5 * dt));
    const target = p.clone().addScaledVector(behind, -7);
    target.y = 1.25 + p.y * 0.3;
    this.camera.lookAt(target);
    this.camera.fov = 58 + Math.min(Math.abs(this.speed) * 0.055, 1.5);
    this.camera.updateProjectionMatrix();
  }
}
