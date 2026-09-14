import type { MemoryEntity, WindowUpload } from "@shift-log/schema";
import type { TenMinuteAggregate } from "./ten-minute.js";

const PATH_PREFIXES = new Set([
  "src",
  "lib",
  "app",
  "apps",
  "packages",
  "services",
  "node_modules",
  "test",
  "tests",
  "dist",
  "build",
  "scripts",
]);

function textsFrom(upload: WindowUpload, aggregate?: TenMinuteAggregate): string[] {
  const texts = upload.events.flatMap((e) => [e.summary, e.site, e.urlPath]).filter((s): s is string => Boolean(s));
  if (aggregate) texts.push(...aggregate.spans.map((span) => span.title));
  return texts;
}

function pushUnique(out: MemoryEntity[], entity: MemoryEntity): void {
  if (out.some((e) => e.kind === entity.kind && e.value === entity.value)) return;
  out.push(entity);
}

export function extractEntities(
  upload: WindowUpload,
  aggregate?: TenMinuteAggregate,
): MemoryEntity[] {
  const out: MemoryEntity[] = [];
  const hay = textsFrom(upload, aggregate).join("\n");

  for (const match of hay.matchAll(/([A-Za-z0-9_./-]+)（チャンネル）/g)) {
    pushUnique(out, { kind: "slack_channel", value: match[1]! });
  }

  for (const match of hay.matchAll(
    /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/pull\/(\d+))?/g,
  )) {
    const repo = `${match[1]}/${match[2]}`;
    if (match[3]) {
      pushUnique(out, { kind: "github_pr", value: `${repo}#${match[3]}` });
    }
    pushUnique(out, { kind: "github_repo", value: repo });
  }

  for (const match of hay.matchAll(
    /(?:^|[\s(\-])([A-Za-z0-9][A-Za-z0-9._-]{0,38}\/[A-Za-z0-9._-]{1,80})(?=$|[\s),])/gm,
  )) {
    const value = match[1]!;
    const [owner, name] = value.split("/");
    if (!owner || !name) continue;
    if (PATH_PREFIXES.has(owner)) continue;
    if (/\.[A-Za-z0-9]{1,8}$/.test(name)) continue;
    pushUnique(out, { kind: "github_repo", value });
  }

  for (const match of hay.matchAll(/https?:\/\/[^\s<>"'）)]+/g)) {
    const value = match[0]!.replace(/[.,;:]+$/, "");
    if (value.includes("github.com/")) continue;
    pushUnique(out, { kind: "url", value });
  }

  for (const match of hay.matchAll(
    /(?:\/|(?:\.\.?\/))?(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,8}\b/g,
  )) {
    pushUnique(out, { kind: "file", value: match[0]! });
  }

  return out;
}

export function mergeEntities(...groups: MemoryEntity[][]): MemoryEntity[] {
  const out: MemoryEntity[] = [];
  for (const group of groups) {
    for (const entity of group) pushUnique(out, entity);
  }
  return out;
}
