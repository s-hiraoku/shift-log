import { z } from "zod";
import { DeviceLaneSchema } from "./events.js";

export const ActivityQuerySchema = z.object({
  q: z.string().trim().min(1).max(500).optional(),
  app: z.string().trim().min(1).optional(),
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(4000).optional(),
}).refine((q) => !q.since || !q.until || Date.parse(q.since) <= Date.parse(q.until), {
  message: "since must be before until",
});
export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;

export const ActivityRecordSchema = z.object({
  id: z.string(),
  window_id: z.string(),
  event_id: z.string(),
  ts: z.iso.datetime(),
  device: DeviceLaneSchema,
  app: z.string(),
  title: z.string(),
  site: z.string().optional(),
  url_path: z.string().optional(),
  source: z.literal("accessibility"),
  text: z.string(),
  truncated: z.boolean(),
});
export type ActivityRecord = z.infer<typeof ActivityRecordSchema>;
export const ActivitySearchResponseSchema = z.object({
  items: z.array(ActivityRecordSchema.omit({ text: true }).extend({ snippet: z.string() })),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
  retention_hours: z.literal(48),
  note: z.string(),
});
