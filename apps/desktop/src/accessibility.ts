import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  canCollect, canCaptureAccessibility, isBrowserApp, hostAndPath, redactSensitiveText,
  type PermissionsConfig,
} from "@shift-log/schema";
import type { FrontWindow } from "./os-observe.js";

export type AccessibilityResult = {
  status: string;
  ax?: { title: string; text: string; truncated: boolean };
};
type RunHelper = () => Promise<string>;
const exec = promisify(execFile);

export function shouldCaptureAccessibility(front: FrontWindow, permissions: PermissionsConfig): boolean {
  return canCollect(permissions) && canCaptureAccessibility({
    ...front,
    meta: { privateBrowsing: front.privateBrowsing, privateBrowsingUnknown: front.privateBrowsingUnknown },
  }, permissions);
}

export function parseAccessibilitySnapshot(raw: string, front: FrontWindow): AccessibilityResult {
  const data = JSON.parse(raw) as Record<string, unknown>;
  if (data.status !== "ok") return { status: typeof data.status === "string" ? data.status : "unavailable" };
  if (typeof data.app !== "string" || data.app.toLowerCase() !== front.app.toLowerCase() || data.title !== front.title.slice(0, 2000)) {
    return { status: "focus_changed" };
  }
  if (isBrowserApp(front.app)) {
    const location = typeof data.url === "string" ? hostAndPath(data.url) : undefined;
    if (!location || location.kind !== "absolute" || location.host !== front.site || location.path !== front.urlPath) {
      return { status: "focus_changed" };
    }
  }
  if (typeof data.text !== "string" || !data.text.trim()) return { status: "empty" };
  const text = redactSensitiveText(data.text).slice(-12000);
  return { status: "ok", ax: {
    title: redactSensitiveText(front.title).slice(0, 2000), text,
    truncated: data.truncated === true || data.text.length > 12000,
  } };
}

export async function observeAccessibility(
  front: FrontWindow,
  permissions: PermissionsConfig,
  run: RunHelper = async () => (await exec(fileURLToPath(new URL("../dist/ax-snapshot", import.meta.url)), [], {
    timeout: 3500, maxBuffer: 256_000,
  })).stdout,
  platform: string = process.platform,
): Promise<AccessibilityResult> {
  if (!shouldCaptureAccessibility(front, permissions)) return { status: "excluded" };
  if (platform !== "darwin") return { status: "unsupported" };
  try { return parseAccessibilitySnapshot(await run(), front); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { status: code === "ENOENT" ? "helper_missing" : "unavailable" };
  }
}
