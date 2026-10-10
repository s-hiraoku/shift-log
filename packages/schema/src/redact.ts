/**
 * Redaction for free text that collectors read from the OS (window titles,
 * terminal commands, file paths). Titles can carry secrets — a terminal title
 * shows the running command, so `export OPENAI_API_KEY=sk-...` lands in it —
 * and personal data such as email addresses or phone numbers.
 *
 * Both collectors and the API apply this, so memories, the LLM prompt, and
 * logs never see the original strings.
 */

export const REDACTED = "[redacted]";

type Rule = { pattern: RegExp; replace: string | ((match: string, ...groups: string[]) => string) };

/** Names whose value is a secret when written as NAME=value or NAME: value. */
const SECRET_NAME =
  "[A-Za-z0-9_.-]*(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|credential|authorization|cookie)[A-Za-z0-9_.-]*";

const RULES: Rule[] = [
  // PEM blocks
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    replace: REDACTED,
  },
  // Credentials embedded in URLs: scheme://user:pass@host
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
    replace: (_m, scheme: string) => `${scheme}${REDACTED}@`,
  },
  // Authorization headers and bearer tokens
  {
    pattern: /\b(Bearer|Basic|Token)\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (_m, kind: string) => `${kind} ${REDACTED}`,
  },
  // NAME=value / NAME: value / --name value / --name=value for secret-like names
  {
    pattern: new RegExp(
      `((?:--?)?${SECRET_NAME}["']?\\s*(?:=|:\\s|\\s(?=["']))\\s*)(?:"[^"]*"|'[^']*'|[^\\s"'&;,)]+)`,
      "gi",
    ),
    replace: (_m, head: string) => `${head}${REDACTED}`,
  },
  {
    pattern: new RegExp(`(--${SECRET_NAME}\\s+)(?!-)[^\\s"'&;]+`, "gi"),
    replace: (_m, head: string) => `${head}${REDACTED}`,
  },
  // Well-known token formats
  { pattern: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/g, replace: REDACTED },
  { pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, replace: REDACTED },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, replace: REDACTED },
  { pattern: /\bglpat-[A-Za-z0-9_-]{16,}/g, replace: REDACTED },
  { pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, replace: REDACTED },
  { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replace: REDACTED },
  { pattern: /\bAIza[A-Za-z0-9_-]{30,}/g, replace: REDACTED },
  { pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g, replace: REDACTED },
  { pattern: /\bnpm_[A-Za-z0-9]{30,}/g, replace: REDACTED },
  // JWT
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: REDACTED },
  // Query strings carry tokens and personal data; keep only the path.
  { pattern: /(\bhttps?:\/\/[^\s?#]+)[?#][^\s]*/gi, replace: (_m, base: string) => base },
  // Email addresses
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replace: "[email]" },
  // Card numbers (13–19 digits, optional separators)
  { pattern: /\b(?:\d[ -]?){12,18}\d\b/g, replace: "[number]" },
  // Phone numbers (international or Japanese style)
  {
    pattern: /(?:\+\d{1,3}[ -]?)?\(?0\d{1,4}\)?-\d{1,4}-\d{3,4}\b|\+\d{1,3}[ -]?\d{2,4}[ -]?\d{3,4}[ -]?\d{3,4}\b/g,
    replace: "[phone]",
  },
  // Long opaque tokens: 32+ chars mixing letters and digits (hex keys, base64 secrets)
  {
    pattern: /(?<![A-Za-z0-9/._-])(?=[A-Za-z0-9_+/=-]*\d)(?=[A-Za-z0-9_+/=-]*[A-Za-z])[A-Za-z0-9_+/=-]{32,}(?![A-Za-z0-9/._-])/g,
    replace: REDACTED,
  },
];

/** Replace secrets and personal identifiers in free text. */
export function redactSensitiveText(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, rule.replace as (substring: string, ...args: string[]) => string);
  }
  return out;
}

/**
 * Apps whose window titles name vault items, accounts, or keys.
 * Their events keep only the app name, regardless of title_policy.
 */
const SENSITIVE_APPS = [
  "1password",
  "1password 7",
  "1password 8",
  "bitwarden",
  "dashlane",
  "lastpass",
  "keepassxc",
  "keepass",
  "enpass",
  "proton pass",
  "keychain access",
  "キーチェーンアクセス",
  "passwords",
  "パスワード",
  "seahorse",
  "gnome-keyring",
  "kwalletmanager",
];

export function isSensitiveApp(app: string): boolean {
  const normalized = app.trim().toLowerCase();
  return SENSITIVE_APPS.includes(normalized);
}

const PRIVATE_WINDOW_MARKERS =
  /(?:\bincognito\b|\binprivate\b|private browsing|privates surfen|navigation privée|navegación privada|シークレット|プライベートブラウズ|プライベート\s*ブラウジング)/i;

/** Browser apps whose window titles may mark a private window. */
export function isBrowserApp(app: string): boolean {
  return /\b(?:chrome|chromium|firefox|safari|edge|brave|vivaldi|opera|arc|orion)\b/i.test(app);
}

/** True when a browser window title says it is a private / incognito window. */
export function titleLooksPrivate(title: string): boolean {
  return PRIVATE_WINDOW_MARKERS.test(title);
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactValue(v)]),
    );
  }
  return value;
}

/** Redact every free-text field of an interaction event. */
export function redactEvent<
  E extends { summary?: string; urlPath?: string; shortcut?: string; meta?: Record<string, unknown> },
>(event: E): E {
  const next = { ...event };
  if (typeof next.summary === "string") next.summary = redactSensitiveText(next.summary);
  if (typeof next.urlPath === "string") next.urlPath = redactSensitiveText(next.urlPath.split(/[?#]/)[0]!);
  if (next.meta) next.meta = redactValue(next.meta) as Record<string, unknown>;
  return next;
}
