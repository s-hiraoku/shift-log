import type { InteractionEvent, MemoryRecord, WindowUpload } from "@shift-log/schema";
import { serializeMemoryMarkdown } from "@shift-log/schema";
import type { MemoryStore } from "../lib/store.js";
import { summarizeWithLlm } from "./llm.js";

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
  // Heuristic only — SkillCheck will own real detection later.
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
} {
  const { metadata, events } = upload;
  const apps = uniqueApps(events);
  const skill = detectSkillCandidate(events);
  const byLane = {
    desk: events.filter((e) => e.device === "desk"),
    mobile: events.filter((e) => e.device === "mobile"),
  };
  const lines: string[] = [
    "## 作業サマリ",
    "",
    `- 窓: ${metadata.window_start} → ${metadata.window_end}`,
    `- イベント数: ${events.length}`,
    `- アプリ: ${apps.length ? apps.join(", ") : "(なし)"}`,
  ];
  if (metadata.dual_lane) {
    lines.push(
      "",
      "### desk レーン",
      ...byLane.desk
        .slice(0, 8)
        .map((e) => `- ${e.type}${e.app ? ` @ ${e.app}` : ""}${e.summary ? `: ${e.summary}` : ""}`),
      "",
      "### mobile レーン",
      ...byLane.mobile
        .slice(0, 8)
        .map((e) => `- ${e.type}${e.app ? ` @ ${e.app}` : ""}${e.summary ? `: ${e.summary}` : ""}`),
    );
  } else {
    lines.push(
      "",
      "### イベント",
      ...events
        .slice(0, 12)
        .map(
          (e) =>
            `- [${e.device}] ${e.type}${e.app ? ` @ ${e.app}` : ""}${e.summary ? `: ${e.summary}` : ""}`,
        ),
    );
  }
  if (skill.skill_candidate) {
    lines.push("", `> skill_candidate: ${skill.skill_candidate_reason}`);
  }
  const title =
    apps.length > 0
      ? `${apps.slice(0, 2).join(" / ")} — 10分サマリ`
      : "Activity — 10分サマリ";
  return { title, body: lines.join("\n"), apps, skill };
}

/**
 * Turns a 10-minute window into Markdown memory.
 * Uses SHIFTLOG_LLM_* when configured; otherwise a deterministic template.
 */
export async function summarizeTenMinuteWindow(
  store: MemoryStore,
  upload: WindowUpload,
): Promise<MemoryRecord> {
  const { metadata, events } = upload;
  const fallback = deterministicTenMinuteBody(upload);
  const llm = await summarizeWithLlm(upload);
  const title = llm?.title ?? fallback.title;
  const body = llm?.body ?? fallback.body;
  const { apps, skill } = fallback;
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
    },
    body,
  };

  store.putMemory(record);
  return record;
}

/**
 * Bundle up to 36 ten-minute memories into a six-hour summary.
 */
export function summarizeSixHourBundle(
  store: MemoryStore,
  tenMinuteIds: string[],
): MemoryRecord | null {
  const memories = tenMinuteIds
    .map((id) => store.getMemory(id))
    .filter((m): m is MemoryRecord => Boolean(m))
    .slice(0, 36);

  if (memories.length === 0) return null;

  const window_start = memories[0]!.front_matter.window_start;
  const window_end = memories[memories.length - 1]!.front_matter.window_end;
  const apps = [...new Set(memories.flatMap((m) => m.front_matter.apps))];
  const devices = new Set(memories.map((m) => m.front_matter.device));
  const device =
    devices.has("both") || (devices.has("desk") && devices.has("mobile"))
      ? "both"
      : devices.has("mobile")
        ? "mobile"
        : "desk";

  const now = new Date().toISOString();
  const id = `mem_6h_${window_start}`;
  const body = [
    "## 六時間サマリ",
    "",
    `十秒窓相当の十分サマリ ${memories.length} 本を束ねた。`,
    "",
    ...memories.map((m) => `- **${m.front_matter.title}**: ${m.front_matter.description}`),
  ].join("\n");

  const record: MemoryRecord = {
    id,
    created_at: now,
    updated_at: now,
    front_matter: {
      title: "六時間サマリ",
      description: `${memories.length} ten-minute windows`,
      apps,
      device,
      window_start,
      window_end,
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
