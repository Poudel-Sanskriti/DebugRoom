import { useId, useState } from "react";
import type { TraceObject, TraceValue } from "@debugroom/contracts";
import { valueText } from "./ValueView";

type Edge = { from: string; to: string; label: string };
export function objectRelationships(
  root: string,
  objects: Record<string, TraceObject>,
) {
  const nodes: { id: string; depth: number; label: string; type: string }[] =
      [],
    edges: Edge[] = [],
    seen = new Set<string>(),
    queue = [{ id: root, depth: 0 }];
  while (queue.length && nodes.length < 24) {
    const current = queue.shift()!;
    if (seen.has(current.id)) continue;
    const object = objects[current.id];
    if (!object) continue;
    seen.add(current.id);
    const label =
      object.attributes?.value ??
      object.attributes?.val ??
      object.attributes?.data;
    nodes.push({
      ...current,
      label: label ? valueText(label, objects).slice(0, 18) : object.type,
      type: object.type,
    });
    const children: [string, TraceValue][] = [
      ...Object.entries(object.attributes ?? {}),
      ...(object.items ?? []).map(
        (value, index) => [String(index), value] as [string, TraceValue],
      ),
      ...(object.entries ?? []).map(
        (entry) =>
          [valueText(entry.key, objects), entry.value] as [string, TraceValue],
      ),
    ];
    for (const [name, value] of children) {
      if (value.kind === "ref") {
        edges.push({
          from: current.id,
          to: value.id,
          label: name.slice(0, 14),
        });
        if (!seen.has(value.id))
          queue.push({ id: value.id, depth: current.depth + 1 });
      }
    }
  }
  return {
    nodes,
    edges: edges.filter((edge) => seen.has(edge.to)),
    truncated: queue.some((item) => !seen.has(item.id) && !!objects[item.id]),
  };
}
export default function ObjectGraph({
  locals,
  objects,
}: {
  locals: Record<string, TraceValue>;
  objects: Record<string, TraceObject>;
}) {
  const [selected, setSelected] = useState("");
  const marker = useId().replaceAll(":", "");
  const candidates = Object.entries(locals).filter(
    ([, value]) =>
      value.kind === "ref" &&
      objectRelationships(value.id, objects).edges.length > 0,
  );
  if (!candidates.length) return null;
  const chosen =
    candidates.find(([name]) => name === selected) ?? candidates[0]!;
  const value = chosen[1];
  if (value.kind !== "ref") return null;
  const graph = objectRelationships(value.id, objects),
    levels = new Map<number, typeof graph.nodes>();
  for (const node of graph.nodes) {
    const level = levels.get(node.depth) ?? [];
    level.push(node);
    levels.set(node.depth, level);
  }
  const height = Math.max(
      150,
      ...[...levels.values()].map((nodes) => nodes.length * 82 + 30),
    ),
    width = Math.max(250, levels.size * 160);
  const positions = new Map<string, { x: number; y: number }>();
  for (const [depth, nodes] of levels)
    nodes.forEach((node, index) =>
      positions.set(node.id, {
        x: 55 + depth * 160,
        y: ((index + 1) * height) / (nodes.length + 1),
      }),
    );
  return (
    <details className="object-graph">
      <summary>
        Object relationships <span>{graph.nodes.length} objects</span>
      </summary>
      <div className="graph-heading">
        <label>
          Root{" "}
          <select
            aria-label="Object graph root"
            value={chosen[0]}
            onChange={(event) => setSelected(event.target.value)}
          >
            {candidates.map(([name]) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <span>Arrows follow captured references</span>
      </div>
      <div className="graph-scroll">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Object references reachable from ${chosen[0]}`}
          style={{ minWidth: width, width, height }}
        >
          <defs>
            <marker
              id={marker}
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path d="M0 0 L7 3.5 L0 7" fill="#9cb3d5" />
            </marker>
          </defs>
          {graph.edges.map((edge, index) => {
            const from = positions.get(edge.from)!,
              to = positions.get(edge.to)!;
            const self = edge.from === edge.to;
            const d = self
              ? `M${from.x + 18} ${from.y - 10} C${from.x + 68} ${from.y - 70},${from.x - 60} ${from.y - 70},${from.x - 20} ${from.y - 10}`
              : `M${from.x + 23} ${from.y} C${from.x + 80} ${from.y},${to.x - 80} ${to.y},${to.x - 25} ${to.y}`;
            return (
              <g key={index}>
                <path
                  d={d}
                  fill="none"
                  stroke="#b8c8df"
                  strokeWidth="1.5"
                  markerEnd={`url(#${marker})`}
                />
                <text
                  x={self ? from.x : (from.x + to.x) / 2}
                  y={self ? from.y - 48 : (from.y + to.y) / 2 - 7}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#9aadca"
                >
                  {edge.label}
                </text>
              </g>
            );
          })}
          {graph.nodes.map((node) => {
            const point = positions.get(node.id)!;
            return (
              <g key={node.id}>
                <rect
                  x={point.x - 26}
                  y={point.y - 21}
                  width="52"
                  height="42"
                  rx="8"
                  fill="#edf4ff"
                  stroke="#c9d9ef"
                />
                <text
                  x={point.x}
                  y={point.y + 4}
                  textAnchor="middle"
                  fontSize="12"
                  fill="#5e80af"
                >
                  {node.label.length > 7
                    ? node.label.slice(0, 6) + "…"
                    : node.label}
                </text>
                <text
                  x={point.x}
                  y={point.y + 37}
                  textAnchor="middle"
                  fontSize="8"
                  fill="#a1b2ca"
                >
                  {node.id.slice(0, 16)}
                </text>
                <title>
                  {node.type} · {node.id} · {node.label}
                </title>
              </g>
            );
          })}
        </svg>
      </div>
      {graph.truncated && (
        <p className="small-note">Showing the first 24 reachable objects.</p>
      )}
    </details>
  );
}
