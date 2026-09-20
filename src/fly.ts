import * as THREE from "three";

const up = new THREE.Vector3(0, 1, 0);
const shell = new THREE.MeshStandardMaterial({
  color: 0x629a91,
  metalness: 0,
  roughness: 0.95,
  flatShading: false,
});
const dark = new THREE.MeshStandardMaterial({
  color: 0x3f6662,
  roughness: 0.75,
});
const eye = new THREE.MeshStandardMaterial({
  color: 0xe88770,
  roughness: 0.85,
  metalness: 0,
  flatShading: false,
});
const amber = new THREE.MeshStandardMaterial({
  color: 0xd2b47a,
  roughness: 0.65,
});
function oval(
  parent: THREE.Object3D,
  material: THREE.Material,
  position: number[],
  scale: number[],
  detail = 1,
) {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, Math.max(3, detail)),
    material,
  );
  mesh.position.fromArray(position);
  mesh.scale.fromArray(scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function segment(
  parent: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material = dark,
) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.65, radius, a.distanceTo(b), 12),
    material,
  );
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Original procedural fly. Its six feet stay planted while the body reacts to driving. */
export class FlyDriver {
  root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private wings: THREE.Group[] = [];
  private legs: {
    upper: THREE.Mesh;
    hip: THREE.Vector3;
    knee: THREE.Vector3;
    foot: THREE.Vector3;
  }[] = [];
  private clock = 0;
  private wingPhase = 0;
  private wingEnergy = 0;
  private wingStartle = 0;
  private previousSpeed = 0;
  private previousVerticalSpeed = 0;
  private spring = 0;
  private springVelocity = 0;
  constructor() {
    this.root.name = "Original procedural fly driver";
    this.root.add(this.body);
    oval(this.body, shell, [0, 0.42, 0], [0.28, 0.32, 0.4]);
    // A compact silhouette with just two readable abdominal bands.
    oval(this.body, shell, [0, 0.38, -0.37], [0.32, 0.27, 0.43]);
    oval(this.body, dark, [0, 0.37, -0.51], [0.29, 0.235, 0.15]);
    oval(this.body, shell, [0, 0.36, -0.67], [0.24, 0.21, 0.22]);
    this.head.position.set(0, 0.64, 0.36);
    this.body.add(this.head);
    oval(this.head, dark, [0, 0, 0], [0.3, 0.27, 0.25]);
    for (const side of [-1, 1]) {
      oval(this.head, eye, [side * 0.22, 0.035, 0.1], [0.235, 0.28, 0.225], 1);
      oval(
        this.head,
        new THREE.MeshStandardMaterial({ color: 0xffedce, roughness: 1 }),
        [side * 0.25, 0.17, 0.275],
        [0.06, 0.075, 0.025],
        1,
      );
      segment(
        this.head,
        v(side * 0.065, 0.03, 0.2),
        v(side * 0.105, 0.11, 0.31),
        0.022,
      );
      segment(
        this.head,
        v(side * 0.105, 0.11, 0.31),
        v(side * 0.15, 0.19, 0.35),
        0.025,
      );
      oval(
        this.head,
        dark,
        [side * 0.15, 0.19, 0.35],
        [0.043, 0.046, 0.043],
        1,
      );
    }
    segment(this.head, v(0, -0.12, 0.17), v(0, -0.24, 0.28), 0.033);
    oval(this.head, amber, [0, -0.24, 0.28], [0.058, 0.025, 0.038], 1);
    for (const side of [-1, 1]) {
      const wing = new THREE.Group();
      wing.name = side < 0 ? "wing-left" : "wing-right";
      wing.position.set(side * 0.18, 0.65, -0.05);
      this.body.add(wing);
      this.wings.push(wing);
      // Thin, rounded membranes swept backward from a narrow wing root.
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.bezierCurveTo(
        side * 0.13,
        0.035,
        side * 0.49,
        -0.19,
        side * 0.59,
        -0.57,
      );
      shape.bezierCurveTo(
        side * 0.67,
        -0.83,
        side * 0.52,
        -1.02,
        side * 0.36,
        -0.94,
      );
      shape.bezierCurveTo(side * 0.17, -0.85, side * 0.07, -0.35, 0, 0);
      const geometry = new THREE.ShapeGeometry(shape, 20);
      geometry.rotateX(Math.PI / 2);
      const membrane = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: 0xdcece5,
          roughness: 0.65,
          metalness: 0,
          transparent: true,
          opacity: 0.68,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      wing.add(membrane);
      const veinMaterial = new THREE.MeshStandardMaterial({
        color: 0x91b4aa,
        roughness: 1,
      });
      const vein = (points: THREE.Vector3[], radius: number) => {
        const curve = new THREE.CatmullRomCurve3(points);
        wing.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(curve, 24, radius, 5, false),
            veinMaterial,
          ),
        );
      };
      const outline = shape.getPoints(40).map((p) => v(p.x, 0.003, p.y));
      vein(outline, 0.0035);
      vein(
        [
          v(0, 0.005, 0),
          v(side * 0.25, 0.005, -0.34),
          v(side * 0.43, 0.005, -0.89),
        ],
        0.005,
      );
      vein(
        [
          v(side * 0.13, 0.005, -0.18),
          v(side * 0.39, 0.005, -0.37),
          v(side * 0.57, 0.005, -0.62),
        ],
        0.003,
      );
      vein(
        [
          v(side * 0.25, 0.005, -0.34),
          v(side * 0.24, 0.005, -0.61),
          v(side * 0.3, 0.005, -0.89),
        ],
        0.003,
      );
      vein(
        [
          v(side * 0.24, 0.005, -0.61),
          v(side * 0.38, 0.005, -0.59),
          v(side * 0.53, 0.005, -0.7),
        ],
        0.0025,
      );
      oval(this.body, amber, [side * 0.29, 0.39, -0.3], [0.03, 0.045, 0.03], 1);
      for (let i = 0; i < 3; i++) {
        const z = 0.28 - i * 0.3,
          hip = v(side * 0.2, 0.4, z);
        const knee = v(
          side * (0.43 + i * 0.045),
          0.28,
          z + (i === 0 ? 0.18 : i === 1 ? 0.04 : -0.2),
        );
        const foot = v(
          side * (0.38 + i * 0.065),
          0.025,
          z + (i === 0 ? 0.4 : i === 1 ? -0.02 : -0.38),
        );
        const upper = segment(this.root, hip, knee, 0.024);
        this.legs.push({ upper, hip, knee, foot });
        segment(this.root, knee, foot, 0.015);
        oval(this.root, dark, knee.toArray(), [0.025, 0.025, 0.025], 1);
        const toe = foot
          .clone()
          .add(v(-side * 0.035, -0.015, i === 0 ? 0.065 : -0.05));
        segment(this.root, foot, toe, 0.01);
        segment(
          this.root,
          toe,
          toe.clone().add(v(-side * 0.015, -0.01, 0.025)),
          0.006,
        );
      }
    }
  }
  update(
    dt: number,
    speed: number,
    steering: number,
    verticalSpeed: number,
    grounded: boolean,
  ) {
    if (dt <= 0) return;
    this.clock += dt;
    const acceleration = THREE.MathUtils.clamp(
      (speed - this.previousSpeed) / dt,
      -18,
      18,
    );
    this.previousSpeed = speed;
    if (grounded && this.previousVerticalSpeed < -1.5 && verticalSpeed > -1) {
      this.springVelocity -= Math.min(0.9, -this.previousVerticalSpeed * 0.12);
      this.wingStartle = 1;
    }
    this.previousVerticalSpeed = verticalSpeed;
    this.springVelocity += (-this.spring * 90 - this.springVelocity * 12) * dt;
    this.spring = THREE.MathUtils.clamp(
      this.spring + this.springVelocity * dt,
      -0.1,
      0.1,
    );
    this.body.position.y = this.spring + Math.sin(this.clock * 3) * 0.008;
    // The practice controller makes small corrections: amplify them for a readable driver pose.
    const lean = Math.tanh(steering * 3.8) * Math.min(Math.abs(speed) / 10, 1);
    this.body.position.x = THREE.MathUtils.damp(
      this.body.position.x,
      -lean * 0.13,
      9,
      dt,
    );
    this.body.rotation.z = THREE.MathUtils.damp(
      this.body.rotation.z,
      lean * 0.62,
      8,
      dt,
    );
    this.body.rotation.x = THREE.MathUtils.damp(
      this.body.rotation.x,
      acceleration * 0.015 + (grounded ? 0 : -0.12),
      7,
      dt,
    );
    this.head.rotation.y = THREE.MathUtils.damp(
      this.head.rotation.y,
      -lean * 0.4,
      7,
      dt,
    );
    const pace = THREE.MathUtils.clamp(Math.abs(speed) / 27, 0, 1);
    const turn = THREE.MathUtils.clamp(steering, -1, 1) * pace;
    this.wingStartle *= Math.exp(-4 * dt);
    this.wingEnergy = THREE.MathUtils.damp(
      this.wingEnergy,
      Math.min(
        1,
        pace * 0.7 +
          (Math.abs(acceleration) / 18) * 0.35 +
          (grounded ? 0 : 0.8) +
          this.wingStartle * 0.6,
      ),
      5,
      dt,
    );
    // Integrate phase so changing speed never snaps to a different flap position.
    this.wingPhase += dt * THREE.MathUtils.lerp(5, 28, this.wingEnergy);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const amplitude = 0.025 + this.wingEnergy * 0.43;
      const flap = Math.sin(this.wingPhase + side * turn * 0.5) * amplitude;
      const lift = 0.12 + this.wingEnergy * 0.22 + flap + side * turn * 0.16;
      const wing = this.wings[i];
      wing.rotation.z = side * lift;
      wing.rotation.y = THREE.MathUtils.damp(
        wing.rotation.y,
        side * (pace * 0.24 + this.wingStartle * 0.14) + turn * 0.12,
        7,
        dt,
      );
      wing.rotation.x = THREE.MathUtils.damp(
        wing.rotation.x,
        -0.08 * pace + acceleration * 0.006,
        7,
        dt,
      );
    }
    this.body.updateMatrix();
    for (const leg of this.legs) {
      const hip = leg.hip.clone().applyMatrix4(this.body.matrix);
      leg.upper.position.copy(hip).add(leg.knee).multiplyScalar(0.5);
      leg.upper.quaternion.setFromUnitVectors(
        up,
        leg.knee.clone().sub(hip).normalize(),
      );
      leg.upper.scale.y =
        hip.distanceTo(leg.knee) / leg.hip.distanceTo(leg.knee);
    }
  }
}
