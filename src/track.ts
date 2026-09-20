import * as THREE from "three";
import { findCircuit } from "./circuits/index.ts";
const requested =
  typeof location !== "undefined"
    ? new URLSearchParams(location.search).get("track")
    : (
        globalThis as typeof globalThis & {
          process?: { env: Record<string, string | undefined> };
        }
      ).process?.env.FLY_TRACK;
export const circuit = requested && requested !== "meadow" ? findCircuit(requested) : null;
export const TRACK_WIDTH = 16;
function makeCurve() {
if (!circuit) return new THREE.CatmullRomCurve3(
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
// Project longitude/latitude into local metres without changing the track proportions.
const origin = circuit.coordinates[0];
const raw = circuit.coordinates.map(
  ([lon, lat]) =>
    new THREE.Vector3(
      (lon - origin[0]) * 111320 * Math.cos((origin[1] * Math.PI) / 180),
      0,
      -(lat - origin[1]) * 111320,
    ),
);
// Densify long straights before smoothing, so chicanes cannot bow the whole straight.
const control: THREE.Vector3[] = [];
for (let i = 0; i < raw.length; i++) {
  const a = raw[i],
    b = raw[(i + 1) % raw.length];
  const count = Math.max(1, Math.ceil(a.distanceTo(b) / 12));
  for (let j = 0; j < count; j++) control.push(a.clone().lerp(b, j / count));
}
const result = new THREE.CatmullRomCurve3(control, true, "centripetal");
result.arcLengthDivisions = 16000;
// The source is mapped geometry; calibrate uniformly to the selected circuit lap length.
const calibration = circuit.length / result.getLength();
control.forEach((p) => p.multiplyScalar(calibration));
result.updateArcLengths();
return result;
}
export const curve = makeCurve();
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
export const samples = Array.from({ length: 4096 }, (_, i) => point(i / 4096));
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
const gateCount = circuit ? Math.ceil(TRACK_LENGTH / 25) : 20;
export const gates = Array.from({ length: gateCount }, (_, i) => {
  const p = point(i / gateCount),
    t = tangent(i / gateCount);
  return { x: p.x, z: p.z, dx: t.x, dz: t.z, halfWidth: TRACK_WIDTH / 2 + 1.2 };
});
export function ribbon(
  inner: number,
  outer: number,
  y: number,
  segments = 4096,
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

/** A closed border swept along the circuit: adjacent spans share exact edges, not overlapping boxes. */
export function trackBorder(
  offset: number,
  width: number,
  bottom: number,
  top: number,
  segments: number,
  stripeLength = 1,
) {
  const vertices: number[] = [];
  const indices: number[] = [];
  const bands: number[][] = [[], []];
  const geometry = new THREE.BufferGeometry();
  for (let i = 0; i <= segments; i++) {
    const a = pose(i / segments, offset - width / 2).position;
    const b = pose(i / segments, offset + width / 2).position;
    vertices.push(
      a.x,
      bottom,
      a.z,
      a.x,
      top,
      a.z,
      b.x,
      top,
      b.z,
      b.x,
      bottom,
      b.z,
    );
  }
  for (let i = 0; i < segments; i++) {
    const band = bands[Math.floor(i / stripeLength) % 2];
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 3],
    ]) {
      const j = i * 4;
      band.push(j + a, j + 4 + a, j + b, j + b, j + 4 + a, j + 4 + b);
    }
  }
  for (let material = 0; material < 2; material++) {
    geometry.addGroup(indices.length, bands[material].length, material);
    indices.push(...bands[material]);
  }
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export const bounds = new THREE.Box3().setFromPoints(samples);
export function mapPoint(x: number, z: number) {
  const size = bounds.getSize(new THREE.Vector3());
  const scale = Math.min(84 / size.x, 60 / size.z);
  return {
    x: 42 + (x - (bounds.min.x + bounds.max.x) / 2) * scale,
    y: 30 + (z - (bounds.min.z + bounds.max.z) / 2) * scale,
  };
}
