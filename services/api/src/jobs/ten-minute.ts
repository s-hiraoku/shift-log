import type { InteractionEvent, WindowUpload } from "@shift-log/schema";

export type FocusSpan = {
  app: string;
  site?: string;
  title: string;
  start: string;
  end: string;
  dwell_seconds: number;
};

export type TenMinuteAggregate = {
  apps_dwell: Record<string, number>;
  sites: string[];
  top_app?: string;
  spans: FocusSpan[];
  active_seconds: number;
};

function clock(iso: string): string {
  return iso.slice(11, 16);
}

function secondsBetween(start: string, end: string): number {
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000));
}

function spanTitle(events: InteractionEvent[], app: string): string {
  const windowSummaries = events
    .filter((e) => e.type === "front_window_summary" && e.summary)
    .map((e) => e.summary!);
  if (windowSummaries.length > 0) return windowSummaries[windowSummaries.length - 1]!;
  const summaries = events.filter((e) => e.summary).map((e) => e.summary!);
  if (summaries.length > 0) return summaries[summaries.length - 1]!;
  return app;
}

function lastSite(events: InteractionEvent[]): string | undefined {
  const sites = events.map((e) => e.site).filter((s): s is string => Boolean(s));
  return sites[sites.length - 1];
}

/**
 * Collapse a 10-minute window into per-app dwell and consecutive focus spans.
 * Same app in a row (ghostty ping-pong titles, app_switch + front_window_summary)
 * is one span. A switch away and back is a new span.
 */
export function aggregateTenMinuteWindow(upload: WindowUpload): TenMinuteAggregate {
  const { metadata, events } = upload;
  const focused = [...events]
    .filter((e) => Boolean(e.app))
    .sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id));

  const sites = [...new Set(focused.map((e) => e.site).filter((s): s is string => Boolean(s)))];
  if (focused.length === 0) {
    return { apps_dwell: {}, sites, spans: [], active_seconds: 0 };
  }

  const groups: InteractionEvent[][] = [];
  for (const event of focused) {
    const current = groups[groups.length - 1];
    if (current && current[0]!.app === event.app) {
      current.push(event);
    } else {
      groups.push([event]);
    }
  }

  const starts = groups.map((group) => group[0]!.ts);
  const spans: FocusSpan[] = groups.map((group, i) => {
    const app = group[0]!.app!;
    const start = starts[i]!;
    const end = starts[i + 1] ?? metadata.window_end;
    const site = lastSite(group);
    return {
      app,
      ...(site ? { site } : {}),
      title: spanTitle(group, app),
      start,
      end,
      dwell_seconds: secondsBetween(start, end),
    };
  });

  const apps_dwell: Record<string, number> = {};
  for (const span of spans) {
    apps_dwell[span.app] = (apps_dwell[span.app] ?? 0) + span.dwell_seconds;
  }

  const active_seconds = Object.values(apps_dwell).reduce((sum, n) => sum + n, 0);
  const top_app = Object.entries(apps_dwell).reduce<string | undefined>((best, [app, dwell]) => {
    if (best === undefined) return app;
    return dwell > (apps_dwell[best] ?? 0) ? app : best;
  }, undefined);

  return { apps_dwell, sites, top_app, spans, active_seconds };
}

export function renderTenMinuteBody(
  aggregate: TenMinuteAggregate,
  skill?: { skill_candidate: boolean; skill_candidate_reason?: string },
): string {
  const windowClock = aggregate.spans[0] ? clock(aggregate.spans[0].start) : undefined;
  const dwellLines =
    aggregate.spans.length === 0
      ? ["(なし)"]
      : Object.entries(aggregate.apps_dwell).map(
          ([app, seconds]) => `- ${windowClock} ${app} ${seconds}秒`,
        );
  const spanLines =
    aggregate.spans.length === 0
      ? ["(なし)"]
      : aggregate.spans.map(
          (span) =>
            `- ${clock(span.start)}-${clock(span.end)} ${span.app} — ${span.title}`,
        );

  const lines = [
    "## アプリ別滞在時間",
    "",
    ...dwellLines,
    "",
    "## Focus span",
    "",
    ...spanLines,
  ];
  if (skill?.skill_candidate) {
    lines.push("", `> skill_candidate: ${skill.skill_candidate_reason}`);
  }
  return lines.join("\n");
}
