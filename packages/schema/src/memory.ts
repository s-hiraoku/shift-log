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
  window_start: z.string().datetime(),
  window_end: z.string().datetime(),
  kind: MemoryKindSchema.default("ten_minute"),
  window_ids: z.array(z.string()).default([]),
  /** Flag only — SkillCheck implementation comes later. */
  skill_candidate: z.boolean().default(false),
  skill_candidate_reason: z.string().optional(),
});
export type MemoryFrontMatter = z.infer<typeof MemoryFrontMatterSchema>;

export const MemoryRecordSchema = z.object({
  id: z.string().min(1),
  front_matter: MemoryFrontMatterSchema,
  /** Human-readable work summary body (Markdown). */
  body: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
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
    "---",
    "",
    record.body.trim(),
    "",
  ].join("\n");
  return yaml;
}
