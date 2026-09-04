/**
 * Web build: browser calls stay same-origin (`/api/...`) and the Next.js
 * route handler injects SHIFTLOG_API_TOKEN server-side, so the bearer
 * credential never ships in the client bundle.
 *
 * Desktop build (Tauri static export): there is no server proxy, so calls go
 * to the API origin directly. `NEXT_PUBLIC_SHIFTLOG_API_BASE` and
 * `NEXT_PUBLIC_SHIFTLOG_API_TOKEN` are baked in at build time.
 * NOTE: embedding a token in the bundle is acceptable only for the
 * unsigned dev PoC. Production desktop builds should hold the token in the
 * Tauri (Rust) layer / OS keychain and proxy requests through a command.
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_SHIFTLOG_API_BASE ?? "/api";

const API_TOKEN = process.env.NEXT_PUBLIC_SHIFTLOG_API_TOKEN;

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (API_TOKEN && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${API_TOKEN}`);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}
