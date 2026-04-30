import Fastify, { LogController, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { Type } from "@sinclair/typebox";
import { traceValidationError } from "@debugroom/contracts/validate-trace";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import {
  DraftSchema,
  InputSchema,
  ResultSchema,
  limits,
  type Draft,
  type TraceResult,
} from "@debugroom/contracts";
import { Store, type Actor } from "./store.ts";
import type { Artifacts } from "./artifacts.ts";
import { ApiError } from "./errors.ts";
import { instrumentRequests } from "./telemetry.ts";
import { registerOperations } from "./operations.ts";
import { registerCollaboration } from "./collaboration-routes.ts";
import { discoverPython } from "./discovery.ts";

export type AppConfig = {
  root: string;
  origin: string;
  localAuth: boolean;
  localLoginToken?: string;
  localProxyAuth?: boolean;
  trustProxy?: string[];
  runnerToken: string;
  logger?: boolean;
  serveStatic?: boolean;
  python?: string;
  executionMode: "docker" | "local-inspected";
  languages?: ("python" | "cpp")[];
  github?: { id: string; secret: string };
};
const Id = Type.String({ format: "uuid" });
const Key = Type.String({ minLength: 8, maxLength: 200 });
const inputCheck = TypeCompiler.Compile(InputSchema),
  resultCheck = TypeCompiler.Compile(ResultSchema);
const equal = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

export async function buildApp(
  store: Store,
  artifacts: Artifacts,
  config: AppConfig,
) {
  const app = Fastify({
    bodyLimit:
      limits.sourceBytes + limits.inputBytes + limits.problemBytes + 16384,
    logger: config.logger
      ? {
          level: "info",
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            "req.headers.x-csrf-token",
            "res.headers.set-cookie",
          ],
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: config.trustProxy ?? false,
  });
  app.decorateRequest("actor", null);
  instrumentRequests(app);
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    hook: "preHandler",
    keyGenerator: (request) =>
      request.actor
        ? `${request.actor.role}:${request.actor.tutorId ?? request.actor.grantId}`
        : request.ip,
    max: 240,
    timeWindow: "1 minute",
    allowList: (request) => request.url.startsWith("/internal/worker/"),
  });
  const allowedOrigins = new Set([config.origin]);
  if (config.localAuth) {
    allowedOrigins.add("http://127.0.0.1:5173");
    allowedOrigins.add("http://127.0.0.1:3001");
  }
  const allowedHosts = new Set(
    [...allowedOrigins].map((origin) => new URL(origin).host),
  );
  const secureCookies = new URL(config.origin).protocol === "https:";
  const cookieName = secureCookies
    ? "__Host-debugroom_session"
    : "debugroom_session";
  const cookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 7 * 86400,
  };
  app.addHook("onRequest", async (request, reply) => {
    reply
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "no-store");
    if (request.url.startsWith("/internal/worker/")) {
      const authorization = request.headers.authorization ?? "";
      if (!equal(authorization, `Bearer ${config.runnerToken}`))
        throw new ApiError(401, "Worker authentication required");
      return;
    }
    if (
      request.method === "GET" &&
      (request.url === "/health" || request.url === "/health/ready")
    )
      return;
    if (!allowedHosts.has(request.headers.host ?? ""))
      throw new ApiError(403, "Unrecognized request host");
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin))
      throw new ApiError(403, "Unrecognized request origin");
    if (
      request.headers["sec-fetch-site"] === "cross-site" &&
      !request.url.startsWith("/api/auth/github/callback")
    )
      throw new ApiError(403, "Cross-site request rejected");
    if (!request.url.startsWith("/api/")) return;
    request.actor = await store.session(request.cookies[cookieName] ?? "");
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    if (!origin || !allowedOrigins.has(origin))
      throw new ApiError(403, "A same-origin request is required");
    if (
      request.url === "/api/auth/local" ||
      request.url === "/api/invitations/redeem"
    )
      return;
    if (!request.actor) throw new ApiError(401, "Sign in to continue");
    if (
      typeof request.headers["x-csrf-token"] !== "string" ||
      !equal(request.headers["x-csrf-token"], request.actor.csrf)
    )
      throw new ApiError(403, "Refresh the page before trying again", "csrf");
  });
  app.setErrorHandler((error, request, reply) => {
    const known = error as ApiError & { validation?: unknown };
    const status = known.statusCode ?? (known.validation ? 400 : 500);
    if (status >= 500)
      app.log.error({ err: error, requestId: request.id }, "request failed");
    reply.code(status).send({
      error: {
        code: known.code ?? "request_error",
        message:
          status >= 500
            ? "The service could not complete this request. Your saved work is unchanged."
            : known.message,
      },
    });
  });
  app.addHook("onResponse", async (request) => {
    if (
      request.url === "/health" ||
      request.url.endsWith("/claim") ||
      request.url.endsWith("/heartbeat")
    )
      return;
    app.log.info(
      {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url,
      },
      "request completed",
    );
  });
  const actor = (request: FastifyRequest) => {
    if (!request.actor) throw new ApiError(401, "Sign in to continue");
    return request.actor;
  };
  function checkDraft(draft: Draft) {
    if (
      Buffer.byteLength(draft.code) > limits.sourceBytes ||
      Buffer.byteLength(draft.input) > limits.inputBytes ||
      Buffer.byteLength(draft.problem) > limits.problemBytes
    )
      throw new ApiError(400, "The workspace exceeds its text size limit");
    let input: unknown;
    try {
      input = JSON.parse(draft.input);
    } catch {
      throw new ApiError(400, "Input must be valid JSON", "invalid_input");
    }
    if (!inputCheck.Check(input))
      throw new ApiError(
        400,
        "Input requires an args array and a kwargs object, with optional stdin text",
        "invalid_input",
      );
  }
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/api/config", async () => ({
    localAuth: config.localAuth,
    githubAuth: !!config.github,
    executionMode: config.executionMode,
    languages: config.languages ?? ["python", "cpp"],
    limits,
  }));
  app.get("/api/session", async (request) => {
    const a = actor(request);
    return {
      role: a.role,
      displayName: a.displayName,
      workspaceId: a.workspaceId,
      csrf: a.csrf,
    };
  });
  app.post<{ Body: { token: string } }>(
    "/api/auth/local",
    {
      schema: {
        body: Type.Object(
          { token: Type.String({ minLength: 32, maxLength: 100 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      if (!config.localAuth)
        throw new ApiError(404, "Local sign-in is unavailable");
      if (
        !config.localProxyAuth &&
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip)
      )
        throw new ApiError(
          403,
          "Local sign-in is available only on this machine",
        );
      if (
        !config.localLoginToken ||
        !equal(request.body.token, config.localLoginToken)
      )
        throw new ApiError(403, "A valid local access key is required");
      const id = await store.tutor("local:owner", "Local tutor");
      const session = await store.createSession(id, null);
      reply.setCookie(cookieName, session.secret, cookieOptions);
      return { signedIn: true };
    },
  );
  app.post("/api/auth/logout", async (request, reply) => {
    await store.logout(actor(request));
    reply.clearCookie(cookieName, { path: "/" });
    return { signedOut: true };
  });
  app.get("/api/workspaces", async (request) => ({
    workspaces: await store.listWorkspaces(actor(request)),
  }));
  app.post<{ Body: { title: string } }>(
    "/api/workspaces",
    {
      schema: {
        body: Type.Object(
          { title: Type.String({ maxLength: 120 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (request) =>
      store.createWorkspace(actor(request), request.body.title),
  );
  app.get<{ Params: { id: string } }>(
    "/api/workspaces/:id",
    { schema: { params: Type.Object({ id: Id }) } },
    async (request) => store.workspace(actor(request), request.params.id),
  );
  app.patch<{ Params: { id: string }; Body: { title: string } }>(
    "/api/workspaces/:id",
    {
      schema: {
        params: Type.Object({ id: Id }),
        body: Type.Object(
          { title: Type.String({ maxLength: 120 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (request) =>
      store.renameWorkspace(
        actor(request),
        request.params.id,
        request.body.title,
      ),
  );
  app.put<{
    Params: { id: string };
    Body: {
      expectedRevision: number;
      draft: Draft;
      confirmDirectEdit?: boolean;
    };
  }>(
    "/api/branches/:id/draft",
    {
      schema: {
        params: Type.Object({ id: Id }),
        body: Type.Object(
          {
            expectedRevision: Type.Integer({ minimum: 0 }),
            draft: DraftSchema,
            confirmDirectEdit: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      // Drafts may contain incomplete JSON while the learner is typing; execution validates it.
      const d = request.body.draft;
      if (
        Buffer.byteLength(d.code) > limits.sourceBytes ||
        Buffer.byteLength(d.input) > limits.inputBytes ||
        Buffer.byteLength(d.problem) > limits.problemBytes
      )
        throw new ApiError(400, "Draft text exceeds its size limit");
      return store.saveDraft(
        actor(request),
        request.params.id,
        request.body.expectedRevision,
        d,
        request.body.confirmDirectEdit,
      );
    },
  );
  app.post<{ Body: { language: string; code: string } }>(
    "/api/functions",
    {
      schema: {
        body: Type.Object(
          {
            language: Type.Literal("python"),
            code: Type.String({ maxLength: limits.sourceBytes }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      actor(request);
      return discoverPython(request.body.code, config.root, config.python);
    },
  );
  app.post<{
    Body: {
      branchId: string;
      expectedRevision: number;
      draft: Draft;
      idempotencyKey: string;
    };
  }>(
    "/api/runs",
    {
      schema: {
        body: Type.Object(
          {
            branchId: Id,
            expectedRevision: Type.Integer({ minimum: 0 }),
            draft: DraftSchema,
            idempotencyKey: Key,
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      checkDraft(request.body.draft);
      if (
        !(config.languages ?? ["python", "cpp"]).includes(
          request.body.draft.language,
        )
      )
        throw new ApiError(
          400,
          "This language is not enabled on this deployment",
        );
      if (!request.body.draft.code.trim())
        throw new ApiError(400, "Enter a program before running");
      if (
        config.executionMode !== "docker" &&
        actor(request).role === "student"
      )
        throw new ApiError(
          403,
          "Student execution requires the isolated runtime",
        );
      return store.createRun(
        actor(request),
        request.body.branchId,
        request.body.draft,
        request.body.expectedRevision,
        request.body.idempotencyKey,
      );
    },
  );
  app.get<{ Params: { id: string }; Querystring: { before?: string } }>(
    "/api/workspaces/:id/runs",
    {
      schema: {
        params: Type.Object({ id: Id }),
        querystring: Type.Object(
          { before: Type.Optional(Id) },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => ({
      runs: await store.listRuns(
        actor(request),
        request.params.id,
        request.query.before,
      ),
    }),
  );
  app.get<{ Params: { id: string } }>(
    "/api/runs/:id",
    { schema: { params: Type.Object({ id: Id }) } },
    async (request) => {
      const a = actor(request),
        run = await store.getRun(a, request.params.id),
        artifact = await store.artifact(a, run.id);
      if (artifact) {
        const result = await artifacts.get(
          artifact.storage_key,
          artifact.sha256,
        );
        return {
          ...run,
          result: {
            ...result,
            outcome: run.outcome ?? result.outcome,
            complete: run.outcome === "completed",
          },
        };
      }
      return run;
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/runs/:id/attempts",
    { schema: { params: Type.Object({ id: Id }) } },
    async (request) => ({
      attempts: await store.attempts(actor(request), request.params.id),
    }),
  );
  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/cancel",
    { schema: { params: Type.Object({ id: Id }) } },
    async (request) => store.cancelRun(actor(request), request.params.id),
  );
  app.get<{ Params: { id: string } }>(
    "/api/snapshots/:id",
    { schema: { params: Type.Object({ id: Id }) } },
    async (request) => store.getSnapshot(actor(request), request.params.id),
  );
  app.post<{
    Body: {
      workerId: string;
      runtime: string;
      languages: string[];
      runtimeImages?: Record<string, string>;
      watchdogScope?: "host" | "container";
    };
  }>(
    "/internal/worker/claim",
    {
      schema: {
        body: Type.Object(
          {
            workerId: Type.String({ minLength: 1, maxLength: 120 }),
            watchdogScope: Type.Optional(
              Type.Union([Type.Literal("host"), Type.Literal("container")]),
            ),
            runtimeImages: Type.Optional(
              Type.Record(Type.String(), Type.String({ maxLength: 200 }), {
                maxProperties: 2,
              }),
            ),
            runtime: Type.Union([
              Type.Literal("docker"),
              Type.Literal("local-inspected"),
            ]),
            languages: Type.Array(
              Type.Union([Type.Literal("python"), Type.Literal("cpp")]),
              { minItems: 1, maxItems: 2 },
            ),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      if (request.body.runtime !== config.executionMode)
        throw new ApiError(
          403,
          "Worker runtime does not match the configured execution policy",
        );
      if (!config.localAuth && request.body.watchdogScope !== "host")
        throw new ApiError(
          403,
          "Hosted execution requires an independent host watchdog",
        );
      await store.reapLeases();
      return {
        job: await store
          .claim(
            request.body.workerId,
            request.body.runtime,
            request.body.languages,
            request.body.runtimeImages,
          )
          .then((job) => job),
      };
    },
  );
  app.post<{
    Body: { attemptId: string; leaseToken: string; started: boolean };
  }>(
    "/internal/worker/heartbeat",
    {
      schema: {
        body: Type.Object(
          { attemptId: Id, leaseToken: Key, started: Type.Boolean() },
          { additionalProperties: false },
        ),
      },
    },
    async (request) =>
      store.heartbeat(
        request.body.attemptId,
        request.body.leaseToken,
        request.body.started,
      ),
  );
  app.post<{
    Body: {
      attemptId: string;
      leaseToken: string;
      result: TraceResult;
      metrics: Record<string, number>;
    };
  }>(
    "/internal/worker/complete",
    {
      bodyLimit: 20 * 1024 * 1024,
      schema: {
        body: Type.Object(
          {
            attemptId: Id,
            leaseToken: Key,
            result: ResultSchema,
            metrics: Type.Record(
              Type.String({ maxLength: 100 }),
              Type.Number({ minimum: 0 }),
              { maxProperties: 20 },
            ),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      const { attemptId, leaseToken, result, metrics } = request.body;
      if (!resultCheck.Check(result))
        throw new ApiError(400, "Invalid execution trace");
      for (let i = 0; i < result.steps.length; i++)
        if (result.steps[i]!.index !== i)
          throw new ApiError(400, "Trace steps are out of sequence");
      const source = await store.attemptSource(attemptId, leaseToken);
      const invalid = traceValidationError(result, source);
      if (invalid) throw new ApiError(400, invalid);
      const writeStarted = performance.now();
      const artifact = await artifacts.put(attemptId, result);
      metrics.artifactWriteMs = performance.now() - writeStarted;
      try {
        return await store.complete(
          attemptId,
          leaseToken,
          result,
          artifact,
          metrics,
        );
      } catch (error) {
        await artifacts.remove(artifact.key);
        throw error;
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/runs/:id/export",
    { schema: { params: Type.Object({ id: Id }) } },
    async (request, reply) => {
      const a = actor(request),
        run = await store.getRun(a, request.params.id),
        artifact = await store.artifact(a, run.id);
      if (!artifact)
        throw new ApiError(409, "This run does not have a captured trace yet");
      reply.header(
        "Content-Disposition",
        `attachment; filename="debugroom-run-${run.id}.json"`,
      );
      const result = await artifacts.get(artifact.storage_key, artifact.sha256);
      return {
        format: "debugroom-run",
        version: 1,
        run,
        result: {
          ...result,
          outcome: run.outcome,
          complete: run.outcome === "completed",
        },
      };
    },
  );
  registerOperations(app, store);
  await registerCollaboration(app, store, config, artifacts);
  if (config.serveStatic) {
    await app.register(staticFiles, {
      root: path.join(config.root, "apps/web/dist"),
      prefix: "/",
      wildcard: false,
    });
    app.setNotFoundHandler(async (request, reply) => {
      if (
        request.url.startsWith("/api/") ||
        request.url.startsWith("/internal/")
      )
        return reply.code(404).send({ error: { message: "Not found" } });
      return reply.sendFile("index.html");
    });
  }
  return app;
}
