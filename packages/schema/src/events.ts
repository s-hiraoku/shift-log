import { z } from "zod";

/** Device lane within a 10-minute window. */
export const DeviceLaneSchema = z.enum(["desk", "mobile"]);
export type DeviceLane = z.infer<typeof DeviceLaneSchema>;

/**
 * Interaction events aligned with Computer History:
 * clicks, typing presence (not full keylog), shortcuts, app switches,
 * accessibility context of the front window.
 * Mobile: foreground app, screen enter/exit, allowed browser navigations,
 * notification open/close. Full keylogging is forbidden.
 */
export const EventTypeSchema = z.enum([
  "click",
  "typing_presence",
  "shortcut",
  "app_switch",
  "front_window_summary",
  "screen_enter",
  "screen_exit",
  "browser_navigation",
  "notification_open",
  "notification_close",
  "pause",
  "resume",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const InteractionEventSchema = z.object({
  id: z.string().min(1),
  type: EventTypeSchema,
  ts: z.string().datetime(),
  device: DeviceLaneSchema,
  app: z.string().optional(),
  /** Site host when applicable; private browsing must never appear. */
  site: z.string().optional(),
  /** Accessibility / UI summary — never full keystroke text. */
  summary: z.string().max(2000).optional(),
  /** Typing presence only: whether input occurred, never the content. */
  typing: z
    .object({
      active: z.boolean(),
      approxChars: z.number().int().nonnegative().optional(),
    })
    .optional(),
  shortcut: z.string().optional(),
  urlPath: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});
export type InteractionEvent = z.infer<typeof InteractionEventSchema>;
