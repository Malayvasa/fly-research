import * as THREE from "three";
export const TRACK_WIDTH = 16;
export const curve = new THREE.CatmullRomCurve3(
  [
    [-55, 62],
    [0, 62],
    [55, 62],
    [91, 38],
    [98, -5],
    [65, -52],
    [15, -62],
    [-20, -30],
    [-63, -50],
    [-100, -26],
    [-100, 24],
    [-82, 55],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  true,
  "catmullrom",
  0.5,
);
export const TRACK_LENGTH = curve.getLength();
export const wrap = (u: number) => ((u % 1) + 1) % 1;
export const point = (u: number) => curve.getPointAt(wrap(u));
export const tangent = (u: number) => curve.getTangentAt(wrap(u)).normalize();
export function pose(u: number, offset = 0) {
  const p = point(u),
    t = tangent(u);
  p.addScaledVector(new THREE.Vector3(t.z, 0, -t.x), offset);
  return { position: p, yaw: Math.atan2(t.x, t.z) };
}
export const samples = Array.from({ length: 720 }, (_, i) => point(i / 720));
export function nearest(x: number, z: number) {
  let index = 0,
    distance = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < distance) {
      distance = d;
      index = i;
    }
  }
  return { u: index / samples.length, distance: Math.sqrt(distance) };
}
export const gates = Array.from({ length: 20 }, (_, i) => {
  const p = point(i / 20),
    t = tangent(i / 20);
  return { x: p.x, z: p.z, dx: t.x, dz: t.z, halfWidth: TRACK_WIDTH / 2 + 1.2 };
});
export function ribbon(
  inner: number,
  outer: number,
  y: number,
  segments = 720,
) {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments,
      p = point(u),
      t = tangent(u),
      n = new THREE.Vector3(t.z, 0, -t.x);
    for (const w of [inner, outer]) {
      positions.push(p.x + n.x * w, y, p.z + n.z * w);
      uvs.push(((i / segments) * TRACK_LENGTH) / 8, w / 8);
    }
    if (i < segments) {
      const j = i * 2;
      indices.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
