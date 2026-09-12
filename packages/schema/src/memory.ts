import { z } from "zod";
import { DeviceLaneSchema } from "./events.js";

export const MemoryKindSchema = z.enum(["ten_minute", "six_hour"]);
export type MemoryKind = z.infer<typeof MemoryKindSchema>;

/**
 * Markdown memory front matter (YAML):
 * title, description, apps, device, window_start, window_end
 */
export const MemoryFrontMatterSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  apps: z.array(z.string()),
  device: z.union([DeviceLaneSchema, z.literal("both")]),
  window_start: z.iso.datetime(),
  window_end: z.iso.datetime(),
  kind: MemoryKindSchema.default("ten_minute"),
  window_ids: z.array(z.string()).default([]),
  /** Flag only — SkillCheck implementation comes later. */
  skill_candidate: z.boolean().default(false),
  skill_candidate_reason: z.string().optional(),
  /** Per-app dwell seconds inside the window. Sum equals active window time. */
  apps_dwell: z.record(z.string(), z.number().int().nonnegative()).optional(),
  sites: z.array(z.string()).optional(),
  top_app: z.string().optional(),
});
export type MemoryFrontMatter = z.infer<typeof MemoryFrontMatterSchema>;

export const MemoryRecordSchema = z.object({
  id: z.string().min(1),
  front_matter: MemoryFrontMatterSchema,
  /** Human-readable work summary body (Markdown). */
  body: z.string(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export function serializeMemoryMarkdown(record: MemoryRecord): string {
  const fm = record.front_matter;
  const yaml = [
    "---",
    `title: ${JSON.stringify(fm.title)}`,
    `description: ${JSON.stringify(fm.description)}`,
    `apps: [${fm.apps.map((a) => JSON.stringify(a)).join(", ")}]`,
    `device: ${fm.device}`,
    `window_start: ${fm.window_start}`,
    `window_end: ${fm.window_end}`,
    `kind: ${fm.kind}`,
    `window_ids: [${fm.window_ids.map((id) => JSON.stringify(id)).join(", ")}]`,
    `skill_candidate: ${fm.skill_candidate}`,
    ...(fm.skill_candidate_reason
      ? [`skill_candidate_reason: ${JSON.stringify(fm.skill_candidate_reason)}`]
      : []),
    ...(fm.apps_dwell
      ? [`apps_dwell: ${JSON.stringify(fm.apps_dwell)}`]
      : []),
    ...(fm.sites ? [`sites: [${fm.sites.map((s) => JSON.stringify(s)).join(", ")}]`] : []),
    ...(fm.top_app ? [`top_app: ${JSON.stringify(fm.top_app)}`] : []),
    "---",
    "",
    record.body.trim(),
    "",
  ].join("\n");
  return yaml;
}
