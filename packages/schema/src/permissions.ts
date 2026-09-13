import { z } from "zod";

/**
 * Computer History-compatible permission model:
 * - Default OFF; Memories equivalent must be ON.
 * - App-level and site-level allowlists + denylists.
 * - Private browsing is permanently excluded (enforced in collectors).
 */
export const PermissionModeSchema = z.enum(["exclude_listed", "include_only"]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const TitlePolicySchema = z.enum(["full", "app_only"]);
export type TitlePolicy = z.infer<typeof TitlePolicySchema>;

const SourceRulesSchema = z
  .object({
    mode: PermissionModeSchema.default("exclude_listed"),
    exclude: z.array(z.string()).default([]),
    include_only: z.array(z.string()).default([]),
  })
  .default({
    mode: "exclude_listed",
    exclude: [],
    include_only: [],
  });

const CapturePolicySchema = z
  .object({
    screenshots: z.literal(false).default(false),
    screen_recording: z.literal(false).default(false),
    microphone: z.literal(false).default(false),
    system_audio: z.literal(false).default(false),
    full_keylog: z.literal(false).default(false),
  })
  .default({
    screenshots: false,
    screen_recording: false,
    microphone: false,
    system_audio: false,
    full_keylog: false,
  });

export const PermissionsConfigSchema = z.object({
  /** Master switch — default off. */
  enabled: z.boolean().default(false),
  /** Memories equivalent — required for collection to run. */
  memories_enabled: z.boolean().default(false),
  paused: z.boolean().default(false),
  apps: SourceRulesSchema,
  sites: SourceRulesSchema,
  /** Per-app title recording. A missing key is full (app + title). */
  title_policy: z.record(z.string(), TitlePolicySchema).default({}),
  /** Always true — private browsing is never collected. */
  private_browsing_excluded: z.literal(true).default(true),
  /** Never capture screenshots, screen recording, mic, or system audio. */
  capture_policy: CapturePolicySchema,
});
export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;

export function canCollect(config: PermissionsConfig): boolean {
  return config.enabled && config.memories_enabled && !config.paused;
}

export function isSourceAllowed(
  config: PermissionsConfig,
  kind: "apps" | "sites",
  name: string,
): boolean {
  const rules = config[kind];
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  if (rules.mode === "include_only") {
    return rules.include_only.some((x) => x.toLowerCase() === normalized);
  }
  return !rules.exclude.some((x) => x.toLowerCase() === normalized);
}

export function titlePolicyFor(config: PermissionsConfig, name: string): TitlePolicy {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return "full";
  for (const [key, policy] of Object.entries(config.title_policy)) {
    if (key.trim().toLowerCase() === normalized) return policy;
  }
  return "full";
}

export function omitTitleFields<
  E extends { summary?: unknown; site?: unknown; meta?: unknown },
>(event: E): Omit<E, "summary" | "site" | "meta"> {
  const { summary: _summary, site: _site, meta: _meta, ...rest } = event;
  return rest;
}
