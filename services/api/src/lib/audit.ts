/**
 * Structured audit log. Never write bearer tokens or raw event payloads.
 */
export function audit(event: {
  type: string;
  userId?: string;
  method?: string;
  path?: string;
  status?: number;
  ms?: number;
  extra?: Record<string, string | number | boolean | null>;
}): void {
  const line = {
    ts: new Date().toISOString(),
    service: "shift-log-api",
    ...event,
  };
  console.log(JSON.stringify(line));
}
