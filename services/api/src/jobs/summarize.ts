import type { InteractionEvent, MemoryRecord, WindowUpload } from "@shift-log/schema";
import { serializeMemoryMarkdown } from "@shift-log/schema";
import type { MemoryStore } from "../lib/store.js";
import { summarizeWithLlm } from "./llm.js";
import { aggregateTenMinuteWindow, renderTenMinuteBody } from "./ten-minute.js";

function uniqueApps(events: InteractionEvent[]): string[] {
  return [...new Set(events.map((e) => e.app).filter((a): a is string => Boolean(a)))];
}

function deviceLabel(devices: string[]): "desk" | "mobile" | "both" {
  const hasDesk = devices.includes("desk");
  const hasMobile = devices.includes("mobile");
  if (hasDesk && hasMobile) return "both";
  if (hasMobile) return "mobile";
  return "desk";
}

function detectSkillCandidate(events: InteractionEvent[]): {
  skill_candidate: boolean;
  skill_candidate_reason?: string;
} {
  const apps = uniqueApps(events);
  const switches = events.filter((e) => e.type === "app_switch").length;
  if (switches >= 4 && apps.length <= 2) {
    return {
      skill_candidate: true,
      skill_candidate_reason: "Repeated app switching within a narrow app set",
    };
  }
  return { skill_candidate: false };
}

export function deterministicTenMinuteBody(upload: WindowUpload): {
  title: string;
  body: string;
  apps: string[];
  skill: ReturnType<typeof detectSkillCandidate>;
  aggregate: ReturnType<typeof aggregateTenMinuteWindow>;
} {
  const apps = uniqueApps(upload.events);
  const skill = detectSkillCandidate(upload.events);
  const aggregate = aggregateTenMinuteWindow(upload);
  const title =
    apps.length > 0
      ? `${apps.slice(0, 2).join(" / ")} — 10分サマリ`
      : "Activity — 10分サマリ";
  return {
    title,
    body: renderTenMinuteBody(aggregate, skill),
    apps,
    skill,
    aggregate,
  };
}

export async function summarizeTenMinuteWindow(
  store: MemoryStore,
  upload: WindowUpload,
): Promise<MemoryRecord> {
  const { metadata, events } = upload;
  const fallback = deterministicTenMinuteBody(upload);
  const llm = await summarizeWithLlm(upload);
  const title = llm?.title ?? fallback.title;
  const body = llm?.body ?? fallback.body;
  const { apps, skill, aggregate } = fallback;
  const now = new Date().toISOString();

  const record: MemoryRecord = {
    id: `mem_${metadata.window_id}`,
    created_at: now,
    updated_at: now,
    front_matter: {
      title,
      description: `${events.length} events across ${apps.length || 0} apps`,
      apps,
      device: deviceLabel(metadata.devices),
      window_start: metadata.window_start,
      window_end: metadata.window_end,
      kind: "ten_minute",
      window_ids: [metadata.window_id],
      skill_candidate: skill.skill_candidate,
      skill_candidate_reason: skill.skill_candidate_reason,
      apps_dwell: aggregate.apps_dwell,
      sites: aggregate.sites,
      top_app: aggregate.top_app,
    },
    body,
  };

  store.putMemory(record);
  return record;
}

export function sixHourBucketUtc(iso: string): { start: string; end: string } {
  const t = new Date(iso);
  const hour = Math.floor(t.getUTCHours() / 6) * 6;
  const start = new Date(
    Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), hour, 0, 0, 0),
  );
  const end = new Date(start.getTime() + 6 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function sixHourMemoryId(bucketStart: string): string {
  return `mem_6h_${bucketStart}`;
}

export function summarizeSixHourBundle(
  store: MemoryStore,
  tenMinuteIds: string[],
  bucket: { start: string; end: string },
): MemoryRecord | null {
  const memories = tenMinuteIds
    .map((id) => store.getMemory(id))
    .filter((m): m is MemoryRecord => Boolean(m));

  if (memories.length === 0) return null;

  const apps = [...new Set(memories.flatMap((m) => m.front_matter.apps))];
  const devices = new Set(memories.map((m) => m.front_matter.device));
  const device =
    devices.has("both") || (devices.has("desk") && devices.has("mobile"))
      ? "both"
      : devices.has("mobile")
        ? "mobile"
        : "desk";

  const now = new Date().toISOString();
  const id = sixHourMemoryId(bucket.start);
  const existing = store.getMemory(id);
  const body = [
    "## 六時間サマリ",
    "",
    `壁時計 ${bucket.start} → ${bucket.end} の十分サマリ ${memories.length} 本。`,
    "",
    ...memories.map((m) => `- **${m.front_matter.title}**: ${m.front_matter.description}`),
  ].join("\n");

  const record: MemoryRecord = {
    id,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    front_matter: {
      title: "六時間サマリ",
      description: `${memories.length} ten-minute windows`,
      apps,
      device,
      window_start: bucket.start,
      window_end: bucket.end,
      kind: "six_hour",
      window_ids: memories.flatMap((m) => m.front_matter.window_ids),
      skill_candidate: memories.some((m) => m.front_matter.skill_candidate),
      skill_candidate_reason: memories.find((m) => m.front_matter.skill_candidate)
        ?.front_matter.skill_candidate_reason,
    },
    body,
  };

  store.putMemory(record);
  return record;
}

export function memoryAsMarkdown(store: MemoryStore, id: string): string | null {
  const record = store.getMemory(id);
  if (!record) return null;
  return serializeMemoryMarkdown(record);
}
