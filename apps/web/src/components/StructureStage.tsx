import { useId, useState } from "react";
import type {
  TraceEvent,
  TraceFrame,
  TraceObject,
  TraceValue,
} from "@debugroom/contracts";
import { valueText } from "./ValueView";
import "./structure-stage.css";

type Objects = Record<string, TraceObject>;
const linkNames = ["next", "left", "right"];
const isNode = (object?: TraceObject) =>
  !!object?.attributes && linkNames.some((name) => name in object.attributes!);
const isCollection = (name: string, object?: TraceObject) =>
  !!object &&
  (!!object.entries ||
    (!!object.items &&
      (["set", "frozenset"].includes(object.type) || name === "stack")));
export function hasStructureView(
  frame: TraceFrame | undefined,
  objects: Objects,
): boolean {
  return Object.entries(frame?.locals ?? {}).some(
    ([name, value]) =>
      value.kind === "ref" &&
      (isNode(objects[value.id]) || isCollection(name, objects[value.id])),
  );
}

function rootsFor(frame: TraceFrame | undefined, objects: Objects) {
  return Object.entries(frame?.locals ?? {}).flatMap(([name, value]) =>
    value.kind === "ref" && isNode(objects[value.id])
      ? [{ name, id: value.id }]
      : [],
  );
}

