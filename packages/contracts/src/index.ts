import { Type, type Static } from "@sinclair/typebox";

export const SCHEMA_VERSION = 1;
export const limits = {
  sourceBytes: 64 * 1024,
  inputBytes: 64 * 1024,
  problemBytes: 32 * 1024,
  steps: 10_000,
  wallMs: 60_000,
  warningMs: 5_000,
  outputBytes: 256 * 1024,
  traceBytes: 16 * 1024 * 1024,
  eventBytes: 256 * 1024,
  memoryMb: 256,
  processes: 64,
  scratchMb: 32,
} as const;
const boundedText = (maxLength: number) => Type.String({ maxLength });
export const LanguageSchema = Type.Union([
  Type.Literal("python"),
  Type.Literal("cpp"),
]);
export type Language = Static<typeof LanguageSchema>;
export const ValueSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("scalar"),
      type: boundedText(100),
      value: boundedText(4096),
      truncated: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("ref"), id: boundedText(100) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("unavailable"),
      type: boundedText(100),
      reason: boundedText(300),
    },
    { additionalProperties: false },
  ),
]);
export type TraceValue = Static<typeof ValueSchema>;
export const ObjectSchema = Type.Object(
  {
    id: boundedText(100),
    type: boundedText(100),
    length: Type.Optional(Type.Integer({ minimum: 0 })),
    items: Type.Optional(Type.Array(ValueSchema, { maxItems: 128 })),
    entries: Type.Optional(
      Type.Array(Type.Object({ key: ValueSchema, value: ValueSchema }), {
        maxItems: 128,
      }),
    ),
    attributes: Type.Optional(
      Type.Record(Type.String(), ValueSchema, { maxProperties: 128 }),
    ),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type TraceObject = Static<typeof ObjectSchema>;
export const ChangeSchema = Type.Object(
  {
    before: Type.Union([ValueSchema, Type.Null()]),
    after: Type.Union([ValueSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export const FrameSchema = Type.Object(
  {
    id: boundedText(100),
    function: boundedText(200),
    line: Type.Integer({ minimum: 1 }),
    locals: Type.Record(Type.String(), ValueSchema, { maxProperties: 256 }),
    changes: Type.Record(Type.String(), ChangeSchema, { maxProperties: 512 }),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type TraceFrame = Static<typeof FrameSchema>;
export const ErrorSchema = Type.Object(
  {
    type: boundedText(200),
    message: boundedText(16_384),
    line: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    traceback: Type.Optional(boundedText(32_768)),
  },
  { additionalProperties: false },
);
export type TraceError = Static<typeof ErrorSchema>;
export const EventSchema = Type.Object(
  {
    index: Type.Integer({ minimum: 0, maximum: limits.steps - 1 }),
    kind: Type.Union(
      (["call", "line", "return", "exception"] as const).map((value) =>
        Type.Literal(value),
      ),
    ),
    line: Type.Integer({ minimum: 1 }),
    frameId: boundedText(100),
    frames: Type.Array(FrameSchema, { maxItems: 128 }),
    objects: Type.Record(Type.String(), ObjectSchema, { maxProperties: 256 }),
    returnValue: Type.Optional(ValueSchema),
    exception: Type.Optional(ErrorSchema),
  },
  { additionalProperties: false },
);
export type TraceEvent = Static<typeof EventSchema>;
export const OutcomeSchema = Type.Union(
  (
    [
      "completed",
      "syntax_error",
      "runtime_error",
      "input_error",
      "compile_error",
      "timeout",
      "trace_limit",
      "output_limit",
      "trace_size_limit",
      "memory_limit",
      "stopped",
      "infrastructure_error",
    ] as const
  ).map((value) => Type.Literal(value)),
);
export type Outcome = Static<typeof OutcomeSchema>;
export const ResultSchema = Type.Object(
  {
    schemaVersion: Type.Literal(SCHEMA_VERSION),
    language: LanguageSchema,
    outcome: OutcomeSchema,
    steps: Type.Array(EventSchema, { maxItems: limits.steps }),
    stdout: boundedText(limits.outputBytes),
    stderr: boundedText(limits.outputBytes),
    error: Type.Optional(ErrorSchema),
    returnValue: Type.Optional(ValueSchema),
    objects: Type.Record(Type.String(), ObjectSchema, { maxProperties: 256 }),
    durationMs: Type.Number({ minimum: 0 }),
    complete: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type TraceResult = Static<typeof ResultSchema>;
export const DraftSchema = Type.Object(
  {
    language: LanguageSchema,
    code: boundedText(limits.sourceBytes),
    input: boundedText(limits.inputBytes),
    problem: boundedText(limits.problemBytes),
    entryPoint: Type.Union([boundedText(200), Type.Null()]),
  },
  { additionalProperties: false },
);
export type Draft = Static<typeof DraftSchema>;
export const InputSchema = Type.Object(
  {
    args: Type.Array(Type.Unknown(), { maxItems: 100 }),
    kwargs: Type.Record(Type.String(), Type.Unknown(), { maxProperties: 100 }),
    stdin: Type.Optional(boundedText(limits.inputBytes)),
  },
  { additionalProperties: false },
);
export type ProgramInput = Static<typeof InputSchema>;
export const emptyDraft: Draft = {
  language: "python",
  code: "",
  input: '{"args": [], "kwargs": {}}',
  problem: "",
  entryPoint: null,
};
export type RunStatus = "queued" | "running" | "finished";
export type Snapshot = Draft & {
  id: string;
  revision: number;
  createdAt: string;
};
export type Run = {
  id: string;
  workspaceId: string;
  branchId: string;
  snapshotId: string;
  status: RunStatus;
  outcome: Outcome | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  attempt: number;
  result?: TraceResult;
  snapshot?: Snapshot;
};
export type Branch = {
  id: string;
  name: string;
  kind: "student" | "mentor";
  revision: number;
  draft: Draft;
  updatedAt: string;
};
export type Workspace = {
  id: string;
  title: string;
  role: "tutor" | "student";
  createdAt: string;
  expiresAt: string;
  branches: Branch[];
  studentRevision: number;
  invitationActive: boolean;
};
export type Session = {
  role: "tutor" | "student";
  displayName: string;
  csrf: string;
  workspaceId?: string;
};
export type Comment = {
  id: string;
  snapshotId: string;
  line: number;
  body: string;
  author: string;
  createdAt: string;
};
export type SharedRevision = {
  id: string;
  kind: "full" | "selection" | "hint";
  title: string;
  body: string;
  source: string | null;
  input: string | null;
  language: Language;
  createdAt: string;
  snapshotId: string | null;
};
