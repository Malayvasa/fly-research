import { monzaCoordinates } from "./monza.ts";
import { silverstoneCoordinates } from "./silverstone.ts";
import { spaCoordinates } from "./spa.ts";
import { interlagosCoordinates } from "./interlagos.ts";
import { red_bull_ringCoordinates } from "./red-bull-ring.ts";
export const circuits = [
  {
    id: "monza",
    name: "Monza",
    country: "Italy",
    length: 5793,
    coordinates: monzaCoordinates,
  },
  {
    id: "silverstone",
    name: "Silverstone",
    country: "Great Britain",
    length: 5891,
    coordinates: silverstoneCoordinates,
  },
  {
    id: "spa",
    name: "Spa-Francorchamps",
    country: "Belgium",
    length: 7004,
    coordinates: spaCoordinates,
  },
  {
    id: "interlagos",
    name: "Interlagos",
    country: "Brazil",
    length: 4309,
    coordinates: interlagosCoordinates,
  },
  {
    id: "red-bull-ring",
    name: "Red Bull Ring",
    country: "Austria",
    length: 4318,
    coordinates: red_bull_ringCoordinates,
  },
];
export type Circuit = (typeof circuits)[number];
export const findCircuit = (id: string | null | undefined) =>
  circuits.find((c) => c.id === id) ?? circuits[0];
export function outline(circuit: Circuit) {
  const points = circuit.coordinates.map(([x, y]) => [
    x * Math.cos((circuit.coordinates[0][1] * Math.PI) / 180),
    -y,
  ]);
  const minX = Math.min(...points.map((p) => p[0])),
    maxX = Math.max(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1])),
    maxY = Math.max(...points.map((p) => p[1]));
  const scale = Math.min(80 / (maxX - minX), 48 / (maxY - minY));
  return (
    points
      .map(
        ([x, y], i) =>
          `${i ? "L" : "M"}${50 + (x - (minX + maxX) / 2) * scale},${30 + (y - (minY + maxY) / 2) * scale}`,
      )
      .join(" ") + "Z"
  );
}
