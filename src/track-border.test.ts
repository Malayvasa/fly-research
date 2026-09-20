import test from "node:test";
import assert from "node:assert/strict";
import { trackBorder } from "./track.ts";
test("border closes exactly and uses unique joined spans with two material batches", () => {
  const g = trackBorder(8.6, 0.95, 0.035, 0.155, 880, 2);
  const p = g.getAttribute("position");
  for (let i = 0; i < 4; i++)
    for (let axis = 0; axis < 3; axis++)
      assert.equal(p.array[i * 3 + axis], p.array[880 * 12 + i * 3 + axis]);
  assert.equal(g.index!.count, 880 * 18);
  assert.equal(g.groups.length, 2);
  const seen = new Set<string>();
  for (let i = 0; i < g.index!.count; i += 3) {
    const tri = [g.index!.getX(i), g.index!.getX(i + 1), g.index!.getX(i + 2)]
      .sort((a, b) => a - b)
      .join(",");
    assert.ok(!seen.has(tri));
    seen.add(tri);
  }
});
