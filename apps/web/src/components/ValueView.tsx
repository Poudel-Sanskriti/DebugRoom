import type { TraceObject, TraceValue } from "@debugroom/contracts";

export function valueText(
  value: TraceValue | undefined,
  objects: Record<string, TraceObject>,
  seen = new Set<string>(),
): string {
  if (!value) return "—";
  if (value.kind === "scalar")
    return value.type === "str"
      ? JSON.stringify(value.value) + (value.truncated ? "…" : "")
      : value.value + (value.truncated ? "…" : "");
  if (value.kind === "unavailable") return `<${value.type}: ${value.reason}>`;
  if (seen.has(value.id)) return `↩ ${value.id}`;
  const node = objects[value.id];
  if (!node) return `↗ ${value.id}`;
  seen.add(value.id);
  if (node.items)
    return `${node.type === "tuple" ? "(" : node.type === "set" ? "{" : "["}${node.items
      .slice(0, 12)
      .map((x) => valueText(x, objects, new Set(seen)))
      .join(
        ", ",
      )}${node.truncated || node.items.length > 12 ? ", …" : ""}${node.type === "tuple" ? ")" : node.type === "set" ? "}" : "]"}`;
  if (node.entries)
    return `{${node.entries
      .slice(0, 6)
      .map(
        (x) =>
          `${valueText(x.key, objects, new Set(seen))}: ${valueText(x.value, objects, new Set(seen))}`,
      )
      .join(", ")}${node.truncated || node.entries.length > 6 ? ", …" : ""}}`;
  return `${node.type} ${value.id}`;
}
export function valueType(
  value: TraceValue,
  objects: Record<string, TraceObject>,
) {
  return value.kind === "ref"
    ? (objects[value.id]?.type ?? "object")
    : value.type;
}
export default function ValueView({
  value,
  objects,
  depth = 0,
  seen = [],
}: {
  value: TraceValue;
  objects: Record<string, TraceObject>;
  depth?: number;
  seen?: string[];
}) {
  if (value.kind !== "ref")
    return (
      <span
        className={`value value-${value.kind}`}
        title={value.kind === "unavailable" ? value.reason : undefined}
      >
        {valueText(value, objects)}
      </span>
    );
  const node = objects[value.id];
  if (!node || seen.includes(value.id) || depth >= 4)
    return (
      <span className="value-ref">
        {seen.includes(value.id) ? "↩" : "↗"} {value.id}
        {depth >= 4 ? " · depth limit" : ""}
      </span>
    );
  const nextSeen = [...seen, value.id];
  return (
    <details
      className="object-value"
      open={depth === 0 && !!node.items && node.items.length <= 12}
    >
      <summary>
        <span>{valueText(value, objects).slice(0, 110)}</span>
        <small>{value.id}</small>
        {node.truncated && <em>truncated</em>}
      </summary>
      {node.items ? (
        <div className="array-values">
          {node.items.map((item, index) => (
            <div className="array-cell" key={index}>
              <ValueView
                value={item}
                objects={objects}
                depth={depth + 1}
                seen={nextSeen}
              />
              <small>{index}</small>
            </div>
          ))}
        </div>
      ) : node.entries ? (
        <div className="object-fields">
          {node.entries.map((entry, index) => (
            <div key={index}>
              <ValueView
                value={entry.key}
                objects={objects}
                depth={depth + 1}
                seen={nextSeen}
              />
              <span>:</span>
              <ValueView
                value={entry.value}
                objects={objects}
                depth={depth + 1}
                seen={nextSeen}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="object-fields">
          {Object.entries(node.attributes ?? {}).map(([key, item]) => (
            <div key={key}>
              <code>{key}</code>
              <span>:</span>
              <ValueView
                value={item}
                objects={objects}
                depth={depth + 1}
                seen={nextSeen}
              />
            </div>
          ))}
        </div>
      )}
      {node.truncated && (
        <p className="truncation">Only the captured prefix is shown.</p>
      )}
    </details>
  );
}
