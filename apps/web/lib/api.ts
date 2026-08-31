/**
 * Browser calls stay same-origin (`/api/...`).
 * The Next.js route handler injects SHIFTLOG_API_TOKEN server-side —
 * never ship the bearer credential in the client bundle.
 */
export const API_BASE = "/api";

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}
