import { MemoryRecordSchema, type MemoryEntity, type MemoryRecord, type WindowUpload } from "@shift-log/schema";
import { CASES, type EvalCase } from "./cases.js";

/**
 * Programmatic graders for the ten-minute summary. Each metric is an atomic,
 * checkable claim about the stored memory, so a grade can be traced to one rule:
 *
 * - schema:   the memory record validates and the title is 1–120 chars
 * - grounded: no app, URL, or entity that the (sanitized) window does not contain
 * - private:  nothing the sanitizer dropped, and no claim of screenshots/keystrokes
 * - topical:  the title or summary names what the window was about
 * - entities: recall of the human-listed entities (float)
 * - continuity: with a previous memory, a continuation cue (続き/引き続き/継続) appears
 *               exactly when the window continues that work. Only meaningful on
 *               continuation cases; 1 elsewhere. A cue-word check is rough on purpose.
 * - llm_used: the stored memory carries the LLM summary, not only the fallback
 *
 * `pass` (the headline) is schema ∧ grounded ∧ private ∧ topical.
 */
export const METRICS = [
  { id: "pass", label: "pass", kind: "binary" },
  { id: "topical", label: "topical", kind: "binary" },
  { id: "grounded", label: "grounded", kind: "binary" },
  { id: "private", label: "private", kind: "binary" },
  { id: "schema", label: "schema", kind: "binary" },
  { id: "entities", label: "entity recall", kind: "float", scale: 1 },
  { id: "continuity", label: "continuity", kind: "binary" },
  { id: "llm_used", label: "llm used", kind: "binary" },
] as const;

export type Grade = Record<(typeof METRICS)[number]["id"], number>;

/** Claims the README promises ShiftLog never makes. */
const FORBIDDEN_CLAIMS =
  /スクリーンショット|スクショ|画面録画|キーログ|打鍵内容|入力内容を|入力した文字|プライベートブラウズ|シークレットウィンドウ|screenshot|keystroke/i;

const CONTINUATION_CUE = /続き|引き続き|継続|続けて|再開/;

/** App names a model could invent; aliases map what a summary might say to the app id. */
const APP_ALIASES: Record<string, string[]> = {
  "Google Chrome": ["Chrome"],
  "zoom.us": ["Zoom"],
  ghostty: ["Ghostty"],
};
const EXTRA_APPS = [
  "Xcode",
  "Terminal",
  "iTerm",
  "Teams",
  "Discord",
  "Excel",
  "Word",
  "PowerPoint",
  "Firefox",
  "Arc",
  "LINE",
  "Spotify",
  "Photoshop",
  "Linear",
  "Jira",
  "Cursor",
];

function knownApps(): Map<string, string[]> {
  const names = new Set<string>(EXTRA_APPS);
  for (const c of CASES) for (const e of c.upload.events) if (e.app) names.add(e.app);
  // GitHub and YouTube are also sites; naming them is not an invented app.
  names.delete("GitHub");
  const out = new Map<string, string[]>();
  for (const name of names) out.set(name, [name, ...(APP_ALIASES[name] ?? [])]);
  return out;
}
const KNOWN_APPS = knownApps();

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(text: string, word: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRe(word)}($|[^A-Za-z0-9])`).test(text);
}

function haystack(upload: WindowUpload, c: EvalCase): string {
  const parts: string[] = [];
  for (const e of upload.events) {
    parts.push(e.app ?? "", e.summary ?? "", e.site ?? "", e.urlPath ?? "");
    if (e.meta) parts.push(JSON.stringify(e.meta));
  }
  if (c.previous) parts.push(c.previous.title, c.previous.body);
  return parts.join("\n");
}

function entityGrounded(entity: MemoryEntity, hay: string): boolean {
  if (entity.kind === "github_pr") {
    const m = entity.value.match(/^(.+)#(\d+)$/);
    if (!m) return false;
    return hay.includes(m[1]!) && (hay.includes(`/pull/${m[2]}`) || hay.includes(`#${m[2]}`));
  }
  return hay.includes(entity.value);
}

/** Text a reader of the memory sees as the summary: title, description, and the LLM sections. */
export function summaryText(record: MemoryRecord): string {
  return [record.front_matter.title, record.front_matter.description].join("\n");
}

export function gradeCase(
  c: EvalCase,
  record: MemoryRecord,
  sanitized: WindowUpload,
): { grade: Grade; explanation: Record<string, string> } {
  const explanation: Record<string, string> = {};
  const text = summaryText(record);
  const full = [text, record.body].join("\n");
  const hay = haystack(sanitized, c);
  const inputApps = new Set(sanitized.events.map((e) => e.app).filter(Boolean) as string[]);

  const parsed = MemoryRecordSchema.safeParse(record);
  const titleOk = record.front_matter.title.length >= 1 && record.front_matter.title.length <= 120;
  const schema = parsed.success && titleOk ? 1 : 0;
  if (!schema) explanation.schema = parsed.success ? "title length out of 1–120" : parsed.error.message;

  const ungrounded: string[] = [];
  for (const [app, names] of KNOWN_APPS) {
    if (inputApps.has(app)) continue;
    for (const name of names) if (mentions(text, name)) ungrounded.push(`app:${name}`);
  }
  for (const url of text.match(/https?:\/\/[^\s)）]+/g) ?? []) {
    if (!hay.includes(url)) ungrounded.push(`url:${url}`);
  }
  for (const entity of record.front_matter.entities ?? []) {
    if (!entityGrounded(entity, hay)) ungrounded.push(`${entity.kind}:${entity.value}`);
  }
  const grounded = ungrounded.length === 0 ? 1 : 0;
  if (!grounded) explanation.grounded = `not in window: ${ungrounded.join(", ")}`;

  const leaks = c.expect.forbidden.filter((s) => full.toLowerCase().includes(s.toLowerCase()));
  const claim = full.match(FORBIDDEN_CLAIMS)?.[0];
  const priv = leaks.length === 0 && !claim ? 1 : 0;
  if (!priv) explanation.private = [...leaks, ...(claim ? [`claim:${claim}`] : [])].join(", ");

  const lower = text.toLowerCase();
  const topical = c.expect.topics.some((t) => lower.includes(t.toLowerCase())) ? 1 : 0;
  if (!topical) explanation.topical = `none of: ${c.expect.topics.join(" / ")}`;

  const got = record.front_matter.entities ?? [];
  const found = c.expect.entities.filter((e) =>
    got.some((g) => g.kind === e.kind && g.value === e.value),
  );
  const entities = c.expect.entities.length === 0 ? 1 : found.length / c.expect.entities.length;
  if (entities < 1) {
    const missing = c.expect.entities.filter((e) => !found.includes(e));
    explanation.entities = `missing: ${missing.map((e) => `${e.kind}:${e.value}`).join(", ")}`;
  }

  let continuity = 1;
  if (c.previous && c.expect.same_work !== undefined) {
    const cue = CONTINUATION_CUE.test(text);
    continuity = cue === c.expect.same_work ? 1 : 0;
    if (!continuity) {
      explanation.continuity = c.expect.same_work
        ? "same work as previous, but no continuation cue"
        : "different work, but written as a continuation";
    }
  }

  const llm_used = record.body.startsWith("## 要約") ? 1 : 0;
  const pass = schema && grounded && priv && topical ? 1 : 0;

  return {
    grade: { pass, topical, grounded, private: priv, schema, entities, continuity, llm_used },
    explanation,
  };
}
