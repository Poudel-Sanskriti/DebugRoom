import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import { fastifyOauth2 as oauthPlugin } from "@fastify/oauth2";
import { Store } from "./store.ts";
import { Collaboration } from "./collaboration.ts";
import type { Artifacts } from "./artifacts.ts";
import { ApiError } from "./errors.ts";
import type { AppConfig } from "./app.ts";

const Id = Type.String({ format: "uuid" }),
  Params = Type.Object({ id: Id });
const actor = (request: FastifyRequest) => {
  if (!request.actor) throw new ApiError(401, "Sign in to continue");
  return request.actor;
};
export async function registerCollaboration(
  app: FastifyInstance,
  store: Store,
  config: AppConfig,
  artifacts: Artifacts,
) {
  const collab = new Collaboration(store, artifacts);
  const secure = new URL(config.origin).protocol === "https:";
  const cookieName = secure ? "__Host-debugroom_session" : "debugroom_session";
  const options = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 7 * 86400,
  };
  if (config.github) {
    await app.register(oauthPlugin, {
      name: "oauth2Github",
      scope: ["read:user"],
      credentials: {
        client: config.github,
        auth: oauthPlugin.GITHUB_CONFIGURATION,
      },
      startRedirectPath: "/api/auth/github",
      callbackUri: `${config.origin}/api/auth/github/callback`,
      cookie: { secure, httpOnly: true, sameSite: "lax", path: "/" },
      pkce: "S256",
    });
    app.get("/api/auth/github/callback", async function (request, reply) {
      const exchange = await (
        this as any
      ).githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(request, reply);
      const response = await fetch("https://api.github.com/user", {
        headers: {
          authorization: `Bearer ${exchange.token.access_token}`,
          accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        throw new ApiError(502, "GitHub identity could not be verified");
      const profile = (await response.json()) as {
        id?: number;
        login?: string;
        name?: string;
      };
      if (!profile.id || !profile.login)
        throw new ApiError(502, "GitHub identity was incomplete");
      const tutor = await store.tutor(
        `github:${profile.id}`,
        (profile.name || profile.login).slice(0, 120),
      );
      const session = await store.createSession(tutor, null);
      reply.setCookie(cookieName, session.secret, options);
      return reply.redirect(config.origin);
    });
  }
  app.post<{ Params: { id: string }; Body: { snapshotId?: string } }>(
    "/api/workspaces/:id/mentor-copy",
    {
      schema: {
        params: Params,
        body: Type.Object(
          { snapshotId: Type.Optional(Id) },
          { additionalProperties: false },
        ),
      },
    },
    async (request) =>
      collab.createMentorCopy(
        actor(request),
        request.params.id,
        request.body.snapshotId,
      ),
  );
  app.post<{ Params: { id: string } }>(
    "/api/workspaces/:id/invitations",
    { schema: { params: Params } },
    async (request) => {
      const invitation = await collab.invite(actor(request), request.params.id);
      return {
        ...invitation,
        url: `${config.origin}/join#invite=${invitation.token}`,
      };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/workspaces/:id/invitations/revoke",
    { schema: { params: Params } },
    async (request) => collab.revoke(actor(request), request.params.id),
  );
  app.post<{ Body: { token: string } }>(
    "/api/invitations/redeem",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        body: Type.Object(
          { token: Type.String({ minLength: 32, maxLength: 100 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const redeemed = await collab.redeem(request.body.token);
      reply.setCookie(cookieName, redeemed.secret, options);
      return { workspaceId: redeemed.workspaceId };
    },
  );
  app.post<{
    Params: { id: string };
    Body: {
      branchId: string;
      kind: "full" | "selection" | "hint";
      title: string;
      body: string;
      snapshotId?: string;
      startLine?: number;
      endLine?: number;
    };
  }>(
    "/api/workspaces/:id/shares",
    {
      schema: {
        params: Params,
        body: Type.Object(
          {
            branchId: Id,
            kind: Type.Union([
              Type.Literal("full"),
              Type.Literal("selection"),
              Type.Literal("hint"),
            ]),
            title: Type.String({ minLength: 1, maxLength: 120 }),
            body: Type.String({ maxLength: 10000 }),
            snapshotId: Type.Optional(Id),
            startLine: Type.Optional(Type.Integer({ minimum: 1 })),
            endLine: Type.Optional(Type.Integer({ minimum: 1 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) =>
      collab.share(actor(request), request.params.id, request.body),
  );
  app.get<{ Params: { id: string } }>(
    "/api/workspaces/:id/shares",
    { schema: { params: Params } },
    async (request) => ({
      shares: await collab.shares(actor(request), request.params.id),
    }),
  );
  app.post<{ Params: { id: string }; Body: { line: number; body: string } }>(
    "/api/snapshots/:id/comments",
    {
      schema: {
        params: Params,
        body: Type.Object(
          {
            line: Type.Integer({ minimum: 1 }),
            body: Type.String({ minLength: 1, maxLength: 10000 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) =>
      collab.addComment(
        actor(request),
        request.params.id,
        request.body.line,
        request.body.body,
      ),
  );
  app.get<{ Params: { id: string } }>(
    "/api/workspaces/:id/comments",
    { schema: { params: Params } },
    async (request) => ({
      comments: await collab.comments(actor(request), request.params.id),
    }),
  );
  app.get<{ Params: { id: string } }>(
    "/api/branches/:id/notes",
    { schema: { params: Params } },
    async (request) => collab.notes(actor(request), request.params.id),
  );
  app.put<{
    Params: { id: string };
    Body: { hypothesis: string; conclusion: string; expectedRevision: number };
  }>(
    "/api/branches/:id/notes",
    {
      schema: {
        params: Params,
        body: Type.Object(
          {
            hypothesis: Type.String({ maxLength: 10000 }),
            conclusion: Type.String({ maxLength: 10000 }),
            expectedRevision: Type.Integer({ minimum: 0 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) =>
      collab.saveNotes(
        actor(request),
        request.params.id,
        request.body.hypothesis,
        request.body.conclusion,
        request.body.expectedRevision,
      ),
  );
  app.get<{ Params: { id: string } }>(
    "/api/branches/:id/test-cases",
    { schema: { params: Params } },
    async (request) => ({
      testCases: await collab.testCases(actor(request), request.params.id),
    }),
  );
  app.post<{
    Params: { id: string };
    Body: { name: string; input: string; expected: string };
  }>(
    "/api/branches/:id/test-cases",
    {
      schema: {
        params: Params,
        body: Type.Object(
          {
            name: Type.String({ minLength: 1, maxLength: 120 }),
            input: Type.String({ maxLength: 65536 }),
            expected: Type.String({ maxLength: 10000 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      try {
        JSON.parse(request.body.input);
      } catch {
        throw new ApiError(400, "Regression input must be valid JSON");
      }
      return collab.addTestCase(
        actor(request),
        request.params.id,
        request.body.name,
        request.body.input,
        request.body.expected,
      );
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/workspaces/:id/snapshots",
    { schema: { params: Params } },
    async (request) => ({
      versions: await collab.preservedVersions(
        actor(request),
        request.params.id,
      ),
    }),
  );
  app.get<{ Params: { id: string } }>(
    "/api/workspaces/:id/export",
    { schema: { params: Params } },
    async (request, reply) => {
      reply.header(
        "Content-Disposition",
        `attachment; filename="debugroom-${request.params.id}.json"`,
      );
      const exported = await collab.exportWorkspace(
        actor(request),
        request.params.id,
      );
      if (Buffer.byteLength(JSON.stringify(exported)) > 32 * 1024 * 1024)
        throw new ApiError(
          413,
          "This workspace export is too large. Export individual run traces instead.",
        );
      return exported;
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/workspaces/:id",
    { schema: { params: Params } },
    async (request) =>
      collab.deleteWorkspace(actor(request), request.params.id),
  );
}
