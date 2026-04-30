import {
  trace,
  context,
  propagation,
  SpanStatusCode,
  type Span,
} from "@opentelemetry/api";
import {
  NodeTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { FastifyInstance, FastifyRequest } from "fastify";

export function startTelemetry() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return async () => {};
  const url = new URL(endpoint);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("OTLP endpoint must use HTTP or HTTPS");
  if (!url.pathname.endsWith("/v1/traces"))
    url.pathname = url.pathname.replace(/\/$/, "") + "/v1/traces";
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "debugroom-api",
      "service.version": process.env.APP_REVISION ?? "local",
    }),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: url.toString() })),
    ],
  });
  provider.register();
  return () => provider.shutdown();
}
export function instrumentRequests(app: FastifyInstance) {
  const spans = new WeakMap<FastifyRequest, Span>();
  app.addHook("onRequest", async (request) => {
    if (
      request.url.startsWith("/health") ||
      request.url.endsWith("/claim") ||
      request.url.endsWith("/heartbeat")
    )
      return;
    const route = request.routeOptions.url ?? "unmatched";
    const parent = propagation.extract(context.active(), request.headers);
    const span = trace.getTracer("debugroom-api").startSpan(
      `${request.method} ${route}`,
      {
        attributes: {
          "http.request.method": request.method,
          "http.route": route,
          "debugroom.request_id": request.id,
        },
      },
      parent,
    );
    spans.set(request, span);
  });
  app.addHook("onRequestAbort", async (request) => {
    const span = spans.get(request);
    if (span) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "Request aborted",
      });
      span.end();
      spans.delete(request);
    }
  });
  app.addHook("onResponse", async (request, reply) => {
    const span = spans.get(request);
    if (!span) return;
    span.setAttribute("http.response.status_code", reply.statusCode);
    if (reply.statusCode >= 500)
      span.setStatus({ code: SpanStatusCode.ERROR, message: "Request failed" });
    span.end();
    spans.delete(request);
  });
}
