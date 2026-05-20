import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Pause,
  Play,
  RotateCcw,
  Pin,
  PinOff,
  Layers,
  Terminal,
  Clock,
  AlertCircle,
  CheckCircle2,
  Braces,
} from "lucide-react";
import type { Run, TraceFrame, TraceValue } from "@debugroom/contracts";
import ObjectGraph from "./ObjectGraph";
import ValueView, { valueText, valueType } from "./ValueView";
import ExecutionStage from "./ExecutionStage";

const outcomeNames: Record<string, string> = {
  completed: "Completed",
  syntax_error: "Syntax error",
  runtime_error: "Runtime error",
  input_error: "Input error",
  compile_error: "Compiler error",
  compile_timeout: "Compilation time limit reached",
  timeout: "Time limit reached",
  trace_limit: "Trace limit reached",
  output_limit: "Output limit reached",
  trace_size_limit: "Trace size limit reached",
  memory_limit: "Memory limit reached",
  stopped: "Stopped",
  infrastructure_error: "Execution unavailable",
};
export function outcomeName(outcome: string | null | undefined) {
  return outcome ? (outcomeNames[outcome] ?? outcome) : "Pending";
}
type PinEntry = { frameId: string; name: string; function: string };

export default function TraceInspector({
  run,
  index,
  onIndex,
  onViewSource,
  autoPlayRunId,
}: {
  run: Run | null;
  index: number;
  onIndex: (index: number) => void;
  onViewSource: (line?: number) => void;
  autoPlayRunId?: string;
}) {
  const autoPlayed = useRef<string | undefined>(undefined);
  const [playing, setPlaying] = useState(false),
    [view, setView] = useState<"visual" | "variables" | "output">("visual"),
    [speed, setSpeed] = useState(700),
    [pins, setPins] = useState<PinEntry[]>([]),
    [selectedFrame, setSelectedFrame] = useState<string | null>(null),
    [tick, setTick] = useState(Date.now());
  const steps = run?.result?.steps ?? [],
    event = steps[index],
    objects = event?.objects ?? {};
  const frame =
    event?.frames.find((f) => f.id === selectedFrame) ??
    event?.frames.find((f) => f.id === event.frameId) ??
    event?.frames.at(-1);
  const active = run?.status === "running" || run?.status === "queued";
  useEffect(() => {
    setPlaying(false);
    setPins([]);
    setSelectedFrame(null);
  }, [run?.id]);
  useEffect(() => {
    if (
      run &&
      run.id === autoPlayRunId &&
      steps.length > 1 &&
      autoPlayed.current !== run.id
    ) {
      autoPlayed.current = run.id;
      setView("visual");
      onIndex(0);
      setPlaying(true);
    }
  }, [run?.id, autoPlayRunId, steps.length, onIndex]);
  useEffect(() => {
    if (!playing) return;
    if (index >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => onIndex(index + 1), speed);
    return () => clearTimeout(timer);
  }, [playing, index, steps.length, speed, onIndex]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  const seconds = run?.startedAt
    ? Math.max(0, (tick - Date.parse(run.startedAt)) / 1000)
    : 0;
  const previousFrame = useMemo(() => {
    if (!frame) return undefined;
    for (let i = index - 1; i >= 0; i--) {
      const previous = steps[i]?.frames.find((f) => f.id === frame.id);
      if (previous) return { frame: previous, objects: steps[i]!.objects };
    }
    return undefined;
  }, [index, frame?.id, run?.result]);
  function jump(next: number) {
    setPlaying(false);
    onIndex(Math.max(0, Math.min(steps.length - 1, next)));
  }
  function togglePin(frame: TraceFrame, name: string) {
    setPins((previous) =>
      previous.some((pin) => pin.frameId === frame.id && pin.name === name)
        ? previous.filter(
            (pin) => pin.frameId !== frame.id || pin.name !== name,
          )
        : [...previous, { frameId: frame.id, name, function: frame.function }],
    );
  }
  function beforeText(name: string) {
    const before = frame?.changes[name]?.before;
    if (!before) return "not defined";
    return valueText(before, previousFrame?.objects ?? {}).slice(0, 100);
  }
  return (
    <section className="inspector" aria-label="Execution inspector">
      <div className="inspector-heading">
        <h2>
          <Layers size={17} /> Execution
        </h2>
        {run && (
          <span
            className={`outcome-badge ${run.outcome === "completed" ? "success" : run.outcome ? "warning" : "pending"}`}
          >
            {run.status === "queued"
              ? "Queued"
              : run.status === "running"
                ? "Running"
                : outcomeName(run.outcome)}
          </span>
        )}
      </div>
      <div
        className="inspector-tabs"
        role="tablist"
        aria-label="Execution views"
      >
        {(
          [
            ["visual", "Visualize"],
            ["variables", "Variables"],
            ["output", "Output"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            id={`execution-tab-${id}`}
            aria-controls={`execution-panel-${id}`}
            aria-selected={view === id}
            tabIndex={view === id ? 0 : -1}
            onClick={() => setView(id)}
            onKeyDown={(e) => {
              const tabs = ["visual", "variables", "output"] as const;
              const offset =
                e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (offset) {
                e.preventDefault();
                const next = tabs[(tabs.indexOf(view) + offset + 3) % 3]!;
                setView(next);
                document.getElementById(`execution-tab-${next}`)?.focus();
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {!run ? (
        <div className="inspector-empty">
          <div className="empty-orbit">
            <Braces size={32} />
          </div>
          <h3>See what happens between the lines.</h3>
          <p>
            Write a program or load an example, then run it to explore the
            captured execution.
          </p>
          <div className="empty-hint">
            <span>01</span> Write or load code <span>02</span> Run{" "}
            <span>03</span> Explore
          </div>
        </div>
      ) : (
        <>
          <div className="run-context">
            <span>
              Run {run.id.slice(0, 8)} · revision{" "}
              {run.snapshot?.revision ?? "—"}
            </span>
            <button className="text-button" onClick={() => onViewSource()}>
              View run source ↗
            </button>
          </div>
          {active && (
            <div
              className={`execution-progress ${seconds >= 5 ? "slow-run" : ""}`}
              role="status"
            >
              <span className="spinner" />
              <div>
                <strong>
                  {run.status === "queued"
                    ? "Waiting for an execution slot"
                    : !run.startedAt
                      ? run.snapshot?.language === "cpp"
                        ? "Compiling C++…"
                        : "Starting the runtime…"
                      : `Running · ${seconds.toFixed(1)}s`}
                </strong>
                <p>
                  {seconds >= 5
                    ? "This run is taking more than five seconds. It will stop at 60 seconds."
                    : "The result will appear here when execution finishes."}
                </p>
              </div>
            </div>
          )}
          {run.status === "finished" && run.outcome !== "completed" && (
            <div className="execution-error" role="alert">
              <AlertCircle size={17} />
              <div>
                <strong>
                  {run.result?.error
                    ? `${run.result.error.type}: ${run.result.error.message}`
                    : outcomeName(run.outcome)}
                </strong>
                {run.result?.error?.line && (
                  <button
                    onClick={() =>
                      onViewSource(run.result?.error?.line ?? undefined)
                    }
                    className="text-button"
                  >
                    At source line {run.result.error.line}
                  </button>
                )}
                <p>
                  {steps.length
                    ? `${steps.length.toLocaleString()} captured steps remain available.`
                    : "No execution steps were captured."}
                </p>
              </div>
            </div>
          )}
          {event && (
            <>
              <div
                role="tabpanel"
                id="execution-panel-visual"
                aria-labelledby="execution-tab-visual"
                hidden={view !== "visual"}
              >
                <ExecutionStage
                  key={run.id}
                  event={event}
                  frame={frame}
                  previous={previousFrame}
                  code={run.snapshot?.code ?? ""}
                  speed={speed}
                  index={index}
                  total={steps.length}
                />
              </div>
              <div
                role="tabpanel"
                id="execution-panel-variables"
                aria-labelledby="execution-tab-variables"
                hidden={view !== "variables"}
              >
                <div className="line-card">
                  <span className="line-symbol">↳</span>
                  <div>
                    <span className="muted-label">
                      {event.kind === "line"
                        ? "ABOUT TO EXECUTE"
                        : event.kind === "return"
                          ? event.unwinding
                            ? "UNWINDING AFTER EXCEPTION"
                            : "RETURNING FROM"
                          : event.kind === "call"
                            ? "ENTERING FUNCTION"
                            : "EXCEPTION OBSERVED"}
                    </span>
                    <strong data-testid="current-line">
                      Line {event.line}{" "}
                      <span>
                        in{" "}
                        {
                          event.frames.find(
                            (candidate) => candidate.id === event.frameId,
                          )?.function
                        }
                        ()
                      </span>
                    </strong>
                  </div>
                  <span className="line-event">{event.kind}</span>
                </div>
                <details className="stack-panel" open={event.frames.length > 1}>
                  <summary>
                    <Layers size={14} /> Call stack{" "}
                    <span>
                      {event.frames.length}{" "}
                      {event.frames.length === 1 ? "frame" : "frames"}
                    </span>
                  </summary>
                  <div className="stack-list">
                    {[...event.frames].reverse().map((f) => (
                      <button
                        className={f.id === frame?.id ? "selected" : ""}
                        key={f.id}
                        onClick={() => setSelectedFrame(f.id)}
                      >
                        <span>{f.function}()</span>
                        <small>
                          {f.id} · line {f.line}
                        </small>
                        {f.id === event.frameId && <i>active</i>}
                      </button>
                    ))}
                  </div>
                </details>
                {event.globals && Object.keys(event.globals).length > 0 && (
                  <details className="global-scope">
                    <summary>
                      Global scope{" "}
                      <span>
                        {Object.keys(event.globals).length} names
                        {event.globalsTruncated ? " · truncated" : ""}
                      </span>
                    </summary>
                    <div>
                      {Object.entries(event.globals).map(([name, value]) => (
                        <div key={name}>
                          <code>{name}</code>
                          <ValueView value={value} objects={objects} />
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {pins.length > 0 && (
                  <div className="pinned-panel">
                    <h3>
                      <Pin size={13} /> Pinned variables
                    </h3>
                    {pins.map((pin) => {
                      const sourceFrame = event.frames.find(
                          (f) => f.id === pin.frameId,
                        ),
                        value = sourceFrame?.locals[pin.name];
                      return (
                        <div
                          className="pinned-variable"
                          key={pin.frameId + pin.name}
                        >
                          <code>
                            {pin.function} · {pin.frameId}.{pin.name}
                          </code>
                          {value ? (
                            <ValueView value={value} objects={objects} />
                          ) : (
                            <span className="out-of-scope">out of scope</span>
                          )}
                          <button
                            className="icon-button"
                            title={`Unpin ${pin.name}`}
                            aria-label={`Unpin ${pin.name}`}
                            onClick={() =>
                              setPins((previous) =>
                                previous.filter((p) => p !== pin),
                              )
                            }
                          >
                            <PinOff size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {frame && (
                  <ObjectGraph locals={frame.locals} objects={objects} />
                )}
                <div className="variables-heading">
                  <h3>Local variables</h3>
                  <span>
                    {Object.keys(frame?.locals ?? {}).length} visible
                    {frame?.truncated ? " · truncated" : ""}
                  </span>
                </div>
                <div className="variable-table">
                  <div className="table-header">
                    <span>NAME</span>
                    <span>VALUE</span>
                    <span>TYPE</span>
                    <span />
                  </div>
                  {Object.entries(frame?.locals ?? {}).map(([name, value]) => {
                    const change = frame?.changes[name],
                      pinned = pins.some(
                        (p) => p.frameId === frame!.id && p.name === name,
                      );
                    return (
                      <div
                        className={`variable-row ${change ? "changed" : ""}`}
                        key={name}
                      >
                        <code>{name}</code>
                        <div>
                          <ValueView value={value} objects={objects} />
                          {change && (
                            <div
                              className="value-transition"
                              title={`${beforeText(name)} → ${valueText(value, objects)}`}
                            >
                              {beforeText(name)} <span>→</span>{" "}
                              {valueText(value, objects).slice(0, 100)}
                            </div>
                          )}
                        </div>
                        <span className="type-label">
                          {valueType(value, objects)}
                        </span>
                        <button
                          className={`icon-button ${pinned ? "is-pinned" : ""}`}
                          title={`${pinned ? "Unpin" : "Pin"} ${name}`}
                          aria-label={`${pinned ? "Unpin" : "Pin"} ${name}`}
                          onClick={() => togglePin(frame!, name)}
                        >
                          <Pin size={13} />
                        </button>
                      </div>
                    );
                  })}
                  {!Object.keys(frame?.locals ?? {}).length && (
                    <p className="no-locals">
                      No local variables at this step.
                    </p>
                  )}
                  {Object.entries(frame?.changes ?? {})
                    .filter(([, change]) => change.after === null)
                    .map(([name, change]) => (
                      <div className="removed-variable" key={name}>
                        <code>{name}</code>{" "}
                        {valueText(
                          change.before ?? undefined,
                          previousFrame?.objects ?? {},
                        )}{" "}
                        → removed
                      </div>
                    ))}
                </div>
                {event.returnValue && (
                  <div className="return-observation">
                    <span>Return at this step</span>
                    <ValueView value={event.returnValue} objects={objects} />
                  </div>
                )}
                {event.exception && (
                  <div className="exception-observation">
                    {event.exception.type}: {event.exception.message}
                    <small>
                      An observed exception may be caught later in the program.
                    </small>
                  </div>
                )}
              </div>
            </>
          )}
          {run.result && (
            <div
              role="tabpanel"
              id="execution-panel-output"
              aria-labelledby="execution-tab-output"
              hidden={view !== "output"}
            >
              <details className="output-panel" open>
                <summary>
                  <Terminal size={15} /> Output & result{" "}
                  {run.outcome === "completed" && <CheckCircle2 size={14} />}
                </summary>
                {run.result.returnValue && (
                  <div className="final-return">
                    <span>
                      {run.snapshot?.language === "cpp"
                        ? "Exit code"
                        : "Return value"}
                    </span>
                    <ValueView
                      value={run.result.returnValue}
                      objects={run.result.objects}
                    />
                  </div>
                )}
                <div className="output-stream">
                  <span>stdout</span>
                  <pre>{run.result.stdout || "No output printed."}</pre>
                </div>
                {run.result.stderr && (
                  <div className="output-stream stderr">
                    <span>stderr</span>
                    <pre>{run.result.stderr}</pre>
                  </div>
                )}
                <div className="result-meta">
                  <Clock size={12} />{" "}
                  {(run.result.durationMs / 1000).toFixed(3)}s ·{" "}
                  {steps.length.toLocaleString()} steps ·{" "}
                  {run.result.complete ? "complete trace" : "partial trace"}
                </div>
              </details>
            </div>
          )}
        </>
      )}
      <div className="playback">
        <div className="step-status" role="status">
          <span className={event ? "status-dot active" : "status-dot"} />
          <span>
            {event
              ? `Step ${index + 1} of ${steps.length}`
              : "No step selected"}
          </span>
          <label className="speed-label">
            Speed{" "}
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              aria-label="Playback speed"
            >
              <option value={1500}>Slow</option>
              <option value={700}>Normal</option>
              <option value={200}>Fast</option>
            </select>
          </label>
        </div>
        <input
          className="timeline"
          aria-label="Execution timeline"
          type="range"
          min={0}
          max={Math.max(0, steps.length - 1)}
          value={index}
          disabled={!event}
          onChange={(e) => jump(Number(e.target.value))}
        />
        <div className="playback-buttons">
          <button
            className="icon-button restart-button"
            title="Restart playback"
            aria-label="Restart playback"
            disabled={!event || index === 0}
            onClick={() => jump(0)}
          >
            <RotateCcw size={16} />
          </button>
          <button
            disabled={!event || index === 0}
            onClick={() => jump(index - 1)}
          >
            <ArrowLeft size={15} /> Previous
          </button>
          <button
            className="play-button"
            aria-label={
              playing
                ? "Pause playback"
                : index >= steps.length - 1
                  ? "Replay execution"
                  : "Play playback"
            }
            title={
              playing ? "Pause" : index >= steps.length - 1 ? "Replay" : "Play"
            }
            disabled={!event || steps.length < 2}
            onClick={() => {
              if (!playing && index >= steps.length - 1) onIndex(0);
              setPlaying((value) => !value);
            }}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            className="next-button"
            disabled={!event || index >= steps.length - 1}
            onClick={() => jump(index + 1)}
          >
            Next <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}
