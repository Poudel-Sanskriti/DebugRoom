import { useState, type CSSProperties } from "react";
import { Activity, Layers, Sparkles } from "lucide-react";
import type {
  TraceEvent,
  TraceFrame,
  TraceObject,
  TraceValue,
} from "@debugroom/contracts";
import { valueText } from "./ValueView";
import "./execution-stage.css";

const defaultMarkers = new Set([
  "low",
  "high",
  "mid",
  "left",
  "right",
  "i",
  "j",
  "index",
]);
const palette = ["#a5b4fc", "#5eead4", "#fcd68b", "#f9a8d4"];
function integer(value: TraceValue | undefined) {
  if (
    value?.kind !== "scalar" ||
    ["str", "float", "bool"].includes(value.type) ||
    !/^-?\d+$/.test(value.value)
  )
    return undefined;
  const number = Number(value.value);
  return Number.isSafeInteger(number) ? number : undefined;
}

function ArrayStage({
  name,
  object,
  locals,
  objects,
  previous,
  previousObjects,
}: {
  name: string;
  object: TraceObject;
  locals: TraceFrame["locals"];
  objects: Record<string, TraceObject>;
  previous?: TraceObject;
  previousObjects: Record<string, TraceObject>;
}) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const items = object.items!.slice(0, 48);
  const candidates = Object.entries(locals).filter(
    ([, value]) => integer(value) !== undefined,
  );
  const markers = candidates.filter(
    ([key]) => overrides[key] ?? defaultMarkers.has(key),
  );
  const occupied = new Map<number, number>();
  const markerRows = markers.map(([, value]) => {
    const position = Math.max(0, Math.min(items.length - 1, integer(value)!));
    const row = occupied.get(position) ?? 0;
    occupied.set(position, row + 1);
    return row;
  });
  const markerLanes = Math.max(0, ...markerRows.map((row) => row + 1));
  const low = markers.some(([key]) => key === "low")
    ? integer(locals.low)
    : undefined;
  const high = markers.some(([key]) => key === "high")
    ? integer(locals.high)
    : undefined;
  const counts = new Map<string, number>();
  // Equal scalar values share appearance, but each occurrence has its own key.
  const cells = items.map((item, index) => {
    const signature = JSON.stringify(item);
    const occurrence = counts.get(signature) ?? 0;
    counts.set(signature, occurrence + 1);
    return { item, index, key: `${signature}:${occurrence}` };
  });
  const cellWidth = `${100 / Math.max(1, items.length)}%`;
  return (
    <>
      <div className="stage-array-heading">
        <strong>{name}</strong>
        <span>
          {object.length ?? object.items!.length} items
          {object.truncated ? " · captured prefix" : ""}
        </span>
      </div>
      <div
        className="stage-array-scroll"
        tabIndex={0}
        aria-label={`${name} array visualization`}
      >
        <div
          className="stage-array-track"
          style={{
            width: "100%",
            minWidth: items.length * 38,
            height: 74 + markerLanes * 22,
          }}
        >
          {cells.map(({ item, index, key }) => {
            const changed =
              !!previous &&
              valueText(previous.items?.[index], previousObjects) !==
                valueText(item, objects);
            const outside =
              low !== undefined &&
              high !== undefined &&
              (index < low || index > high);
            const marked = markers.some(
              ([, value]) => integer(value) === index,
            );
            return (
              <div
                key={key}
                className={`stage-cell ${changed ? "is-changed" : ""} ${outside ? "is-outside" : ""} ${marked ? "is-marked" : ""}`}
                style={{
                  width: cellWidth,
                  transform: `translateX(${index * 100}%)`,
                }}
                aria-label={`Index ${index}: ${valueText(item, objects)}`}
              >
                <span
                  className="stage-cell-value"
                  title={valueText(item, objects)}
                >
                  {valueText(item, objects)}
                </span>
                <small>{index}</small>
              </div>
            );
          })}
          {!items.length && (
            <p className="stage-waiting">An empty sequence. Watch it grow.</p>
          )}
          {markers.map(([key, value], row) => {
            const position = integer(value)!;
            const inView = position >= 0 && position < items.length;
            return (
              <div
                key={key}
                className={`stage-pointer ${inView ? "" : "is-beyond"}`}
                style={
                  {
                    transform: `translateX(${Math.max(0, Math.min(items.length - 1, position)) * 100}%)`,
                    width: cellWidth,
                    top: 67 + markerRows[row]! * 22,
                    "--pointer-color": palette[row % palette.length],
                  } as CSSProperties
                }
              >
                <span>{inView ? "↑" : position < 0 ? "←" : "→"}</span> {key}
                <b>{position}</b>
              </div>
            );
          })}
        </div>
      </div>
      {object.items!.length > 48 && (
        <p className="stage-note">
          Showing the first 48 captured items. Open Variables for all captured
          values.
        </p>
      )}
      <details className="stage-options">
        <summary>
          Index markers <span>Customize</span>
        </summary>
        {candidates.length > 0 && (
          <div className="stage-marker-picker" aria-label="Index markers">
            <span>Index markers</span>
            {candidates.map(([key]) => (
              <button
                key={key}
                aria-pressed={overrides[key] ?? defaultMarkers.has(key)}
                onClick={() =>
                  setOverrides((current) => ({
                    ...current,
                    [key]: !(current[key] ?? defaultMarkers.has(key)),
                  }))
                }
              >
                {key}
              </button>
            ))}
          </div>
        )}
        <p className="stage-note">
          Markers use the selected variables as indices.
          {low !== undefined && high !== undefined
            ? " Shaded cells fall outside low…high."
            : ""}
        </p>
      </details>
    </>
  );
}