function NodeGraph({
  frame,
  objects,
  previous,
}: {
  frame?: TraceFrame;
  objects: Objects;
  previous?: { frame: TraceFrame; objects: Objects };
}) {
  const arrowId = useId().replace(/:/g, "");
  const [selectedRoot, setSelectedRoot] = useState("");
  const roots = rootsFor(frame, objects);
  const chosen = roots.find((root) => root.name === selectedRoot);
  const orderedRoots = chosen ? [chosen] : roots;
  const nodes: { id: string; depth: number }[] = [];
  const seen = new Set<string>();
  let omitted = false;
  function visit(id: string, depth: number) {
    if (seen.has(id) || !isNode(objects[id])) return;
    if (nodes.length >= 24) {
      omitted = true;
      return;
    }
    seen.add(id);
    nodes.push({ id, depth });
    for (const name of linkNames) {
      const value = objects[id]!.attributes?.[name];
      if (value?.kind === "ref") visit(value.id, depth + 1);
    }
  }
  orderedRoots.forEach(({ id }) => visit(id, 0));
  const tree = nodes.some(({ id }) =>
    ["left", "right"].some((name) => name in objects[id]!.attributes!),
  );
  const columns = new Map<number, number>();
  const positions = new Map(
    nodes.map(({ id, depth }, index) => {
      const row = columns.get(depth) ?? 0;
      columns.set(depth, row + 1);
      return [
        id,
        {
          x: 65 + (tree ? depth : index) * 138,
          y: 62 + (tree ? row : 0) * 112,
        },
      ];
    }),
  );
  const width = Math.max(
    260,
    ...[...positions.values()].map(({ x }) => x + 75),
  );
  const height = Math.max(
    tree ? 210 : 154,
    ...[...positions.values()].map(({ y }) => y + 78),
  );
  const renderedHeight = Math.min(height, 280);
  const nodeLabels = (id: string) =>
    roots.filter((root) => root.id === id).map((root) => root.name);
  return (
    <div className="structure-graph">
      <div className="structure-heading">
        <strong>{tree ? "Tree references" : "Linked nodes"}</strong>
        <label>
          Root{" "}
          <select
            aria-label="Structure root"
            value={chosen?.name ?? ""}
            onChange={(event) => setSelectedRoot(event.target.value)}
          >
            <option value="">All local roots</option>
            {roots.map(({ name }) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="structure-graph-scroll"
        tabIndex={0}
        aria-label="Captured node graph"
      >
        <svg
          role="img"
          aria-label={`${nodes.length} captured nodes and their references`}
          viewBox={`0 0 ${width} ${height}`}
          style={{
            height: renderedHeight,
            minWidth:
              nodes.length > 8 ? (width * renderedHeight) / height : undefined,
          }}
        >
          <defs>
            <marker
              id={arrowId}
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path d="M0 0 L7 3.5 L0 7" fill="currentColor" />
            </marker>
          </defs>
          {nodes.flatMap(({ id }) =>
            linkNames.flatMap((name) => {
              const value = objects[id]!.attributes?.[name];
              if (value?.kind !== "ref") return [];
              const start = positions.get(id)!,
                end = positions.get(value.id);
              if (!end) return [];
              const old = previous?.objects[id]?.attributes?.[name];
              const changed =
                !!previous && JSON.stringify(old) !== JSON.stringify(value);
              const backwards = end.x <= start.x;
              const sx = start.x + 30,
                ex = end.x - 33;
              const path = backwards
                ? `M ${start.x} ${start.y + 25} C ${start.x + 45} ${start.y + 73}, ${end.x - 45} ${end.y + 73}, ${end.x} ${end.y + 28}`
                : `M ${sx} ${start.y} C ${(sx + ex) / 2} ${start.y}, ${(sx + ex) / 2} ${end.y}, ${ex} ${end.y}`;
              return (
                <g
                  key={`${id}:${name}`}
                  className={`structure-edge ${changed ? "is-changed" : ""}`}
                  aria-label={`${id}.${name} → ${value.id}`}
                >
                  <path d={path} markerEnd={`url(#${arrowId})`} />
                  <text
                    x={(start.x + end.x) / 2}
                    y={
                      backwards
                        ? Math.max(start.y, end.y) + 65
                        : (start.y + end.y) / 2 - 9
                    }
                  >
                    {name}
                  </text>
                </g>
              );
            }),
          )}
          {nodes.map(({ id }) => {
            const object = objects[id]!,
              position = positions.get(id)!;
            const badges = nodeLabels(id);
            const oldBadges = rootsFor(previous?.frame, previous?.objects ?? {})
              .filter((root) => root.id === id)
              .map((root) => root.name);
            const changed =
              !!previous &&
              (JSON.stringify(object.attributes) !==
                JSON.stringify(previous.objects[id]?.attributes) ||
                JSON.stringify(badges) !== JSON.stringify(oldBadges));
            const value =
              object.attributes?.val ??
              object.attributes?.value ??
              object.attributes?.data;
            const terminal = linkNames
              .flatMap((name) => {
                const item = object.attributes?.[name];
                if (!item) return [];
                if (item.kind === "ref")
                  return positions.has(item.id)
                    ? []
                    : [`${name} → ${item.id} (outside view)`];
                return [`${name} → ${valueText(item, objects)}`];
              })
              .join(" · ");
            return (
              <g
                key={id}
                className={`structure-node ${changed ? "is-changed" : ""}`}
                style={{
                  transform: `translate(${position.x}px, ${position.y}px)`,
                }}
                aria-label={`Node ${id}: ${value ? valueText(value, objects) : object.type}`}
              >
                <title>{`${object.type} ${id}${badges.length ? ` · ${badges.join(", ")}` : ""}${terminal ? ` · ${terminal}` : ""}`}</title>
                {badges.length > 0 && (
                  <text className="structure-node-badges" y="-36">
                    {badges.join(" · ").slice(0, 26)}
                    {badges.join(" · ").length > 26 ? "…" : ""}
                  </text>
                )}
                <rect x="-29" y="-25" width="58" height="50" rx="15" />
                <text className="structure-node-value" y="5">
                  {(value ? valueText(value, objects) : object.type).slice(
                    0,
                    8,
                  )}
                </text>
                <text className="structure-node-id" y="40">
                  {id.length > 13 ? `${id.slice(0, 10)}…` : id}
                </text>
                {terminal && (
                  <text className="structure-node-null" y="55">
                    {terminal.length > 25
                      ? `${terminal.slice(0, 23)}…`
                      : terminal}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="structure-note">
        Arrows are captured object fields. Labels show local references.
        {chosen
          ? ` Viewing nodes reachable from ${chosen.name}.`
          : " Includes every local root."}
        {omitted
          ? " Showing at most 24 nodes; open Variables for other captured references."
          : ""}
        {nodes.some(({ id }) => objects[id]!.truncated)
          ? " Some object fields were truncated during capture."
          : ""}
      </p>
    </div>
  );
}

function Collection({
  name,
  object,
  objects,
  before,
  beforeObjects,
}: {
  name: string;
  object: TraceObject;
  objects: Objects;
  before?: TraceObject;
  beforeObjects: Objects;
}) {
  const map = !!object.entries;
  const stack =
    name === "stack" && !map && !["set", "frozenset"].includes(object.type);
  const rows = map
    ? object.entries!.map((entry) => ({
        key: JSON.stringify(entry.key),
        label: valueText(entry.key, objects),
        value: entry.value,
      }))
    : (object.items ?? []).map((value, index) => ({
        key: stack ? String(index) : JSON.stringify(value),
        label: stack ? String(index) : "",
        value,
      }));
  const previousRows = new Map(
    map
      ? (before?.entries ?? []).map((entry) => [
          JSON.stringify(entry.key),
          entry.value,
        ])
      : (before?.items ?? []).map((value, index) => [
          stack ? String(index) : JSON.stringify(value),
          value,
        ]),
  );
  const removed = [...previousRows.keys()].filter(
    (key) => !rows.some((row) => row.key === key),
  ).length;
  const visible = stack ? rows.slice(-6) : rows.slice(0, 12);
  return (
    <div className="structure-collection">
      <div className="structure-heading">
        <strong>
          {name}
          <span>{map ? "hash map" : stack ? "stack" : object.type}</span>
        </strong>
        <small>
          {object.length ?? rows.length} {map ? "entries" : "items"}
        </small>
      </div>
      <div
        className={`structure-cards ${stack ? "is-stack" : ""}`}
        aria-label={`${name} captured ${map ? "entries" : "items"}`}
      >
        {visible.map(({ key, label, value }) => {
          const changed =
            !!before &&
            (!previousRows.has(key) ||
              JSON.stringify(previousRows.get(key)) !== JSON.stringify(value) ||
              valueText(previousRows.get(key), beforeObjects) !==
                valueText(value, objects));
          return (
            <div
              key={key}
              className={`structure-card ${changed ? "is-changed" : ""}`}
              aria-label={`${map ? `${label} → ` : stack ? `Index ${label}: ` : ""}${valueText(value, objects)}`}
            >
              {(map || stack) && (
                <span className="structure-card-key" title={label}>
                  {stack ? `[${label}]` : label}
                </span>
              )}
              {map && <span className="structure-card-arrow">→</span>}
              <strong title={valueText(value, objects)}>
                {valueText(value, objects)}
              </strong>
              {changed && (
                <span
                  className="structure-change-dot"
                  title={
                    previousRows.has(key)
                      ? "Changed since previous step"
                      : "Added since previous step"
                  }
                />
              )}
            </div>
          );
        })}
      </div>
      {!rows.length && (
        <p className="structure-empty">
          Empty {map ? "map" : stack ? "stack" : "set"}. Its next captured
          update will appear here.
        </p>
      )}
      <p className="structure-note">
        {stack
          ? "Captured list order; indices match Variables."
          : "Captured values; highlighted entries changed since the previous step."}
        {removed
          ? ` ${removed} ${removed === 1 ? "entry removed" : "entries removed"}.`
          : ""}
        {object.truncated || rows.length > visible.length
          ? ` Showing ${stack ? "the last" : "the first"} ${visible.length} captured ${map ? "entries" : "items"}; open Variables for more.`
          : ""}
      </p>
    </div>
  );
}

export default function StructureStage({
  event,
  frame,
  previous,
}: {
  event: TraceEvent;
  frame?: TraceFrame;
  previous?: { frame: TraceFrame; objects: Objects };
}) {
  const [selected, setSelected] = useState("");
  const collections = Object.entries(frame?.locals ?? {}).flatMap(
    ([name, value]) =>
      value.kind === "ref" && isCollection(name, event.objects[value.id])
        ? [{ name, object: event.objects[value.id]! }]
        : [],
  );
  const roots = rootsFor(frame, event.objects);
  const choices = [
    ...(roots.length ? [{ id: "graph", label: "Nodes & links" }] : []),
    ...collections.map(({ name }) => ({
      id: `collection:${name}`,
      label: name,
    })),
  ];
  const active = choices.find((choice) => choice.id === selected) ?? choices[0];
  const collection = collections.find(
    ({ name }) => `collection:${name}` === active?.id,
  );
  if (!active)
    return (
      <p className="structure-note">No captured structure in this frame.</p>
    );
  return (
    <div className="structure-stage">
      {choices.length > 1 && (
        <div className="structure-picker" aria-label="Captured structures">
          {choices.map(({ id, label }) => (
            <button
              key={id}
              aria-pressed={id === active.id}
              onClick={() => setSelected(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {active.id === "graph" ? (
        <NodeGraph frame={frame} objects={event.objects} previous={previous} />
      ) : (
        collection && (
          <Collection
            key={collection.name}
            {...collection}
            objects={event.objects}
            before={previous?.objects[collection.object.id]}
            beforeObjects={previous?.objects ?? {}}
          />
        )
      )}
    </div>
  );
}
