"""Trace one submitted Python source file; run ONLY under an external supervisor.

The stdout protocol is newline-delimited JSON. Print/stderr become output records.
The collector is an observation tool, not a security or anti-tampering boundary.
"""
from __future__ import annotations

import ast
import builtins
import inspect
import io
import json
import os
import sys
import time
import traceback
import types
from pathlib import Path

# -I ignores cwd on sys.path. Import only the packaged sibling collector.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from values import Snapshotter, fingerprint

FILENAME = "<debugroom>"
PROTOCOL = sys.stdout
STARTED = time.monotonic()


def emit(record):
    PROTOCOL.write(json.dumps(record, ensure_ascii=True, separators=(",", ":")) + "\n")
    PROTOCOL.flush()


def error_detail(exc):
    line = getattr(exc, "lineno", None) if isinstance(exc, SyntaxError) else None
    tb = exc.__traceback__
    while tb:
        if tb.tb_frame.f_code.co_filename == FILENAME:
            line = tb.tb_lineno
        tb = tb.tb_next
    return {"type": type(exc).__name__[:200], "message": str(exc)[:16384], "line": line,
            "traceback": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-32768:]}


def discover(source):
    tree = ast.parse(source, filename=FILENAME)
    candidates = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and not node.name.startswith("_"):
            if not any(isinstance(child, (ast.Yield, ast.YieldFrom)) for child in ast.walk(node)):
                candidates.append({"name": node.name, "line": node.lineno, "signature": ast.unparse(node.args)[:500]})
    return candidates


class Collector:
    def __init__(self, limits):
        self.limits = limits
        self.snapshots = Snapshotter()
        self.frames = {}
        self.next_frame = 1
        self.previous = {}
        self.count = 0
        self.trace_bytes = 0
        self.output_bytes = 0
        self.finished = False

    def finish(self, outcome, error=None, return_value=None, hard=False):
        if self.finished:
            return
        self.finished = True
        sys.settrace(None)
        record = {"type": "result", "outcome": outcome, "durationMs": (time.monotonic() - STARTED) * 1000,
                  "complete": outcome == "completed", "objects": self.snapshots.objects}
        if error is not None:
            record["error"] = error
        if return_value is not None:
            record["returnValue"] = return_value
        emit(record)
        if hard:
            os._exit(0)

    def output(self, stream, text):
        if self.finished:
            return len(text)
        encoded = text.encode("utf-8", "replace")
        remaining = self.limits["outputBytes"] - self.output_bytes
        if encoded:
            chunk = encoded[:remaining].decode("utf-8", "ignore")
            if chunk:
                emit({"type": "output", "stream": stream, "text": chunk})
            self.output_bytes += min(len(encoded), remaining)
        if len(encoded) > remaining:
            self.finish("output_limit", hard=True)
        return len(text)

    def trace(self, frame, event, arg):
        if frame.f_code.co_filename != FILENAME:
            return self.trace
        if event not in ("call", "line", "return", "exception"):
            return self.trace
        if self.count >= self.limits["steps"]:
            self.finish("trace_limit", hard=True)
        self.snapshots.begin()
        chain = []
        cursor = frame
        while cursor:
            if cursor.f_code.co_filename == FILENAME:
                chain.append(cursor)
            cursor = cursor.f_back
        chain.reverse()
        if len(chain) > 128:
            self.finish("trace_size_limit", hard=True)
        frames = []
        for current in chain:
            identity = id(current)
            if identity not in self.frames:
                self.frames[identity] = f"f{self.next_frame}"
                self.next_frame += 1
            frame_id = self.frames[identity]
            visible = [(name, value) for name, value in current.f_locals.items() if not name.startswith("__")]
            local_values = {name[:200]: self.snapshots.value(value) for name, value in visible[:256]}
            frames.append({"id": frame_id, "function": current.f_code.co_name[:200], "line": max(1, current.f_lineno),
                           "locals": local_values, "changes": {}, "truncated": len(visible) > 256})
        record = {"index": self.count, "kind": event, "line": max(1, frame.f_lineno), "frameId": self.frames[id(frame)],
                  "frames": frames, "objects": self.snapshots.objects}
        if event == "return":
            record["returnValue"] = self.snapshots.value(arg)
        if event == "exception":
            record["exception"] = {"type": type(arg[1]).__name__[:200], "message": str(arg[1])[:16384], "line": frame.f_lineno}
        for state in frames:
            before = self.previous.get(state["id"], {})
            current = {}
            for name, value in state["locals"].items():
                signature = fingerprint(value, self.snapshots.objects)
                current[name] = (value, signature)
                if name not in before or before[name][1] != signature:
                    state["changes"][name] = {"before": before[name][0] if name in before else None, "after": value}
            for name in before.keys() - current.keys():
                state["changes"][name] = {"before": before[name][0], "after": None}
            self.previous[state["id"]] = current
        encoded = json.dumps(record, ensure_ascii=True, separators=(",", ":")).encode()
        if len(encoded) > self.limits["eventBytes"] or self.trace_bytes + len(encoded) > self.limits["traceBytes"]:
            self.finish("trace_size_limit", hard=True)
        emit({"type": "event", "event": record})
        self.trace_bytes += len(encoded)
        self.count += 1
        if event == "return":
            # Frames may be reused by CPython; each invocation receives a fresh ID.
            self.frames.pop(id(frame), None)
        return self.trace


