import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  point,
  tangent,
  pose,
  ribbon,
  nearest,
  TRACK_WIDTH,
  trackBorder,
} from "./track";
import { roadMaterial, finishCarMaterials } from "./surfaces";
export const scene = new THREE.Scene();
export const prototypes = new Map<string, THREE.Group>();
const material = (color: number) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
const green = material(0x8fb36d),
  cream = material(0xf4efdb),
  red = material(0xe88e73),
  dark = material(0x344547);
let seed = 42;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
export function mesh(
  g: THREE.BufferGeometry,
  m: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  scene.add(o);
  return o;
}
function asphalt() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#737c7c";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 18000; i++) {
    const v = 100 + Math.floor(random() * 50);
    ctx.fillStyle = `rgba(${v},${v + 6},${v + 6},.2)`;
    ctx.fillRect(random() * 256, random() * 256, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
export async function buildWorld(onProgress: (text: string) => void) {
  const sky = await new THREE.TextureLoader().loadAsync(
    "/assets/skyboxes/skybox-morning.png",
  );
  sky.mapping = THREE.EquirectangularReflectionMapping;
  sky.colorSpace = THREE.SRGBColorSpace;
  sky.generateMipmaps = false;
  sky.minFilter = THREE.LinearFilter;
  sky.magFilter = THREE.LinearFilter;
  scene.background = sky;
  scene.environment = sky;
  scene.environmentIntensity = 0.32;
  scene.backgroundIntensity = 0.78;
  scene.backgroundRotation.y = 0.8;
  scene.environmentRotation.y = 0.8;
  scene.fog = new THREE.Fog(0xe2b5a6, 125, 340);
  scene.add(new THREE.HemisphereLight(0xaab6e1, 0x705746, 0.62));
  const sun = new THREE.DirectionalLight(0xffbc7c, 3.3);
  sun.position.set(-115, 42, -75);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, {
    left: -155,
    right: 155,
    top: 140,
    bottom: -140,
    near: 1,
    far: 380,
  });
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  scene.add(sun);
  mesh(
    new THREE.PlaneGeometry(2500, 2500),
    material(0x9bbfc5),
    0,
    -1.2,
    0,
  ).rotation.x = -Math.PI / 2;
  const land = mesh(
    new THREE.CylinderGeometry(175, 180, 5, 96),
    green,
    0,
    -2.55,
    0,
  );
  land.scale.z = 0.77;
  const road = mesh(
    ribbon(-TRACK_WIDTH / 2, TRACK_WIDTH / 2, 0.045),
    roadMaterial(asphalt()),
  );
  road.castShadow = false;
  mesh(ribbon(-9.15, -8, 0.032), cream).castShadow = false;
  mesh(ribbon(8, 9.15, 0.032), cream).castShadow = false;
  mesh(ribbon(-7.65, -7.43, 0.058), cream).castShadow = false;
  mesh(ribbon(7.43, 7.65, 0.058), cream).castShadow = false;
  const curbMaterials = [cream.clone(), red.clone()];
  curbMaterials.forEach((m) => {
    m.side = THREE.DoubleSide;
  });
  for (const side of [-1, 1]) {
    const curb = new THREE.Mesh(
      trackBorder(side * 8.6, 0.95, 0.035, 0.155, 880, 2),
      curbMaterials,
    );
    curb.castShadow = true;
    curb.receiveShadow = true;
    scene.add(curb);
  }
  // In-world checkered start line, grid, and finish gantry.
  const start = pose(0);
  const gantry = new THREE.Group();
  gantry.position.copy(start.position);
  gantry.rotation.y = start.yaw;
  scene.add(gantry);
  const local = (
    g: THREE.BufferGeometry,
    m: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    gantry.add(o);
    return o;
  };
  for (let x = 0; x < 16; x++)
    for (let z = 0; z < 3; z++)
      local(
        new THREE.BoxGeometry(1, 0.02, 1),
        (x + z) % 2 ? cream : dark,
        x - 7.5,
        0.075,
        z - 1,
      );
  // Slim start posts keep the horizon open in both narrow viewports.
  for (const x of [-10, 10]) {
    local(new THREE.CylinderGeometry(0.12, 0.16, 5.5, 8), dark, x, 2.75, 0);
    local(new THREE.CylinderGeometry(0.55, 0.55, 0.2, 16), cream, x, 0.1, 0);
    for (let ix = 0; ix < 3; ix++)
      for (let iy = 0; iy < 4; iy++) {
        local(
          new THREE.BoxGeometry(0.43, 0.43, 0.07),
          (ix + iy) % 2 ? cream : dark,
          x + (x > 0 ? 1 : -1) * (0.25 + ix * 0.43),
          4.4 + iy * 0.43,
          0,
        );
      }
  }
  for (const offset of [-3, 3])
    for (let row = 0; row < 3; row++) {
      local(
        new THREE.BoxGeometry(2.5, 0.02, 0.13),
        cream,
        offset,
        0.076,
        -4 - row * 5,
      );
    }
  // Soft sculpted hills give the course a horizon, without visual clutter.
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2,
      r = 195 + random() * 75,
      h = 15 + random() * 35;
    const hill = mesh(
      new THREE.SphereGeometry(1, 16, 12),
      material([0x9ab99b, 0xa7c4a6, 0xb4cbb1][i % 3]),
      Math.cos(a) * r,
      h * 0.08 - 7,
      Math.sin(a) * r * 0.8,
    );
    hill.scale.set(30 + random() * 35, h, 25 + random() * 25);
    hill.castShadow = false;
    hill.visible = false;
  }
  // A blue infield pond and pale sandy shore.
  const shore = mesh(
    new THREE.CylinderGeometry(1, 1, 0.04, 64),
    material(0xd9d5ac),
    42,
    0.035,
    -1,
  );
  shore.scale.set(22, 1, 15);
  const pond = mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.MeshStandardMaterial({
      color: 0x80bdc0,
      roughness: 0.3,
      metalness: 0.15,
    }),
    42,
    0.068,
    -1,
  );
  pond.rotation.x = -Math.PI / 2;
  pond.scale.set(20, 13.2, 1);
  pond.castShadow = false;
  const assets = [
    "cars/hatchback-sports",
    "cars/race",
    "nature/tree_oak",
    "nature/tree_pineRoundA",
    "nature/rock_largeA",
    "nature/plant_bush",
    "nature/flower_yellowA",
    "nature/flower_redA",
    "racing/grandStand",
    "racing/grandStandAwning",
    "racing/tent",
    "racing/flagCheckers",
    "racing/flagGreen",
    "racing/pylon",
  ];
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_u, n, total) =>
    onProgress(`Preparing the meadow · ${Math.round((n / total) * 100)}%`);
  const loader = new GLTFLoader(manager);
  await Promise.all(
    assets.map(async (name) => {
      const gltf = await loader.loadAsync(`/assets/${name}.glb`);
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      if (name.startsWith("cars/")) finishCarMaterials(gltf.scene);
      prototypes.set(name, gltf.scene);
    }),
  );
  function prop(name: string, x: number, z: number, height: number, rot = 0) {
    const obj = prototypes.get(name)!.clone();
    const box = new THREE.Box3().setFromObject(obj),
      size = box.getSize(new THREE.Vector3());
    const scale = height / size.y;
    obj.scale.setScalar(scale);
    obj.position.set(x, -box.min.y * scale, z);
    obj.rotation.y = rot;
    scene.add(obj);
    return obj;
  }
  for (let i = 0; i < 160; i++) {
    const x = (random() - 0.5) * 310,
      z = (random() - 0.5) * 220,
      d = nearest(x, z).distance;
    if (
      d < 15 ||
      (x * x) / 165 ** 2 + (z * z) / 122 ** 2 > 1 ||
      ((x - 42) / 28) ** 2 + ((z + 1) / 20) ** 2 < 1
    )
      continue;
    prop(
      i % 3 ? "nature/tree_oak" : "nature/tree_pineRoundA",
      x,
      z,
      5 + random() * 8,
      random() * 6.28,
    );
    if (i % 3 === 0)
      prop("nature/plant_bush", x + 3, z + 2, 1 + random(), random() * 6.28);
  }
  for (let i = 0; i < 45; i++) {
    const u = 0.12 + i * 0.018,
      p = pose(u, (i % 2 ? 1 : -1) * (17 + random() * 7));
    prop(
      i % 3 ? "nature/tree_oak" : "nature/tree_pineRoundA",
      p.position.x,
      p.position.z,
      7 + random() * 5,
      random() * 6.28,
    );
  }
  for (let i = 0; i < 90; i++) {
    const u = random(),
      p = pose(u, (random() > 0.5 ? 1 : -1) * (11 + random() * 4));
    prop(
      i % 7 === 0
        ? "nature/rock_largeA"
        : i % 2
          ? "nature/flower_yellowA"
          : "nature/flower_redA",
      p.position.x,
      p.position.z,
      i % 7 === 0 ? 1.5 : 0.35 + random() * 0.3,
      random() * 6.28,
    );
  }
  for (const [u, off, name, h] of [
    [0.015, -18, "racing/grandStand", 5],
    [0.055, -18, "racing/grandStandAwning", 7],
    [0.1, -17, "racing/tent", 5],
    [0.18, -13, "racing/flagGreen", 5],
    [0.4, -13, "racing/flagCheckers", 5],
    [0.7, 13, "racing/flagGreen", 5],
  ] as const) {
    const p = pose(u, off);
    prop(
      name,
      p.position.x,
      p.position.z,
      h,
      p.yaw + (off < 0 ? Math.PI / 2 : -Math.PI / 2),
    );
  }
  for (let i = 0; i < 12; i++) {
    const p = pose(0.84 + i * 0.006, -10);
    prop("racing/pylon", p.position.x, p.position.z, 0.9);
  }
  // Direction markers are scenery, not screen overlays.
  const arrowCanvas = document.createElement("canvas");
  arrowCanvas.width = 128;
  arrowCanvas.height = 64;
  const a = arrowCanvas.getContext("2d")!;
  a.fillStyle = "#f3ecd4";
  a.fillRect(0, 0, 128, 64);
  a.strokeStyle = "#435442";
  a.lineWidth = 9;
  for (let x = 30; x <= 90; x += 30) {
    a.beginPath();
    a.moveTo(x - 10, 12);
    a.lineTo(x + 8, 32);
    a.lineTo(x - 10, 52);
    a.stroke();
  }
  const arrowMap = new THREE.CanvasTexture(arrowCanvas);
  arrowMap.colorSpace = THREE.SRGBColorSpace;
  for (const u of [0.19, 0.23, 0.34, 0.43, 0.63, 0.76, 0.86]) {
    const p = pose(u, -11.5);
    const sign = mesh(
      new THREE.BoxGeometry(3.2, 1.6, 0.16),
      new THREE.MeshStandardMaterial({ map: arrowMap }),
      p.position.x,
      1.8,
      p.position.z,
    );
    sign.rotation.y = p.yaw + Math.PI / 2;
    mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 1.3, 6),
      dark,
      p.position.x,
      0.65,
      p.position.z,
    );
  }
}
