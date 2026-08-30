export const API_BASE =
  typeof window === "undefined"
    ? process.env.SHIFTLOG_API_ORIGIN ?? "http://localhost:8787"
    : "/api";

export const API_TOKEN =
  process.env.NEXT_PUBLIC_SHIFTLOG_API_TOKEN ??
  process.env.SHIFTLOG_API_TOKEN ??
  "dev-token";

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${API_TOKEN}`);
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
