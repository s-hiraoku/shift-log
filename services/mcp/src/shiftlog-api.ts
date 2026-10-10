import type { ContinueContextRequest, MemoryKind } from "@shift-log/schema";
import type { z } from "zod";
import type { ApiToken } from "./config.js";

export type MemoryListQuery = {
  q?: string;
  limit: number;
  kind?: MemoryKind;
  since?: string;
  until?: string;
};

/**
 * Every request this server can send upstream. Paths are literals.
 * POST /v1/windows, PUT /v1/permissions, POST /v1/history/delete, and
 * POST /v1/demo/seed have no spelling here.
 */
export type ReadOnlyCall =
  | { method: "GET"; path: "/v1/agent/recent"; query: { limit: number } }
  | { method: "GET"; path: "/v1/timeline"; query: MemoryListQuery }
  | { method: "GET"; path: "/v1/search"; query: MemoryListQuery }
  | { method: "GET"; path: "/v1/memories/:id"; id: string }
  | { method: "POST"; path: "/v1/agent/continue"; body: ContinueContextRequest };

export type ApiFailure =
  | { reason: "unreachable"; origin: string }
  | { reason: "credentials_rejected" }
  | { reason: "not_found" }
  | { reason: "rate_limited" }
  | { reason: "upstream_error"; status: number; detail: string }
  | { reason: "bad_response"; detail: string };

export type ApiOutcome<T> = { ok: true; value: T } | { ok: false; failure: ApiFailure };

export type CallShiftLog = <T>(
  call: ReadOnlyCall,
  response: z.ZodType<T>,
) => Promise<ApiOutcome<T>>;

const UPSTREAM_TIMEOUT_MS = 10_000;

export function connectShiftLog(config: {
  apiOrigin: string;
  apiToken: ApiToken;
}): CallShiftLog {
  return async (call, response) => {
    const url = upstreamUrl(config.apiOrigin, call);
    try {
      const init: RequestInit = {
        method: call.method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.apiToken}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      };
      if (call.method === "POST") {
        init.headers = {
          ...init.headers,
          "content-type": "application/json",
        };
        init.body = JSON.stringify(call.body);
      }
      const res = await fetch(url, init);
      if (res.status === 401) return { ok: false, failure: { reason: "credentials_rejected" } };
      if (res.status === 404) return { ok: false, failure: { reason: "not_found" } };
      if (res.status === 429) return { ok: false, failure: { reason: "rate_limited" } };
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        return { ok: false, failure: { reason: "upstream_error", status: res.status, detail } };
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        return { ok: false, failure: { reason: "bad_response", detail: "body was not JSON" } };
      }
      const parsed = response.safeParse(json);
      if (!parsed.success) {
        return {
          ok: false,
          failure: { reason: "bad_response", detail: "response did not match the tool schema" },
        };
      }
      return { ok: true, value: parsed.data };
    } catch {
      return { ok: false, failure: { reason: "unreachable", origin: config.apiOrigin } };
    }
  };
}

function upstreamUrl(origin: string, call: ReadOnlyCall): URL {
  const path =
    call.path === "/v1/memories/:id"
      ? `/v1/memories/${encodeURIComponent(call.id)}`
      : call.path;
  const url = new URL(path, origin);
  if (call.method === "GET" && call.path !== "/v1/memories/:id") {
    for (const [key, value] of Object.entries(call.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url;
}
