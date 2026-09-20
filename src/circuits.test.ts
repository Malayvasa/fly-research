import test from "node:test";
import assert from "node:assert/strict";
import { circuits, findCircuit, outline } from "./circuits/index.ts";
test("five distinct real circuits are selectable with safe default and finite thumbnails", () => {
  assert.equal(circuits.length, 5);
  assert.equal(new Set(circuits.map((c) => c.id)).size, 5);
  assert.equal(findCircuit("unknown").id, "monza");
  for (const c of circuits) {
    assert.equal(findCircuit(c.id), c);
    assert.ok(c.coordinates.length > 60);
    assert.ok(c.length > 4000 && c.length < 7100);
    assert.ok(!/NaN|Infinity/.test(outline(c)));
    assert.ok(outline(c).endsWith("Z"));
  }
  assert.equal(new Set(circuits.map(outline)).size, 5);
});
