"""Run one bounded, disposable container and retain complete protocol records."""
from __future__ import annotations

import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LIMITS = {"wallMs": 60000, "steps": 10000, "outputBytes": 262144, "traceBytes": 16777216, "eventBytes": 262144,
                  "memoryMb": 256, "processes": 64, "scratchMb": 32}


def docker_command():
    executable = os.environ.get("DOCKER_BIN", "docker")
    context = os.environ.get("DOCKER_CONTEXT")
    return [executable] + (["--context", context] if context else [])


def control(arguments, timeout=20):
    return subprocess.run(docker_command() + arguments, capture_output=True, text=True, timeout=timeout)


def execute(job, heartbeat=None, mode="docker", policy=None, attempt_id=None):
    limits = {**DEFAULT_LIMITS, **(policy or {})}
    language = job.get("language", "python")
    if language == "cpp":
        limits["memoryMb"] = max(512, limits["memoryMb"])
    start = time.monotonic()
    runtime_start = None
    name = "debugroom-" + (attempt_id or str(uuid.uuid4()))
    events, stdout, stderr = [], [], []
    protocol_result = None
    failure = None
    failure_message = None
    trace_bytes = output_bytes = 0
    process = None
    selector = None
    sandbox_created = False
    temporary = tempfile.TemporaryDirectory(prefix="debugroom-")
    payload = json.dumps({"code": job["code"], "input": job.get("input", {}), "entryPoint": job.get("entryPoint"), "limits": limits}).encode()
    metrics = {}

    def stop(outcome, message=None):
        nonlocal failure, failure_message
        if failure is None:
            failure, failure_message = outcome, message
        if mode == "docker" and sandbox_created:
            try:
                control(["kill", name], timeout=5)
            except (subprocess.TimeoutExpired, OSError):
                pass
        if process is not None and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    try:
        if mode == "docker":
            image = os.environ.get("PYTHON_IMAGE", "debugroom-python:local") if language == "python" else os.environ.get("CPP_IMAGE", "debugroom-cpp:local")
            arguments = ["create", "-i", "--name", name, "--label", "dev.debugroom.execution=true", "--network", "none", "--read-only",
                         "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", str(limits["processes"]),
                         "--ulimit", f'nproc={limits["processes"]}:{limits["processes"]}', "--memory", f'{limits["memoryMb"]}m', "--memory-swap", f'{limits["memoryMb"]}m', "--cpus", "1",
                         "--ulimit", f'fsize={limits["scratchMb"] * 1024 * 1024}:{limits["scratchMb"] * 1024 * 1024}',
                         "--tmpfs", f'/tmp:rw,noexec,nosuid,size={limits["scratchMb"]}m,mode=1777', "--user", "65532:65532"]
            selected_runtime = os.environ.get(language.upper() + "_CONTAINER_RUNTIME", os.environ.get("CONTAINER_RUNTIME"))
            if selected_runtime:
                arguments += ["--runtime", selected_runtime]
            if language == "cpp":
                # LLDB requires process tracing inside its separate execution container.
                arguments += ["--tmpfs", "/work:rw,exec,nosuid,size=64m,mode=1777"]
            created = control(arguments + [image], timeout=30)
            if created.returncode:
                raise RuntimeError("Execution container could not be created: " + created.stderr[-2000:])
            sandbox_created = True
            command = docker_command() + ["start", "-a", "-i", name]
            environment = os.environ.copy()  # Docker CLI only; no host env enters the container.
        elif mode == "local-inspected" and language == "python":
            command = [sys.executable, "-I", "-S", str(ROOT / "runner/python/tracer.py")]
            environment = {"PATH": os.defpath, "LANG": "C.UTF-8", "PYTHONIOENCODING": "utf-8"}
        else:
            raise RuntimeError("Unsupported execution mode or language")
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   cwd=temporary.name, env=environment, start_new_session=True)
        def feed_input():
            try:
                process.stdin.write(payload)
                process.stdin.close()
            except (BrokenPipeError, OSError):
                pass
        threading.Thread(target=feed_input, daemon=True).start()
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ, "protocol")
        selector.register(process.stderr, selectors.EVENT_READ, "stderr")
        pending = b""
        next_heartbeat = 0
        last_good_heartbeat = time.monotonic()
        while selector.get_map():
            now = time.monotonic()
            if heartbeat and now >= next_heartbeat:
                try:
                    status = heartbeat(runtime_start is not None)
                    last_good_heartbeat = now
                    if not status.get("active", False) or status.get("cancel", False):
                        stop("stopped")
                except Exception:
                    # A disconnected agent must stop before it could outlive its lease.
                    if now - last_good_heartbeat > 8:
                        stop("infrastructure_error", "Worker lost its control connection")
                next_heartbeat = time.monotonic() + 2
            if runtime_start and now - runtime_start > limits["wallMs"] / 1000:
                stop("timeout")
            elif runtime_start is None and now - start > 30:
                stop("infrastructure_error", "Execution runtime did not start within 30 seconds")
            for key, _ in selector.select(timeout=0.05):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                if key.data == "stderr":
                    remaining = limits["outputBytes"] - output_bytes
                    stderr.append(chunk[:remaining].decode("utf-8", "replace"))
                    output_bytes += min(len(chunk), remaining)
                    if len(chunk) > remaining:
                        stop("output_limit")
                    continue
                pending += chunk
                if len(pending) > limits["eventBytes"] * 2:
                    stop("trace_size_limit")
                    pending = b""
                    continue
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    try:
                        record = json.loads(line)
                        kind = record["type"]
                        if kind == "phase" and record.get("phase") == "compiling":
                            metrics["compileStartedMs"] = (time.monotonic() - start) * 1000
                        elif kind == "started":
                            if runtime_start is not None:
                                raise ValueError("Duplicate start record")
                            runtime_start = time.monotonic()
                            metrics["sandboxStartMs"] = (runtime_start - start) * 1000
                            next_heartbeat = 0
                        elif kind == "event":
                            event = record["event"]
                            if protocol_result is not None or event["index"] != len(events):
                                raise ValueError("Invalid trace event sequence")
                            if len(events) >= limits["steps"]:
                                stop("trace_limit")
                            elif len(line) > limits["eventBytes"] or trace_bytes + len(line) > limits["traceBytes"]:
                                stop("trace_size_limit")
                            else:
                                events.append(event)
                                trace_bytes += len(line)
                        elif kind == "output":
                            if type(record.get("text")) is not str or record.get("stream") not in ("stdout", "stderr"):
                                raise ValueError("Invalid output record")
                            encoded = record["text"].encode("utf-8")
                            remaining = limits["outputBytes"] - output_bytes
                            (stdout if record["stream"] == "stdout" else stderr).append(encoded[:remaining].decode("utf-8", "ignore"))
                            output_bytes += min(len(encoded), remaining)
                            if len(encoded) > remaining:
                                stop("output_limit")
                        elif kind == "result":
                            if protocol_result is not None:
                                raise ValueError("Duplicate result record")
                            protocol_result = record
                        else:
                            raise ValueError("Unknown trace protocol record")
                    except (ValueError, TypeError, KeyError, UnicodeError):
                        stop("infrastructure_error", "The runtime returned malformed trace data")
            if failure and time.monotonic() - start > 35 + limits["wallMs"] / 1000:
                break
        selector.close()
        process.wait(timeout=5)
        if mode == "docker" and sandbox_created:
            inspect_result = control(["inspect", "--format", "{{.State.OOMKilled}}", name], timeout=5)
            if inspect_result.returncode == 0 and inspect_result.stdout.strip() == "true":
                failure = "memory_limit"
        if not failure and (process.returncode != 0 or protocol_result is None or pending.strip()):
            failure = "infrastructure_error"
            failure_message = "The execution runtime exited without a complete result"
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
        stop("infrastructure_error", str(exc)[:2000])
    finally:
        if process is not None and process.poll() is None:
            stop(failure or "infrastructure_error")
        if mode == "docker":
            # Also attempt removal if create timed out after the daemon accepted it.
            try:
                control(["rm", "-f", name], timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                pass
        if selector is not None:
            selector.close()
        if process is not None:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
            for pipe in (process.stdin, process.stdout, process.stderr):
                if pipe is not None:
                    try:
                        pipe.close()
                    except OSError:
                        pass
        temporary.cleanup()
    result = {"schemaVersion": 1, "language": language, "outcome": failure or (protocol_result or {}).get("outcome", "infrastructure_error"),
              "steps": events, "stdout": "".join(stdout), "stderr": "".join(stderr), "objects": (protocol_result or {}).get("objects", {}),
              "durationMs": max(0, (time.monotonic() - (runtime_start or start)) * 1000), "complete": not failure and (protocol_result or {}).get("complete", False)}
    if protocol_result:
        for key in ("error", "returnValue"):
            if key in protocol_result:
                result[key] = protocol_result[key]
    if failure_message:
        result["error"] = {"type": "ExecutionError", "message": failure_message, "line": None}
    metrics["executionMs"] = result["durationMs"]
    metrics["traceBytes"] = trace_bytes
    metrics["outputBytes"] = output_bytes
    return result, metrics
