import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../apps/api/src/config.ts";
export class TestClient {
  cookie = "";
  csrf = "";
  constructor(
    public base: string,
    public origin: string,
  ) {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname))
      throw new Error(
        "This acceptance harness is restricted to local endpoints",
      );
  }
  async request<T = any>(
    url: string,
    method = "GET",
    body?: unknown,
    expected = 200,
  ): Promise<T> {
    const response = await fetch(this.base + url, {
      method,
      headers: {
        origin: this.origin,
        host: new URL(this.base).host,
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.csrf ? { "x-csrf-token": this.csrf } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = response.headers.getSetCookie()[0];
    if (setCookie) this.cookie = setCookie.split(";")[0]!;
    const result = (await response.json()) as T & {
      error?: { message?: string };
    };
    assert.equal(
      response.status,
      expected,
      `${method} ${url}: ${result.error?.message ?? "unexpected status"}`,
    );
    return result as T;
  }
  async localLogin() {
    const key = process.env.DEBUGROOM_TEST_LOCAL_KEY_FILE
      ? (
          await readFile(process.env.DEBUGROOM_TEST_LOCAL_KEY_FILE, "utf8")
        ).trim()
      : (await loadConfig()).localLoginToken;
    await this.request("/api/auth/local", "POST", { token: key });
    await this.session();
  }
  async session() {
    const session = await this.request("/api/session");
    this.csrf = session.csrf;
    return session;
  }
}
export async function waitForRun(
  client: TestClient,
  id: string,
  timeout = 30_000,
) {
  const deadline = Date.now() + timeout;
  let run = await client.request(`/api/runs/${id}`);
  while (run.status !== "finished" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    run = await client.request(`/api/runs/${id}`);
  }
  assert.equal(
    run.status,
    "finished",
    "Run did not finish within the test deadline",
  );
  return run;
}
