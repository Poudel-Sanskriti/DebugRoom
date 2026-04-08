export class ClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = "request_error",
  ) {
    super(message);
  }
}
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T>(
  url: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    signal: options.signal,
    headers: {
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new ClientError(
      payload.error?.message ?? "The request could not be completed",
      response.status,
      payload.error?.code,
    );
  return payload;
}
export type RuntimeConfig = {
  localAuth: boolean;
  githubAuth: boolean;
  executionMode: string;
  languages: string[];
  limits: { warningMs: number; wallMs: number; steps: number };
};
