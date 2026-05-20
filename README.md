# DebugRoom

A visual execution workspace for Python and a supported subset of C++.
Run a program once, inspect its captured state, and investigate a problem with a
student through private mentor experiments and explicitly shared feedback.

## What works

- Python functions, scripts, and `Solution` methods with separate structured input.
- Source highlighting, Previous/Next, Play/Pause, Restart, timeline seeking, and speeds.
- Local/global variables, changes, pinned values, recursion, aliases, and object relationships.
- C++20 `main()` programs with stdin, Clang/LLDB observations, arrays, vectors, and pointers.
- PostgreSQL autosave, immutable run snapshots, durable jobs, leases, and bounded recovery.
- Disposable execution containers, gVisor for Python, deadlines, cancellation, quotas, and a host watchdog.
- Single-use student invitations, revocation, private mentor copies, selective sharing, comments, comparisons, regression inputs, and exports.
- Hosted retention/deletion, checked local backups, structured logs, optional OpenTelemetry, CI, and an AWS deployment configuration.

The application is implemented and verified locally. No cloud resources have been
provisioned. GitHub OAuth, the AWS deployment, and a real tutoring trial require
external configuration and validation. Hosted C++ is disabled by default because
the tested gVisor profile does not reliably repeat C++ breakpoints.

## Start locally

Prerequisites: Node.js 24, Python 3.14, Docker, and gVisor on a dedicated execution
host. On macOS, the tested setup uses a dedicated Colima VM. Do not share your
home directory or repository with that VM.

```sh
# macOS prerequisites
brew install colima docker docker-compose libpq
colima start --profile debugroom --cpu 2 --memory 4 --disk 20 --vm-type vz --mount none --activate=false
colima ssh --profile debugroom -- bash -s < infra/install-gvisor.sh

# From this repository
npm ci
npm run setup:local
npm run dev
```

Open **http://127.0.0.1:5173/**. The workspace opens automatically on your own
machine: no password, access key, or sign-in step. Hosted and explicitly proxied
setups retain their authentication. `npm run local:access` remains available for
the protected proxy workflow; its key must not be shared or committed.

The development command starts the API and execution worker. It starts a
project-local PostgreSQL cluster when no `DATABASE_URL` is supplied. Data is
stored under `.data/` and survives restarts. Local workspaces remain until you
delete them; the 30-day automatic expiry applies to hosted workspaces.

Stop the development command with Ctrl+C. Stop the dedicated VM when finished
with `colima stop --profile debugroom`. Rebuild the language images with
`npm run setup:local` after changing a tracer, and restart the worker so it pins
the new image IDs.

## Try a complete workflow

Open **Problem library** for 15 curated easy LeetCode problems. Search by title or
filter by pattern, choose a sample or edge case, then use **Practice yourself**
for a method stub or **Watch solution** for a real run with automatic playback.
Each selection opens a separate saved workspace. The study guide keeps hints,
expected results, and alternate inputs alongside your code. Expected results are
reference examples, not an automatic grading service.

The first set includes Two Sum, Contains Duplicate, Valid Anagram, Best Time to
Buy and Sell Stock, Valid Palindrome, Move Zeroes, Binary Search, Valid Parentheses,
Reverse Linked List, Merge Two Sorted Lists, Linked List Cycle, Invert Binary Tree,
Majority Element, Single Number, and Climbing Stairs. Links lead to the official
problem pages; the selection is a curated foundation, not a live popularity ranking.

In Execution Studio, **Data structures** shows captured hash entries, sets, stacks,
linked nodes, and tree references. Switch to **Sequence** for array markers.
Linked-list and tree exercises include documented JSON adapters that build real
nodes before calling the algorithm. Their helper code stays in practice mode.

1. Load **Binary search**, then click **Run code**.
2. Move through the trace and inspect `low`, `high`, and `mid`. A Python line event
   describes state before that line executes.
   The Execution Studio moves index markers across the array and shades cells
   outside `low…high`. Choose which integer variables to show as index markers.
   Try **Watch a bubble sort** for animated swaps or **Recursive factorial** for
   a growing call journey. Replay starts again from the end; system reduced-motion
   preferences disable movement while preserving every captured value.
   Switch between **Visualize**, **Variables**, and **Output** without losing your
   step. Playback controls stay above the view, and the panel has no nested
   vertical scrollbar.
3. Edit the working input. The **Run snapshot** tab still shows the source and
   input that produced the earlier result.
4. Open **Feedback** to create a student invitation, use the private mentor copy,
   share selected lines or a question, and attach comments to a run's source.
5. Use **History** to compare runs or export a full trace. Save useful regression
   inputs and investigation notes for another session.

For C++, load one of the C++ examples. Supply text in `stdin`, keep `args` and
`kwargs` empty, and use a standalone `main()`. The C++ result field is the process
exit code; printed answers appear in stdout. See the support contract below.

## Checks and maintenance

```sh
npm test                 # UI, real-PostgreSQL API, Python, and shared-contract tests
npm run build            # API type checking and production frontend build
npm run format:check
npm run test:sandbox     # requires built images and a running Docker host
npm run test:cpp
npm run test:e2e          # requires Playwright Chromium and the full local stack
npm run benchmark        # isolated synthetic workload; never an adoption metric
npm run backup
npm run restore:check    # local-only restoration into a disposable test database
```

For sandbox checks on macOS, set `DOCKER_CONTEXT=colima-debugroom`,
`PYTHON_CONTAINER_RUNTIME=runsc`, and `CPP_CONTAINER_RUNTIME=runc` in the shell.
Use `PG_BIN=/opt/homebrew/opt/libpq/bin` if PostgreSQL client tools are not on PATH.
API tests use isolated schemas, with `TEST_DATABASE_URL` overriding the native
local database. Backups and keys stay in `.data/` and are excluded from Git and
from Vite's served filesystem.

`compose.yaml` provides an alternative packaged local demo on port 3031. Set
random `POSTGRES_PASSWORD` and `DEBUGROOM_RUNNER_TOKEN` values in an untracked
environment file, build the language images, then run Docker Compose. Only its
trusted worker receives the Docker socket; execution containers do not. The
hosted deployment uses a host service for the worker so its independent watchdog
survives worker-process death.

## Code and operating guide

- [Measured local workload](docs/evidence/local-benchmark.json): raw samples,
  environment, commit, runtime IDs, and summary statistics.
- [Verification record](docs/evidence/verification.json): final test counts, live
  workflow checks, restored artifacts, and browser observations.
- `apps/web/src/hooks/useWorkspace.ts`: drafts, autosave, history, and immutable runs.
- `apps/api/src/store.ts`: transactions, snapshots, idempotency, leases, and cancellation.
- `runner/python/tracer.py` and `runner/python/values.py`: Python observations and values.
- `runner/cpp/tracer.py`: C++ source stops and bounded debugger reads.
- `runner/agent/supervisor.py` and `runner/agent/watchdog.py`: execution lifecycle.
- `packages/contracts/trace.schema.json`: the shared versioned trace format.

There are no in-product AI hints, automatic grades, live character collaboration,
external package installation, or multi-file project imports.
