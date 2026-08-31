import { z } from "zod";
import { DeviceLaneSchema, InteractionEventSchema } from "./events.js";

/** Ten-minute activity window payload (events.jsonl + metadata.json). */
export const WindowMetadataSchema = z.object({
  window_id: z.string().min(1),
  window_start: z.iso.datetime(),
  window_end: z.iso.datetime(),
  devices: z.array(DeviceLaneSchema).min(1),
  /** True when desk and mobile both contributed. */
  dual_lane: z.boolean().default(false),
  event_count: z.number().int().nonnegative(),
  /** Collector paused for part of this window. */
  paused: z.boolean().default(false),
  schema_version: z.literal("1"),
});
export type WindowMetadata = z.infer<typeof WindowMetadataSchema>;

export const WindowUploadSchema = z.object({
  metadata: WindowMetadataSchema,
  events: z.array(InteractionEventSchema),
});
export type WindowUpload = z.infer<typeof WindowUploadSchema>;

/** Raw events are discarded after 48 hours. */
export const RAW_EVENT_RETENTION_HOURS = 48 as const;
export const WINDOW_DURATION_MINUTES = 10 as const;
export const SIX_HOUR_BUNDLE_MAX_WINDOWS = 36 as const;
