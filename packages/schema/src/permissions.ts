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

const PATH_ONLY_BASE = "https://urlpath.invalid";

export type HostAndPath =
  | { readonly kind: "absolute"; readonly host: string; readonly path: string }
  | { readonly kind: "path"; readonly path: string };

export function hostAndPath(raw: string): HostAndPath | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    try {
      const url = new URL(trimmed, PATH_ONLY_BASE);
      return { kind: "path", path: url.pathname };
    } catch {
      return undefined;
    }
  }

  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (!url.hostname) return undefined;
    return {
      kind: "absolute",
      host: url.hostname.toLowerCase(),
      path: url.pathname,
    };
  } catch {
    return undefined;
  }
}

export function omitTitleFields<
  E extends { summary?: unknown; site?: unknown; meta?: unknown; urlPath?: unknown },
>(event: E): Omit<E, "summary" | "site" | "meta" | "urlPath"> {
  const { summary: _summary, site: _site, meta: _meta, urlPath: _urlPath, ...rest } = event;
  return rest;
}

type RestrictedEvent = {
  type: string;
  app?: string;
  site?: string;
  summary?: string;
  meta?: unknown;
  urlPath?: string;
};

export function omitRestrictedFields<E extends RestrictedEvent>(
  event: E,
  permissions: PermissionsConfig,
): E | Omit<E, "urlPath"> | Omit<E, "summary" | "site" | "meta" | "urlPath"> {
  let keptPath: string | undefined;
  if (event.type === "browser_navigation" && typeof event.urlPath === "string") {
    const parsed = hostAndPath(event.urlPath);
    if (parsed?.kind === "absolute") {
      const labeled = typeof event.site === "string" ? event.site.trim().toLowerCase() : "";
      const hostDisallowed = !isSourceAllowed(permissions, "sites", parsed.host);
      const hostDisagrees = labeled !== "" && labeled !== parsed.host;
      if (!hostDisallowed && !hostDisagrees) keptPath = parsed.path;
    } else if (parsed?.kind === "path") {
      keptPath = parsed.path;
    }
  }

  const copy: E = keptPath === undefined ? event : { ...event, urlPath: keptPath };
  if (copy.app && titlePolicyFor(permissions, copy.app) === "app_only") {
    return omitTitleFields(copy);
  }

  const siteText = typeof event.site === "string" ? event.site.trim() : "";
  const dropPath =
    keptPath === undefined ||
    (event.type === "browser_navigation" &&
      (siteText === "" || !isSourceAllowed(permissions, "sites", siteText)));
  if (dropPath) {
    const { urlPath: _urlPath, ...rest } = copy;
    return rest;
  }
  return copy;
}