export default function ExecutionStage({
  event,
  frame,
  previous,
  code,
  speed,
  index,
  total,
}: {
  event: TraceEvent;
  frame?: TraceFrame;
  previous?: { frame: TraceFrame; objects: Record<string, TraceObject> };
  code: string;
  speed: number;
  index: number;
  total: number;
}) {
  const [selectedArray, setSelectedArray] = useState("");
  const locals = frame?.locals ?? {};
  const arrays = Object.entries(locals).flatMap(([name, value]) => {
    const object = value.kind === "ref" ? event.objects[value.id] : undefined;
    return object?.items && !["set", "frozenset"].includes(object.type)
      ? [{ name, object }]
      : [];
  });
  const array = arrays.find(({ name }) => name === selectedArray) ?? arrays[0];
  const scalars = Object.entries(locals).filter(
    ([, value]) => value.kind !== "ref",
  );
  const calls = event.frames.filter((call) => call.function !== "<module>");
  const source = code.split("\n")[event.line - 1]?.trim();
  return (
    <section
      className="execution-stage"
      aria-label="Execution visualization"
      style={
        {
          "--stage-duration": `${Math.min(480, speed * 0.7)}ms`,
        } as CSSProperties
      }
    >
      <div className="stage-header">
        <span>
          <Sparkles size={14} /> EXECUTION STUDIO
        </span>
        <span className="stage-counter">
          {String(index + 1).padStart(2, "0")} <span>/ {total}</span>
        </span>
      </div>
      <div className="stage-progress" aria-hidden="true">
        <span style={{ width: `${((index + 1) / total) * 100}%` }} />
      </div>
      <div className="stage-body">
        <div className="stage-caption">
          <Activity size={13} />
          <span>
            {event.kind === "line"
              ? "Next line"
              : event.kind === "return"
                ? event.unwinding
                  ? "Exception unwinding"
                  : "Returning"
                : event.kind === "call"
                  ? "Entering a call"
                  : "Exception observed"}
          </span>
          <code title={source}>{source || `Line ${event.line}`}</code>
        </div>
        {arrays.length > 1 && (
          <label className="stage-array-select">
            Sequence{" "}
            <select
              value={array?.name}
              onChange={(e) => setSelectedArray(e.target.value)}
            >
              {arrays.map(({ name }) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
        )}
        {array ? (
          <ArrayStage
            key={`${frame?.id}:${array.object.id}`}
            name={array.name}
            object={array.object}
            locals={locals}
            objects={event.objects}
            previous={previous?.objects[array.object.id]}
            previousObjects={previous?.objects ?? {}}
          />
        ) : (
          <div className="stage-calls" aria-label="Animated call stack">
            <div className="stage-array-heading">
              <strong>
                <Layers size={15} /> Call journey
              </strong>
              <span>{calls.length} active</span>
            </div>
            {calls.slice(-8).map((call, depth) => (
              <div
                key={call.id}
                className={`stage-call ${call.id === event.frameId ? "is-current" : ""}`}
                style={{ marginLeft: depth * 12 }}
              >
                <span className="stage-call-dot" />
                <strong>{call.function}()</strong>
                <span className="stage-call-args">
                  {Object.entries(call.locals)
                    .filter(([, value]) => value.kind === "scalar")
                    .slice(0, 3)
                    .map(
                      ([name, value]) =>
                        `${name} = ${valueText(value, event.objects)}`,
                    )
                    .join(" · ")}
                </span>
              </div>
            ))}
            {calls.length > 8 && (
              <p className="stage-note">
                Showing the innermost 8 calls. Open Variables for the full
                stack.
              </p>
            )}
            {!calls.length && (
              <p className="stage-waiting">
                {event.kind === "return"
                  ? "This scope has finished."
                  : "Ready at the starting line. Step forward to follow the values."}
              </p>
            )}
          </div>
        )}
        {scalars.length > 0 && (
          <div className="stage-values" aria-label="Captured values">
            {scalars.slice(0, 12).map(([name, value]) => {
              const changed = !!frame?.changes[name];
              const text = valueText(value, event.objects);
              return (
                <div
                  className={`stage-value ${changed ? "is-changed" : ""}`}
                  key={name}
                >
                  <span>
                    {name}
                    {changed && <i />}
                  </span>
                  <strong key={text} title={text}>
                    {text}
                  </strong>
                  {changed && (
                    <small
                      title={valueText(
                        frame?.changes[name]?.before ?? undefined,
                        previous?.objects ?? {},
                      )}
                    >
                      was{" "}
                      {valueText(
                        frame?.changes[name]?.before ?? undefined,
                        previous?.objects ?? {},
                      )}
                    </small>
                  )}
                </div>
              );
            })}
            {scalars.length > 12 && (
              <p className="stage-note">
                {scalars.length - 12} more values in the Variables tab.
              </p>
            )}
          </div>
        )}
        {event.returnValue && (
          <div className="stage-return" key={`${event.frameId}:${index}`}>
            <span>↗ Return value</span>
            <strong>{valueText(event.returnValue, event.objects)}</strong>
          </div>
        )}
      </div>
      <div className="stage-footer">
        <span className="stage-live-dot" /> Captured state{" "}
        <span>Step backward. Nothing is lost.</span>
      </div>
    </section>
  );
}
