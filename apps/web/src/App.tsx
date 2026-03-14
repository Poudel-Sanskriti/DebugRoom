import { useState } from "react";
import CodeEditor from "./CodeEditor";
import { demo } from "./demo";

export default function App() {
  const [code, setCode] = useState("");
  const [input, setInput] = useState("");
  const [problem, setProblem] = useState("");
  const [demoLoaded, setDemoLoaded] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // A demo belongs only to its matching source and input. Editing invalidates it.
  const step = demoLoaded ? demo.steps[selectedIndex] : undefined;
  function loadDemo() {
    setCode(demo.code);
    setInput(demo.input);
    setProblem(demo.problem);
    setSelectedIndex(0);
    setDemoLoaded(true);
  }
  function updateCode(value: string) {
    setCode(value);
    if (value !== demo.code) setDemoLoaded(false);
  }
  function updateInput(value: string) {
    setInput(value);
    if (value !== demo.input) setDemoLoaded(false);
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="DebugRoom home">
          <span className="brand-mark">
            d<span>r</span>
          </span>
          DebugRoom<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <span className="local-badge">
          <span />
          Local prototype
        </span>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <div className="eyebrow">WORKSPACE / PYTHON</div>
            <h1>A closer look at your code.</h1>
            <p>Explore what changes, one step at a time.</p>
          </div>
          <button className="primary" onClick={loadDemo}>
            <span aria-hidden="true">↗</span> Load demo
          </button>
        </div>
        <div className="workspace">
          <section className="workbench" aria-label="Code and input">
            <div className="problem-panel">
              <label className="panel-title" htmlFor="problem">
                <span className="section-number">01</span> Problem{" "}
                <span className="optional">optional</span>
              </label>
              <textarea
                id="problem"
                value={problem}
                onChange={(event) => setProblem(event.target.value)}
                placeholder="What are you working on? Add a question, constraints, or expected result."
              />
            </div>
            <div className="editor-panel">
              <div className="editor-toolbar">
                <span>
                  <span className="file-icon" aria-hidden="true">
                    ⌘
                  </span>{" "}
                  main.py
                </span>
                <span className="language">Python</span>
              </div>
              <CodeEditor
                value={code}
                onChange={updateCode}
                activeLine={step?.line}
              />
              <div className="editor-footer">
                <span>
                  {code ? code.trimEnd().split("\n").length : 0} lines
                </span>
                <span>
                  {step
                    ? `Inspecting line ${step.line}`
                    : "Ready for your code"}
                </span>
              </div>
            </div>
            <div className="input-panel">
              <div className="input-heading">
                <label className="panel-title" htmlFor="input">
                  <span className="section-number">02</span> Input
                </label>
                <span className="format-badge">JSON</span>
              </div>
              <textarea
                id="input"
                spellCheck={false}
                value={input}
                onChange={(event) => updateInput(event.target.value)}
                placeholder={'{ "args": [], "kwargs": {} }'}
              />
              <div className="run-row">
                <span id="run-note">
                  Python execution is coming in a later step.
                </span>
                <button
                  className="run-button"
                  disabled
                  aria-describedby="run-note"
                >
                  <span aria-hidden="true">▷</span> Run code
                </button>
              </div>
            </div>
          </section>
          <section className="inspector" aria-label="Execution inspector">
            <div className="inspector-heading">
              <div className="panel-title">
                <span className="section-number">03</span> Execution
              </div>
              <span className="demo-badge">DEMO MODE</span>
            </div>
            <div className="trace-summary">
              <span className="eyebrow">
                {step ? "CAPTURED OBSERVATION" : "YOUR EXECUTION, UNPACKED"}
              </span>
              <h2>{step ? "Inside add()" : "See the in-between."}</h2>
              <p>
                {step
                  ? "Hand-written demo data. No Python has run."
                  : "Load the demo to inspect a small function and watch its variables change."}
              </p>
            </div>
            <div className="line-card">
              <span className="line-symbol" aria-hidden="true">
                ↳
              </span>
              <div>
                <span className="muted-label">
                  {step ? "NEXT LINE TO EXECUTE" : "CURRENT LINE"}
                </span>
                <strong data-testid="current-line">
                  {step ? `Line ${step.line}` : "No step selected"}
                </strong>
              </div>
              {step && <span className="line-event">before execution</span>}
            </div>
            <div className="variables-heading">
              <h3>Local variables</h3>
              <span>{step ? Object.keys(step.locals).length : 0} visible</span>
            </div>
            {step ? (
              <div className="variable-table">
                <div className="table-header">
                  <span>NAME</span>
                  <span>VALUE</span>
                  <span>TYPE</span>
                </div>
                {Object.entries(step.locals).map(([name, value]) => (
                  <div className="variable-row" key={name}>
                    <code>{name}</code>
                    <strong>{value}</strong>
                    <span>int</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-variables">
                <span className="empty-symbol" aria-hidden="true">
                  {"{ }"}
                </span>
                <strong>A place for every value</strong>
                <p>
                  Variables appear here when you
                  <br />
                  load a captured trace.
                </p>
              </div>
            )}
            <div className="inspector-note">
              <span aria-hidden="true">ⓘ</span>
              <p>
                {step
                  ? "Values describe the moment before the highlighted line runs. Next reads the following observation."
                  : "The editor starts empty. Try the demo first, or begin writing your own Python."}
              </p>
            </div>
            <div className="playback">
              <div className="step-status" role="status">
                <span className={step ? "status-dot active" : "status-dot"} />
                <span>
                  {step
                    ? `Step ${selectedIndex + 1} of ${demo.steps.length}`
                    : "No trace loaded"}
                </span>
                <span className="step-kind">
                  {step ? "line event" : "waiting"}
                </span>
              </div>
              <div className="playback-buttons">
                <button
                  disabled={!step || selectedIndex === 0}
                  onClick={() =>
                    setSelectedIndex((index) => Math.max(0, index - 1))
                  }
                >
                  <span aria-hidden="true">←</span> Previous
                </button>
                <button
                  className="next-button"
                  disabled={!step || selectedIndex === demo.steps.length - 1}
                  onClick={() =>
                    setSelectedIndex((index) =>
                      Math.min(demo.steps.length - 1, index + 1),
                    )
                  }
                >
                  Next <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          </section>
        </div>
        <footer className="page-footer">
          <span>
            <span className="footer-mark" aria-hidden="true">
              ◇
            </span>{" "}
            A little less guessing. A little more understanding.
          </span>
          <span>
            Milestone 1.1 <span className="footer-divider">/</span> Fixture
            playback · changes aren’t saved
          </span>
        </footer>
      </main>
    </div>
  );
}