class Output(io.TextIOBase):
    def __init__(self, collector, stream):
        self.collector = collector
        self.stream = stream

    @property
    def encoding(self):
        return "utf-8"

    def writable(self):
        return True

    def write(self, text):
        if not isinstance(text, str):
            raise TypeError("write() argument must be str")
        return self.collector.output(self.stream, text)

    def flush(self):
        pass


def main():
    job = json.load(sys.stdin)
    source = job["code"]
    if job.get("mode") == "discover":
        try:
            emit({"type": "discovery", "functions": discover(source)})
        except SyntaxError as exc:
            emit({"type": "discovery", "functions": [], "error": error_detail(exc)})
        return
    policy = {"steps": 10000, "outputBytes": 262144, "traceBytes": 16777216, "eventBytes": 262144}
    for key in policy:
        if key in job.get("limits", {}):
            policy[key] = max(1, min(policy[key], job["limits"][key]))
    collector = Collector(policy)
    sys.stdout = Output(collector, "stdout")
    sys.stderr = Output(collector, "stderr")
    supplied = job.get("input", {})
    sys.stdin = io.StringIO(supplied.get("stdin", ""))
    namespace = {"__name__": "__main__", "__file__": FILENAME, "__builtins__": builtins.__dict__}
    try:
        candidates = discover(source)
        entry = job.get("entryPoint")
        if entry is None and len(candidates) == 1:
            entry = candidates[0]["name"]
        elif entry is None and len(candidates) > 1:
            raise ValueError("Select an entry function before running this program")
        if entry not in (None, "__module__") and entry not in [x["name"] for x in candidates]:
            raise ValueError("Entry point must be a detected synchronous top-level function")
        if type(supplied.get("args", [])) is not list or type(supplied.get("kwargs", {})) is not dict:
            raise ValueError("Input requires an args array and a kwargs object")
    except SyntaxError as exc:
        collector.finish("syntax_error", error_detail(exc))
        return
    except (ValueError, TypeError) as exc:
        collector.finish("input_error", error_detail(exc))
        return
    try:
        compiled = compile(source, FILENAME, "exec")
        sys.settrace(collector.trace)
        exec(compiled, namespace)
        result = None
        if entry not in (None, "__module__"):
            function = namespace.get(entry)
            if type(function) is not types.FunctionType or inspect.iscoroutinefunction(function) or inspect.isgeneratorfunction(function):
                sys.settrace(None)
                collector.finish("input_error", {"type": "TypeError", "message": "Entry point is not a synchronous function", "line": None})
                return
            try:
                bound = inspect.signature(function).bind(*supplied.get("args", []), **supplied.get("kwargs", {}))
            except TypeError as exc:
                sys.settrace(None)
                collector.finish("input_error", error_detail(exc))
                return
            result = function(*bound.args, **bound.kwargs)
        sys.settrace(None)
        collector.snapshots.begin()
        returned = collector.snapshots.value(result)
        collector.finish("completed", return_value=returned)
    except MemoryError as exc:
        collector.finish("memory_limit", error_detail(exc))
    except BaseException as exc:
        collector.finish("runtime_error", error_detail(exc))
    finally:
        sys.settrace(None)


if __name__ == "__main__":
    main()
