import { z } from "zod";
import { MemoryRecordSchema } from "./memory.js";
import { WindowUploadSchema } from "./window.js";

export const DeleteScopeSchema = z.enum([
  "last_10_minutes",
  "last_hour",
  "last_day",
  "all",
]);
export type DeleteScope = z.infer<typeof DeleteScopeSchema>;

export const DeleteRequestSchema = z.object({
  scope: DeleteScopeSchema,
});
export type DeleteRequest = z.infer<typeof DeleteRequestSchema>;

export const DeleteResultSchema = z.object({
  deleted_windows: z.number().int().nonnegative(),
  deleted_memories: z.number().int().nonnegative(),
  scope: DeleteScopeSchema,
});
export type DeleteResult = z.infer<typeof DeleteResultSchema>;

export const TimelineQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.string().optional(),
});

export const ContinueContextRequestSchema = z.object({
  /** Natural language "continue what I was doing" — returns context only. */
  prompt: z.string().min(1).default("続きやって"),
  limit: z.coerce.number().int().positive().max(36).default(12),
});
export type ContinueContextRequest = z.infer<typeof ContinueContextRequestSchema>;

export const ContinueContextResponseSchema = z.object({
  /** Agents must not execute; context only. No Computer Use in v1. */
  mode: z.literal("context_only"),
  prompt: z.string(),
  memories: z.array(MemoryRecordSchema),
  note: z.string(),
});
export type ContinueContextResponse = z.infer<typeof ContinueContextResponseSchema>;

export const UploadResponseSchema = z.object({
  window_id: z.string(),
  accepted_events: z.number().int().nonnegative(),
  summarize_queued: z.boolean(),
});

export { WindowUploadSchema };
