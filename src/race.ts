export type Gate = {
  x: number;
  z: number;
  dx: number;
  dz: number;
  halfWidth: number;
};
export type Position = { x: number; z: number };
export type RacerProgress = {
  nextGate: number;
  passed: number;
  lapTimes: number[];
  lapStarted: number;
  finishTime: number | null;
  previous: Position;
};
export function createProgress(position: Position): RacerProgress {
  return {
    nextGate: 1,
    passed: 0,
    lapTimes: [],
    lapStarted: 0,
    finishTime: null,
    previous: { ...position },
  };
}
export function crossesGate(a: Position, b: Position, g: Gate): boolean {
  const before = (a.x - g.x) * g.dx + (a.z - g.z) * g.dz;
  const after = (b.x - g.x) * g.dx + (b.z - g.z) * g.dz;
  if (before >= 0 || after < 0) return false;
  const f = -before / (after - before),
    x = a.x + (b.x - a.x) * f - g.x,
    z = a.z + (b.z - a.z) * f - g.z;
  return Math.abs(x * g.dz - z * g.dx) <= g.halfWidth;
}
export function advanceProgress(
  p: RacerProgress,
  position: Position,
  gates: Gate[],
  time: number,
  laps = 3,
): boolean {
  let lap = false;
  if (
    p.finishTime === null &&
    crossesGate(p.previous, position, gates[p.nextGate])
  ) {
    p.passed++;
    if (p.nextGate === 0) {
      p.lapTimes.push(time - p.lapStarted);
      p.lapStarted = time;
      lap = true;
      if (p.lapTimes.length === laps) p.finishTime = time;
    }
    p.nextGate = (p.nextGate + 1) % gates.length;
  }
  p.previous = { x: position.x, z: position.z };
  return lap;
}
export function resetProgressPosition(p: RacerProgress, position: Position) {
  p.previous = { ...position };
}
export function formatTime(seconds: number | null): string {
  if (seconds === null) return "—";
  const ms = Math.floor(Math.max(0, seconds) * 1000);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
