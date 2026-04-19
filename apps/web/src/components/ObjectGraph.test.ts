import { expect, it } from "vitest";
import { objectRelationships } from "./ObjectGraph";
import type { TraceObject } from "@debugroom/contracts";
it("keeps aliases and cycles as references instead of duplicating objects", () => {
  const objects: Record<string, TraceObject> = {
    a: {
      id: "a",
      type: "Node",
      truncated: false,
      attributes: {
        next: { kind: "ref", id: "b" },
        also: { kind: "ref", id: "b" },
      },
    },
    b: {
      id: "b",
      type: "Node",
      truncated: false,
      attributes: { next: { kind: "ref", id: "a" } },
    },
  };
  const graph = objectRelationships("a", objects);
  expect(graph.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  expect(graph.edges).toHaveLength(3);
  expect(graph.truncated).toBe(false);
});
it("bounds graph traversal without altering captured data", () => {
  const objects: Record<string, TraceObject> = {};
  for (let i = 0; i < 40; i++)
    objects[String(i)] = {
      id: String(i),
      type: "Node",
      truncated: false,
      attributes: { next: { kind: "ref", id: String(i + 1) } },
    };
  const graph = objectRelationships("0", objects);
  expect(graph.nodes).toHaveLength(24);
  expect(graph.truncated).toBe(true);
  expect(Object.keys(objects)).toHaveLength(40);
});
