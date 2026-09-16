const MISSING_TOKEN_MESSAGE =
  "SHIFTLOG_API_TOKEN must be set. Refusing to proxy with an implicit token (fail-closed).";

export function resolveBffApiToken(
  env: NodeJS.Dict<string | undefined> = process.env,
): { token: string } | { error: string } {
  const token = env.SHIFTLOG_API_TOKEN;
  if (token) return { token };
  if (env.SHIFTLOG_ALLOW_INSECURE_DEV === "1") return { token: "dev-token" };
  return { error: MISSING_TOKEN_MESSAGE };
}
