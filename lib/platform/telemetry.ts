import { SpanStatusCode, trace as otel } from "@opentelemetry/api";
import type { Session } from "./domain.ts";

const tracer = otel.getTracer("agentgate", "0.2.0");

export async function observed<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  operation: () => Promise<T>,
) {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

// Vendor-neutral OTLP-shaped export of the durable trace already stored in D1.
export function toOtlp(session: Session) {
  const traceId = session.id.replaceAll("-", "").slice(0, 32);
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "agentgate" } },
            { key: "gen_ai.system", value: { stringValue: "ollama" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "agentgate.gateway", version: "0.2.0" },
            spans: session.traces.map((item, index) => {
              const start =
                BigInt(new Date(item.at).getTime()) * BigInt(1_000_000);
              const end =
                start +
                BigInt(Math.max(item.durationMs ?? 0, 1)) * BigInt(1_000_000);
              return {
                traceId,
                spanId: item.id.replaceAll("-", "").slice(0, 16),
                name: item.kind,
                kind: 1,
                startTimeUnixNano: start.toString(),
                endTimeUnixNano: end.toString(),
                attributes: [
                  {
                    key: "agentgate.mode",
                    value: { stringValue: session.mode },
                  },
                  {
                    key: "agentgate.run.id",
                    value: { stringValue: session.id },
                  },
                  {
                    key: "agentgate.sequence",
                    value: { intValue: String(index) },
                  },
                  {
                    key: "agentgate.detail",
                    value: { stringValue: item.detail },
                  },
                ],
                status: { code: 1 },
              };
            }),
          },
        ],
      },
    ],
  };
}
