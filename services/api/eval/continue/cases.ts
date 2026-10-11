import type { MemoryRecord } from "@shift-log/schema";
import { CASES as WINDOWS } from "../summarize/cases.js";

/**
 * Eval cases for「続きやって」(POST /v1/agent/continue): given a prompt and a
 * library of stored memories, does the endpoint put the memory the person means
 * first?
 *
 * The library is the 24 summarize-eval windows stored as if the LLM had written
 * their oracle summary, so both evals describe the same synthetic week.
 *
 * kind (tags[0]):
 * - topic_ja / topic_en: the prompt names the work; `relevant` lists every memory about it
 * - generic: no topic ("続きやって"); the most recent memory should come first
 * - nomatch: names something no memory contains; no memory should be matched by keyword
 */
export type ContinueCase = {
  id: string;
  tags: string[];
  prompt: string;
  relevant: string[];
};

export function libraryMemories(): MemoryRecord[] {
  return WINDOWS.map((w) => {
    const { window_start, window_end, devices } = w.upload.metadata;
    const apps = [...new Set(w.upload.events.map((e) => e.app).filter((a): a is string => Boolean(a)))];
    const unfinished = w.oracle.unfinished.trim() || "（なし）";
    return {
      id: `mem_${w.id}`,
      created_at: window_end,
      updated_at: window_end,
      front_matter: {
        title: w.oracle.title,
        description: w.oracle.summary,
        apps,
        device: devices.length > 1 ? "both" : devices[0] === "mobile" ? "mobile" : "desk",
        window_start,
        window_end,
        kind: "ten_minute",
        window_ids: [w.upload.metadata.window_id],
        skill_candidate: false,
        entities: w.oracle.entities,
      },
      body: `## 要約\n\n${w.oracle.summary}\n\n## 未完\n\n${unfinished}`,
    };
  });
}

/** The memory a topic-free prompt should surface: the latest window. */
export function mostRecentId(): string {
  return libraryMemories().reduce((a, b) =>
    a.front_matter.window_start >= b.front_matter.window_start ? a : b,
  ).id;
}

const m = (...ids: string[]) => ids.map((id) => `mem_${id}`);

export const CASES: ContinueCase[] = [
  { id: "ja_ponytail", tags: ["topic_ja"], prompt: "ponytail の PR 通知の続きやって", relevant: m("switch_ghostty_slack") },
  { id: "ja_slack_channel", tags: ["topic_ja"], prompt: "Slack の team_frontend-pr-n10n の件の続き", relevant: m("switch_ghostty_slack") },
  { id: "ja_store_edit", tags: ["topic_ja"], prompt: "store.ts の編集の続きやって", relevant: m("cont_same_store", "focus_code_store") },
  { id: "ja_store_kana", tags: ["topic_ja"], prompt: "ストアのテスト直しの続き", relevant: m("cont_same_store", "focus_code_store") },
  { id: "ja_settings_design", tags: ["topic_ja"], prompt: "設定画面のデザインの続き", relevant: m("focus_figma") },
  { id: "ja_figma", tags: ["topic_ja"], prompt: "Figma の作業に戻りたい", relevant: m("focus_figma") },
  { id: "ja_failing_tests", tags: ["topic_ja"], prompt: "テストが落ちてたやつの続き", relevant: m("focus_terminal_tests") },
  { id: "ja_spec", tags: ["topic_ja"], prompt: "六時間サマリの仕様書の続きを書きたい", relevant: m("focus_notion_spec") },
  { id: "ja_rate_limit", tags: ["topic_ja"], prompt: "rate-limit の実装の続き", relevant: m("switch_code_docs") },
  { id: "ja_hono", tags: ["topic_ja"], prompt: "Hono のミドルウェアを調べてたやつ", relevant: m("switch_code_docs") },
  { id: "ja_review_schedule", tags: ["topic_ja"], prompt: "デザインレビューの日程調整の続き", relevant: m("switch_mail_calendar") },
  { id: "ja_vercel", tags: ["topic_ja"], prompt: "Vercel の設定を見直してた続き", relevant: m("switch_many_apps", "sensitive_key_text") },
  { id: "ja_pr93", tags: ["topic_ja"], prompt: "PR #93 のレビューの続き", relevant: m("cont_same_pr_review", "browser_pr_review") },
  { id: "ja_launchd", tags: ["topic_ja"], prompt: "launchd の KeepAlive 調べの続き", relevant: m("browser_docs_reading") },
  { id: "ja_collector", tags: ["topic_ja"], prompt: "collector.ts の続きやって", relevant: m("dual_code_slack_mobile") },
  { id: "ja_pr110_mobile", tags: ["topic_ja"], prompt: "スマホで見てた PR #110 の続き", relevant: m("dual_mobile_only") },
  { id: "ja_weekly_sync", tags: ["topic_ja"], prompt: "Weekly sync のメモの続き", relevant: m("dual_zoom_maps") },
  { id: "ja_invoice", tags: ["topic_ja"], prompt: "請求書の処理の続き", relevant: m("cont_switch_topic") },
  { id: "ja_pnpm", tags: ["topic_ja"], prompt: "pnpm workspaces のドキュメントの続き", relevant: m("sensitive_private_browsing") },
  { id: "ja_dev_channel", tags: ["topic_ja"], prompt: "dev-shiftlog チャンネルへの投稿の続き", relevant: m("sensitive_typing_only") },
  { id: "en_rate_limit", tags: ["topic_en"], prompt: "continue the rate limit work", relevant: m("switch_code_docs") },
  { id: "en_pr93", tags: ["topic_en"], prompt: "continue reviewing PR 93", relevant: m("cont_same_pr_review", "browser_pr_review") },
  { id: "en_settings", tags: ["topic_en"], prompt: "back to the settings screen design", relevant: m("focus_figma") },
  { id: "en_launchd", tags: ["topic_en"], prompt: "pick up the launchd KeepAlive research", relevant: m("browser_docs_reading") },
  { id: "gen_plain", tags: ["generic"], prompt: "続きやって", relevant: [] },
  { id: "gen_sakki", tags: ["generic"], prompt: "さっきの続きお願い", relevant: [] },
  { id: "gen_sagyou", tags: ["generic"], prompt: "作業の続き", relevant: [] },
  { id: "gen_polite", tags: ["generic"], prompt: "続きをやってください", relevant: [] },
  { id: "gen_en", tags: ["generic"], prompt: "continue where I left off", relevant: [] },
  { id: "none_mortgage", tags: ["nomatch"], prompt: "Mortgage calculator の続き", relevant: [] },
  { id: "none_discord", tags: ["nomatch"], prompt: "Discord の続き", relevant: [] },
];
