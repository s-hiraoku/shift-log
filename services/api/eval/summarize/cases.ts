import type { InteractionEvent, LlmMemory, MemoryEntity, WindowUpload } from "@shift-log/schema";

/**
 * Eval cases for the ten-minute summary flow (upload → sanitize → summarize).
 *
 * Every case is synthetic: shaped after real windows (the ghostty ↔ Slack window
 * from #34, the demo seed, the private-browsing and keyText sanitizer rules) but
 * with no personal data, so the set can live in the repo.
 *
 * `expect` is human-written, never a model's output:
 * - topics: a good title or summary mentions at least one of these (case-insensitive)
 * - entities: entities a good memory carries (scored as recall)
 * - forbidden: strings that must never reach the memory (private sites, key text)
 * - same_work: with `previous`, whether this window continues that work
 * `oracle` is a hand-written ideal LLM reply, used only by `--mode oracle` to prove
 * the graders can score 100%.
 */
export type EvalCase = {
  id: string;
  tags: string[];
  upload: WindowUpload;
  previous?: { title: string; body: string; window_start: string };
  expect: {
    topics: string[];
    entities: MemoryEntity[];
    forbidden: string[];
    same_work?: boolean;
  };
  oracle: LlmMemory;
};

type EventOpts = Partial<Omit<InteractionEvent, "id" | "type" | "ts" | "app" | "summary">>;

function windowAt(start: string) {
  const base = Date.parse(start);
  const at = (minute: number) => new Date(base + minute * 60_000).toISOString();
  return {
    start: at(0),
    end: at(10),
    ev(
      id: string,
      minute: number,
      type: InteractionEvent["type"],
      app: string | undefined,
      summary?: string,
      opts: EventOpts = {},
    ): InteractionEvent {
      return {
        id,
        type,
        ts: at(minute),
        device: "desk",
        ...(app ? { app } : {}),
        ...(summary ? { summary } : {}),
        ...opts,
      };
    },
  };
}

function upload(id: string, start: string, end: string, events: InteractionEvent[]): WindowUpload {
  const devices = [...new Set(events.map((e) => e.device))];
  return {
    metadata: {
      window_id: id,
      window_start: start,
      window_end: end,
      devices,
      dual_lane: devices.length > 1,
      event_count: events.length,
      paused: false,
      schema_version: "1",
    },
    events,
  };
}

function build(
  id: string,
  tags: string[],
  start: string,
  events: (w: ReturnType<typeof windowAt>) => InteractionEvent[],
  rest: Omit<EvalCase, "id" | "tags" | "upload">,
): EvalCase {
  const w = windowAt(start);
  return { id, tags, upload: upload(`eval_${id}`, w.start, w.end, events(w)), ...rest };
}

const mobile = { device: "mobile" as const };

export const CASES: EvalCase[] = [
  // ── focus: one app, one task ────────────────────────────────────────────
  build("focus_code_store", ["focus", "desk"], "2026-09-20T01:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Code", "Focused Code", { meta: { project: "shift-log" } }),
    w.ev("2", 0.5, "front_window_summary", "Code", "store.ts — shift-log"),
    w.ev("3", 2, "typing_presence", "Code", undefined, { typing: { active: true, approxChars: 420 } }),
    w.ev("4", 5, "front_window_summary", "Code", "store.test.ts — shift-log"),
    w.ev("5", 6, "typing_presence", "Code", undefined, { typing: { active: true, approxChars: 180 } }),
    w.ev("6", 9, "front_window_summary", "Code", "store.ts — shift-log"),
  ], {
    expect: { topics: ["store.ts", "store.test.ts", "shift-log", "ストア"], entities: [], forbidden: [] },
    oracle: {
      title: "shift-log の store.ts を編集",
      summary: "Code で shift-log の store.ts と store.test.ts を行き来しながら編集していた。",
      unfinished: "store.ts の変更とテストの対応が途中に見える。",
      entities: [],
    },
  }),
  build("focus_figma", ["focus", "desk"], "2026-09-20T02:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Figma", "Focused Figma"),
    w.ev("2", 0.2, "front_window_summary", "Figma", "Settings screen v3 – ShiftLog Design"),
    w.ev("3", 3, "click", "Figma", "Toggle component: Memories switch"),
    w.ev("4", 6, "click", "Figma", "Frame: Allowlist row"),
    w.ev("5", 8, "front_window_summary", "Figma", "Settings screen v3 – ShiftLog Design"),
  ], {
    expect: { topics: ["設定画面", "Settings", "Figma"], entities: [], forbidden: [] },
    oracle: {
      title: "Figma で設定画面 v3 をデザイン",
      summary: "Figma で ShiftLog の Settings screen v3 を開き、Memories スイッチや許可リスト行のコンポーネントを調整していた。",
      unfinished: "",
      entities: [],
    },
  }),
  build("focus_terminal_tests", ["focus", "desk"], "2026-09-20T03:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "ghostty", "Focused ghostty", { meta: { cwd: "/Users/dev/src/shift-log" } }),
    w.ev("2", 0.3, "front_window_summary", "ghostty", "pnpm -r run test"),
    w.ev("3", 4, "front_window_summary", "ghostty", "vitest — services/api 3 failed"),
    w.ev("4", 7, "front_window_summary", "ghostty", "vitest — services/api 55 passed"),
  ], {
    expect: { topics: ["テスト", "test", "vitest"], entities: [], forbidden: [] },
    oracle: {
      title: "shift-log のテストを実行して修正",
      summary: "ghostty で shift-log の pnpm -r run test を回し、services/api で 3 件失敗したあと 55 件すべて通る状態にした。",
      unfinished: "",
      entities: [],
    },
  }),
  build("focus_notion_spec", ["focus", "desk"], "2026-09-20T04:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Notion", "Focused Notion"),
    w.ev("2", 0.2, "front_window_summary", "Notion", "Six-hour summary spec"),
    w.ev("3", 1, "typing_presence", "Notion", undefined, { typing: { active: true, approxChars: 900 } }),
    w.ev("4", 7, "front_window_summary", "Notion", "Six-hour summary spec"),
  ], {
    expect: { topics: ["六時間", "Six-hour", "仕様"], entities: [], forbidden: [] },
    oracle: {
      title: "六時間サマリの仕様を執筆",
      summary: "Notion で Six-hour summary spec のページを開き、長めに文章を書いていた。",
      unfinished: "仕様書は書きかけに見える。",
      entities: [],
    },
  }),

  // ── switching: back-and-forth between apps ─────────────────────────────
  build("switch_ghostty_slack", ["switching", "desk", "regression"], "2026-09-11T06:39:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "ghostty", "Focused ghostty"),
    w.ev("2", 1, "app_switch", "Slack", "Focused Slack"),
    w.ev("3", 1.2, "front_window_summary", "Slack", "team_frontend-pr-n10n（チャンネル） - DietrichGebert/ponytail", { site: "github.com" }),
    w.ev("4", 2, "app_switch", "ghostty", "Focused ghostty"),
    w.ev("5", 3, "app_switch", "Slack", "Focused Slack"),
    w.ev("6", 3.2, "front_window_summary", "Slack", "team_frontend-pr-n10n（チャンネル） - DietrichGebert/ponytail", { site: "github.com" }),
    w.ev("7", 4, "app_switch", "ghostty", "Focused ghostty"),
  ], {
    expect: {
      topics: ["team_frontend-pr-n10n", "ponytail", "PR"],
      entities: [
        { kind: "slack_channel", value: "team_frontend-pr-n10n" },
        { kind: "github_repo", value: "DietrichGebert/ponytail" },
      ],
      forbidden: [],
    },
    oracle: {
      title: "ponytail の PR 通知を Slack で確認",
      summary: "ghostty と Slack を行き来し、team_frontend-pr-n10n チャンネルで DietrichGebert/ponytail の PR 通知を繰り返し確認していた。",
      unfinished: "PR 通知への対応が残っているように見える。",
      entities: [
        { kind: "slack_channel", value: "team_frontend-pr-n10n" },
        { kind: "github_repo", value: "DietrichGebert/ponytail" },
      ],
    },
  }),
  build("switch_code_docs", ["switching", "desk"], "2026-09-20T05:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Code", "Focused Code"),
    w.ev("2", 0.2, "front_window_summary", "Code", "rate-limit.ts — shift-log"),
    w.ev("3", 2, "app_switch", "Google Chrome", "Focused Google Chrome"),
    w.ev("4", 2.1, "browser_navigation", "Google Chrome", "Hono middleware docs", { site: "hono.dev", urlPath: "https://hono.dev/docs/middleware/builtin/timing" }),
    w.ev("5", 4, "app_switch", "Code", "Focused Code"),
    w.ev("6", 4.2, "front_window_summary", "Code", "rate-limit.ts — shift-log"),
    w.ev("7", 7, "app_switch", "Google Chrome", "Focused Google Chrome"),
    w.ev("8", 7.1, "browser_navigation", "Google Chrome", "Hono middleware docs", { site: "hono.dev", urlPath: "https://hono.dev/docs/middleware/builtin/timing" }),
  ], {
    expect: {
      topics: ["rate-limit", "Hono", "ミドルウェア", "middleware"],
      entities: [{ kind: "url", value: "https://hono.dev/docs/middleware/builtin/timing" }],
      forbidden: [],
    },
    oracle: {
      title: "Hono のドキュメントを見ながら rate-limit.ts を実装",
      summary: "Code の rate-limit.ts と Chrome の Hono middleware ドキュメントを行き来して実装していた。",
      unfinished: "rate-limit.ts の実装が途中に見える。",
      entities: [{ kind: "url", value: "https://hono.dev/docs/middleware/builtin/timing" }],
    },
  }),
  build("switch_mail_calendar", ["switching", "desk"], "2026-09-20T06:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Mail", "Focused Mail"),
    w.ev("2", 0.2, "front_window_summary", "Mail", "Re: 10/7 design review"),
    w.ev("3", 2, "app_switch", "Calendar", "Focused Calendar"),
    w.ev("4", 2.2, "front_window_summary", "Calendar", "October 2026 — Week 41"),
    w.ev("5", 3, "click", "Calendar", "New event: Design review"),
    w.ev("6", 5, "app_switch", "Mail", "Focused Mail"),
    w.ev("7", 5.2, "front_window_summary", "Mail", "Re: 10/7 design review"),
  ], {
    expect: { topics: ["デザインレビュー", "design review", "日程", "予定"], entities: [], forbidden: [] },
    oracle: {
      title: "デザインレビューの日程調整",
      summary: "Mail で 10/7 design review のスレッドを読み、Calendar に Design review の予定を作ってから返信画面に戻った。",
      unfinished: "メールの返信が未送信に見える。",
      entities: [],
    },
  }),
  build("switch_many_apps", ["switching", "desk"], "2026-09-20T07:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Slack", "Focused Slack"),
    w.ev("2", 0.1, "front_window_summary", "Slack", "general（チャンネル）"),
    w.ev("3", 1, "app_switch", "Mail", "Focused Mail"),
    w.ev("4", 1.1, "front_window_summary", "Mail", "Inbox (12)"),
    w.ev("5", 2, "app_switch", "Google Chrome", "Focused Google Chrome"),
    w.ev("6", 2.1, "browser_navigation", "Google Chrome", "Vercel dashboard", { site: "vercel.com" }),
    w.ev("7", 3, "app_switch", "Code", "Focused Code"),
    w.ev("8", 3.1, "front_window_summary", "Code", "vercel.json — shift-log"),
    w.ev("9", 6, "app_switch", "Google Chrome", "Focused Google Chrome"),
    w.ev("10", 6.1, "browser_navigation", "Google Chrome", "Vercel dashboard", { site: "vercel.com" }),
  ], {
    expect: { topics: ["Vercel", "vercel.json", "デプロイ"], entities: [{ kind: "slack_channel", value: "general" }], forbidden: [] },
    oracle: {
      title: "Vercel の設定を確認",
      summary: "Slack とメールを流し見たあと、Code の vercel.json と Chrome の Vercel ダッシュボードを行き来していた。",
      unfinished: "",
      entities: [{ kind: "slack_channel", value: "general" }],
    },
  }),

  // ── browser: the page is the work ──────────────────────────────────────
  build("browser_pr_review", ["browser", "desk"], "2026-09-20T08:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Safari", "Focused Safari"),
    w.ev("2", 0.1, "browser_navigation", "Safari", "fix(verify): pin isolated API bind", { site: "github.com", urlPath: "https://github.com/s-hiraoku/shift-log/pull/93" }),
    w.ev("3", 3, "browser_navigation", "Safari", "Files changed · PR #93", { site: "github.com", urlPath: "https://github.com/s-hiraoku/shift-log/pull/93/files" }),
    w.ev("4", 8, "click", "Safari", "Review changes"),
  ], {
    expect: {
      topics: ["#93", "レビュー", "review", "verify"],
      entities: [
        { kind: "github_pr", value: "s-hiraoku/shift-log#93" },
        { kind: "github_repo", value: "s-hiraoku/shift-log" },
      ],
      forbidden: [],
    },
    oracle: {
      title: "shift-log PR #93 をレビュー",
      summary: "Safari で s-hiraoku/shift-log の PR #93（verify の API bind 固定）の変更ファイルを読み、Review changes を押した。",
      unfinished: "レビューの送信が済んだかは分からない。",
      entities: [
        { kind: "github_pr", value: "s-hiraoku/shift-log#93" },
        { kind: "github_repo", value: "s-hiraoku/shift-log" },
      ],
    },
  }),
  build("browser_docs_reading", ["browser", "desk"], "2026-09-20T09:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Google Chrome", "Focused Google Chrome"),
    w.ev("2", 0.1, "browser_navigation", "Google Chrome", "launchd.plist(5)", { site: "keith.github.io", urlPath: "https://keith.github.io/xcode-man-pages/launchd.plist.5.html" }),
    w.ev("3", 6, "browser_navigation", "Google Chrome", "KeepAlive — launchd.plist(5)", { site: "keith.github.io", urlPath: "https://keith.github.io/xcode-man-pages/launchd.plist.5.html" }),
  ], {
    expect: {
      topics: ["launchd", "KeepAlive"],
      entities: [{ kind: "url", value: "https://keith.github.io/xcode-man-pages/launchd.plist.5.html" }],
      forbidden: [],
    },
    oracle: {
      title: "launchd.plist の KeepAlive を調査",
      summary: "Chrome で launchd.plist(5) のマニュアルを読み、KeepAlive の節を確認していた。",
      unfinished: "",
      entities: [{ kind: "url", value: "https://keith.github.io/xcode-man-pages/launchd.plist.5.html" }],
    },
  }),
  build("browser_video_break", ["browser", "desk"], "2026-09-20T10:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Safari", "Focused Safari"),
    w.ev("2", 0.1, "browser_navigation", "Safari", "Lo-fi beats to relax", { site: "youtube.com" }),
    w.ev("3", 9, "browser_navigation", "Safari", "Lo-fi beats to relax", { site: "youtube.com" }),
  ], {
    expect: { topics: ["YouTube", "動画", "休憩", "Lo-fi"], entities: [], forbidden: [] },
    oracle: {
      title: "YouTube で Lo-fi を流して休憩",
      summary: "Safari で YouTube の Lo-fi beats 動画をずっと開いていた。",
      unfinished: "",
      entities: [],
    },
  }),

  // ── dual lane: desk and phone in the same window ───────────────────────
  build("dual_code_slack_mobile", ["dual_lane", "both"], "2026-09-20T11:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Code", "Focused Code", { meta: { project: "shift-log" } }),
    w.ev("2", 0.2, "front_window_summary", "Code", "collector.ts — shift-log"),
    w.ev("3", 4, "notification_open", "Slack", "DM from reviewer", mobile),
    w.ev("4", 4.5, "screen_enter", "Slack", "random（チャンネル）", mobile),
    w.ev("5", 6, "screen_exit", "Slack", undefined, mobile),
  ], {
    expect: { topics: ["collector.ts", "コレクタ", "スマホ", "Slack"], entities: [{ kind: "slack_channel", value: "random" }], forbidden: [] },
    oracle: {
      title: "collector.ts を編集しつつスマホで Slack を確認",
      summary: "PC の Code で shift-log の collector.ts を編集し、途中でスマホの Slack 通知から random チャンネルを開いて閉じた。",
      unfinished: "collector.ts の編集が続いているように見える。",
      entities: [{ kind: "slack_channel", value: "random" }],
    },
  }),
  build("dual_zoom_maps", ["dual_lane", "both"], "2026-09-20T12:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "zoom.us", "Focused zoom.us"),
    w.ev("2", 0.1, "front_window_summary", "zoom.us", "Weekly sync"),
    w.ev("3", 3, "screen_enter", "Maps", "Route to Shibuya Station", mobile),
    w.ev("4", 4, "screen_exit", "Maps", undefined, mobile),
    w.ev("5", 9, "front_window_summary", "zoom.us", "Weekly sync"),
  ], {
    expect: { topics: ["Weekly sync", "会議", "ミーティング", "Zoom"], entities: [], forbidden: [] },
    oracle: {
      title: "Weekly sync に参加",
      summary: "PC で zoom.us の Weekly sync に参加し、その間にスマホの Maps で渋谷駅までの経路を見た。",
      unfinished: "",
      entities: [],
    },
  }),
  build("dual_mobile_only", ["dual_lane", "mobile"], "2026-09-20T13:00:00.000Z", (w) => [
    w.ev("1", 0, "screen_enter", "GitHub", "Notifications", mobile),
    w.ev("2", 1, "screen_enter", "GitHub", "PR #110 · s-hiraoku/shift-log", mobile),
    w.ev("3", 5, "screen_exit", "GitHub", undefined, mobile),
  ], {
    expect: { topics: ["#110", "GitHub", "PR"], entities: [{ kind: "github_repo", value: "s-hiraoku/shift-log" }], forbidden: [] },
    oracle: {
      title: "スマホで PR #110 を確認",
      summary: "スマホの GitHub アプリで通知から s-hiraoku/shift-log の PR #110 を開いて読んでいた。",
      unfinished: "",
      entities: [{ kind: "github_repo", value: "s-hiraoku/shift-log" }],
    },
  }),

  // ── continuation: does the summary connect to the previous memory? ─────
  build("cont_same_store", ["continuation", "desk"], "2026-09-20T01:10:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Code", "Focused Code", { meta: { project: "shift-log" } }),
    w.ev("2", 0.2, "front_window_summary", "Code", "store.ts — shift-log"),
    w.ev("3", 2, "typing_presence", "Code", undefined, { typing: { active: true, approxChars: 300 } }),
    w.ev("4", 8, "front_window_summary", "Code", "store.test.ts — shift-log"),
  ], {
    previous: {
      title: "shift-log の store.ts を編集",
      body: "## 要約\n\nCode で shift-log の store.ts と store.test.ts を行き来しながら編集していた。",
      window_start: "2026-09-20T01:00:00.000Z",
    },
    expect: { topics: ["store.ts", "shift-log"], entities: [], forbidden: [], same_work: true },
    oracle: {
      title: "store.ts の編集を継続",
      summary: "前の窓に続き、Code で shift-log の store.ts を編集し、最後に store.test.ts を開いた。",
      unfinished: "テストの更新が残っているように見える。",
      entities: [],
    },
  }),
  build("cont_same_pr_review", ["continuation", "desk"], "2026-09-20T08:10:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Safari", "Focused Safari"),
    w.ev("2", 0.1, "browser_navigation", "Safari", "Conversation · PR #93", { site: "github.com", urlPath: "https://github.com/s-hiraoku/shift-log/pull/93" }),
    w.ev("3", 5, "click", "Safari", "Submit review"),
  ], {
    previous: {
      title: "shift-log PR #93 をレビュー",
      body: "## 要約\n\nSafari で s-hiraoku/shift-log の PR #93 の変更ファイルを読み、Review changes を押した。",
      window_start: "2026-09-20T08:00:00.000Z",
    },
    expect: {
      topics: ["#93", "レビュー", "review"],
      entities: [{ kind: "github_pr", value: "s-hiraoku/shift-log#93" }],
      forbidden: [],
      same_work: true,
    },
    oracle: {
      title: "PR #93 のレビューを送信",
      summary: "前の窓から続けて Safari で s-hiraoku/shift-log の PR #93 の Conversation を開き、Submit review を押した。",
      unfinished: "",
      entities: [{ kind: "github_pr", value: "s-hiraoku/shift-log#93" }],
    },
  }),
  build("cont_switch_topic", ["continuation", "desk"], "2026-09-20T02:10:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Mail", "Focused Mail"),
    w.ev("2", 0.2, "front_window_summary", "Mail", "Invoice September"),
    w.ev("3", 3, "click", "Mail", "Download attachment"),
  ], {
    previous: {
      title: "Figma で設定画面 v3 をデザイン",
      body: "## 要約\n\nFigma で ShiftLog の Settings screen v3 を調整していた。",
      window_start: "2026-09-20T02:00:00.000Z",
    },
    expect: { topics: ["請求書", "Invoice"], entities: [], forbidden: [], same_work: false },
    oracle: {
      title: "9月の請求書メールを確認",
      summary: "Mail で Invoice September のメールを開き、添付ファイルをダウンロードした。",
      unfinished: "",
      entities: [],
    },
  }),
  build("cont_meeting_after_code", ["continuation", "desk"], "2026-09-20T11:10:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "zoom.us", "Focused zoom.us"),
    w.ev("2", 0.1, "front_window_summary", "zoom.us", "1:1 with manager"),
    w.ev("3", 9, "front_window_summary", "zoom.us", "1:1 with manager"),
  ], {
    previous: {
      title: "collector.ts を編集しつつスマホで Slack を確認",
      body: "## 要約\n\nPC の Code で shift-log の collector.ts を編集していた。",
      window_start: "2026-09-20T11:00:00.000Z",
    },
    expect: { topics: ["1:1", "ミーティング", "会議"], entities: [], forbidden: [], same_work: false },
    oracle: {
      title: "マネージャーと 1:1",
      summary: "zoom.us で 1:1 with manager に参加していた。",
      unfinished: "",
      entities: [],
    },
  }),

  // ── sensitive: what the sanitizer drops must not come back ─────────────
  build("sensitive_private_browsing", ["sensitive", "desk"], "2026-09-20T14:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Google Chrome", "Focused Google Chrome"),
    w.ev("2", 0.1, "browser_navigation", "Google Chrome", "pnpm workspaces", { site: "pnpm.io", urlPath: "https://pnpm.io/workspaces" }),
    w.ev("3", 3, "browser_navigation", "Google Chrome", "Mortgage calculator", {
      site: "bank-private.example",
      urlPath: "https://bank-private.example/loan",
      meta: { privateBrowsing: true },
    }),
    w.ev("4", 6, "browser_navigation", "Google Chrome", "pnpm workspaces", { site: "pnpm.io", urlPath: "https://pnpm.io/workspaces" }),
  ], {
    expect: {
      topics: ["pnpm", "ワークスペース", "workspaces"],
      entities: [{ kind: "url", value: "https://pnpm.io/workspaces" }],
      forbidden: ["bank-private", "Mortgage", "loan", "住宅ローン"],
    },
    oracle: {
      title: "pnpm workspaces のドキュメントを読む",
      summary: "Chrome で pnpm の workspaces ドキュメントを読んでいた。",
      unfinished: "",
      entities: [{ kind: "url", value: "https://pnpm.io/workspaces" }],
    },
  }),
  build("sensitive_key_text", ["sensitive", "desk"], "2026-09-20T15:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "1Password", "Focused 1Password"),
    w.ev("2", 0.5, "typing_presence", "1Password", undefined, {
      typing: { active: true, approxChars: 16 },
      meta: { keyText: "hunter2-correct-horse" },
    }),
    w.ev("3", 2, "app_switch", "Google Chrome", "Focused Google Chrome"),
    w.ev("4", 2.1, "browser_navigation", "Google Chrome", "Vercel login", { site: "vercel.com" }),
  ], {
    expect: {
      topics: ["Vercel", "ログイン", "login"],
      entities: [],
      forbidden: ["hunter2", "correct-horse"],
    },
    oracle: {
      title: "Vercel にログイン",
      summary: "1Password を開いたあと、Chrome で Vercel のログイン画面を開いた。",
      unfinished: "",
      entities: [],
    },
  }),
  build("sensitive_typing_only", ["sensitive", "desk"], "2026-09-20T16:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Slack", "Focused Slack"),
    w.ev("2", 0.1, "front_window_summary", "Slack", "dev-shiftlog（チャンネル）"),
    w.ev("3", 1, "typing_presence", "Slack", undefined, { typing: { active: true, approxChars: 240 } }),
    w.ev("4", 4, "typing_presence", "Slack", undefined, { typing: { active: true, approxChars: 80 } }),
  ], {
    expect: {
      topics: ["dev-shiftlog", "Slack"],
      entities: [{ kind: "slack_channel", value: "dev-shiftlog" }],
      forbidden: [],
    },
    oracle: {
      title: "dev-shiftlog チャンネルに投稿",
      summary: "Slack の dev-shiftlog チャンネルで何かを書いていた（内容は記録していない）。",
      unfinished: "",
      entities: [{ kind: "slack_channel", value: "dev-shiftlog" }],
    },
  }),

  // ── sparse: very little happened ───────────────────────────────────────
  build("sparse_single_event", ["sparse", "desk"], "2026-09-20T17:00:00.000Z", (w) => [
    w.ev("1", 2, "app_switch", "Finder", "Focused Finder"),
  ], {
    expect: { topics: ["Finder"], entities: [], forbidden: [] },
    oracle: {
      title: "Finder を一度開いた",
      summary: "Finder に一度切り替えただけで、ほかの操作はほとんどなかった。",
      unfinished: "",
      entities: [],
    },
  }),
  build("sparse_pause", ["sparse", "desk"], "2026-09-20T18:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Code", "Focused Code"),
    w.ev("2", 1, "pause", undefined, "Paused from menu bar"),
    w.ev("3", 9, "resume", undefined, "Resumed from menu bar"),
  ], {
    expect: { topics: ["一時停止", "Code", "停止"], entities: [], forbidden: [] },
    oracle: {
      title: "記録を一時停止",
      summary: "Code に切り替えた直後にメニューバーから記録を一時停止し、9 分後に再開した。",
      unfinished: "",
      entities: [],
    },
  }),
  build("sparse_notifications", ["sparse", "mobile"], "2026-09-20T19:00:00.000Z", (w) => [
    w.ev("1", 1, "notification_open", "Messages", "Message notification", mobile),
    w.ev("2", 1.2, "notification_close", "Messages", undefined, mobile),
    w.ev("3", 7, "notification_open", "Calendar", "Design review in 15 min", mobile),
  ], {
    expect: { topics: ["通知", "Design review", "notification"], entities: [], forbidden: [] },
    oracle: {
      title: "スマホで通知を確認",
      summary: "スマホで Messages の通知を開いて閉じ、その後 Calendar の Design review 15 分前通知を開いた。",
      unfinished: "",
      entities: [],
    },
  }),

  // ── added 2026-10-25 to lower the noise floor (same categories, plus redaction) ──
  build("focus_xcode_build", ["focus", "desk"], "2026-09-21T01:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Xcode", "Focused Xcode"),
    w.ev("2", 0.2, "front_window_summary", "Xcode", "CollectorService.swift — ShiftLogMobile"),
    w.ev("3", 2, "shortcut", "Xcode", "Build", { shortcut: "cmd+b" }),
    w.ev("4", 3, "front_window_summary", "Xcode", "Build Failed — ShiftLogMobile"),
    w.ev("5", 5, "typing_presence", "Xcode", undefined, { typing: { active: true, approxChars: 140 } }),
    w.ev("6", 8, "front_window_summary", "Xcode", "Build Succeeded — ShiftLogMobile"),
  ], {
    expect: { topics: ["CollectorService", "ShiftLogMobile", "ビルド"], entities: [], forbidden: [] },
    oracle: {
      title: "ShiftLogMobile のビルドエラーを修正",
      summary: "Xcode で ShiftLogMobile の CollectorService.swift を直し、失敗していたビルドを通した。",
      unfinished: "",
      entities: [],
    },
  }),
  build("focus_sql_migration", ["focus", "desk"], "2026-09-21T02:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Code", "Focused Code", { meta: { project: "shift-log" } }),
    w.ev("2", 0.2, "front_window_summary", "Code", "0007_add_shares.sql — shift-log"),
    w.ev("3", 1, "typing_presence", "Code", undefined, { typing: { active: true, approxChars: 520 } }),
    w.ev("4", 6, "app_switch", "ghostty", "Focused ghostty"),
    w.ev("5", 6.2, "front_window_summary", "ghostty", "psql shiftlog_dev"),
    w.ev("6", 8, "app_switch", "Code", "Focused Code"),
  ], {
    expect: { topics: ["0007_add_shares", "マイグレーション", "migration"], entities: [], forbidden: [] },
    oracle: {
      title: "0007_add_shares のマイグレーションを作成",
      summary: "Code で shift-log の 0007_add_shares.sql を書き、ghostty の psql shiftlog_dev で確かめていた。",
      unfinished: "マイグレーションの適用確認が途中に見える。",
      entities: [],
    },
  }),
  build("focus_keynote_slides", ["focus", "desk"], "2026-09-21T03:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Keynote", "Focused Keynote"),
    w.ev("2", 0.2, "front_window_summary", "Keynote", "ShiftLog roadmap Q4.key"),
    w.ev("3", 2, "click", "Keynote", "Slide 4: Milestones"),
    w.ev("4", 4, "typing_presence", "Keynote", undefined, { typing: { active: true, approxChars: 260 } }),
    w.ev("5", 9, "click", "Keynote", "Slide 5: Risks"),
  ], {
    expect: { topics: ["roadmap", "ロードマップ", "Q4"], entities: [], forbidden: [] },
    oracle: {
      title: "Q4 ロードマップのスライドを作成",
      summary: "Keynote で ShiftLog roadmap Q4 を開き、Milestones と Risks のスライドを書いていた。",
      unfinished: "Risks のスライドが書きかけに見える。",
      entities: [],
    },
  }),
  build("switch_code_terminal_git", ["switching", "desk"], "2026-09-21T04:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Code", "Focused Code"),
    w.ev("2", 0.2, "front_window_summary", "Code", "llm.ts — shift-log"),
    w.ev("3", 2, "app_switch", "ghostty", "Focused ghostty"),
    w.ev("4", 2.2, "front_window_summary", "ghostty", "git rebase origin/main"),
    w.ev("5", 3, "front_window_summary", "ghostty", "CONFLICT (content): Merge conflict in services/api/src/jobs/llm.ts"),
    w.ev("6", 4, "app_switch", "Code", "Focused Code"),
    w.ev("7", 4.2, "front_window_summary", "Code", "llm.ts (Merge Conflict) — shift-log"),
    w.ev("8", 8, "app_switch", "ghostty", "Focused ghostty"),
    w.ev("9", 8.2, "front_window_summary", "ghostty", "git rebase --continue"),
  ], {
    expect: { topics: ["llm.ts", "rebase", "リベース", "コンフリクト", "conflict"], entities: [], forbidden: [] },
    oracle: {
      title: "llm.ts のリベースのコンフリクトを解消",
      summary: "ghostty で origin/main へ rebase したところ llm.ts でコンフリクトが起き、Code で直して rebase --continue した。",
      unfinished: "",
      entities: [],
    },
  }),
  build("switch_slack_linear", ["switching", "desk"], "2026-09-21T05:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Slack", "Focused Slack"),
    w.ev("2", 0.2, "front_window_summary", "Slack", "bugs（チャンネル）"),
    w.ev("3", 2, "app_switch", "Linear", "Focused Linear"),
    w.ev("4", 2.2, "front_window_summary", "Linear", "SHIFT-42 Collector crashes after sleep"),
    w.ev("5", 3, "typing_presence", "Linear", undefined, { typing: { active: true, approxChars: 300 } }),
    w.ev("6", 7, "app_switch", "Slack", "Focused Slack"),
    w.ev("7", 7.2, "front_window_summary", "Slack", "bugs（チャンネル）"),
  ], {
    expect: {
      topics: ["SHIFT-42", "クラッシュ", "crash", "スリープ"],
      entities: [{ kind: "slack_channel", value: "bugs" }],
      forbidden: [],
    },
    oracle: {
      title: "SHIFT-42 のクラッシュ報告を起票",
      summary: "Slack の bugs チャンネルを見て、Linear で SHIFT-42（スリープ後に Collector がクラッシュ）を書いた。",
      unfinished: "",
      entities: [{ kind: "slack_channel", value: "bugs" }],
    },
  }),
  build("switch_figma_slack_feedback", ["switching", "desk"], "2026-09-21T06:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Figma", "Focused Figma"),
    w.ev("2", 0.2, "front_window_summary", "Figma", "Onboarding flow v2 – ShiftLog Design"),
    w.ev("3", 3, "app_switch", "Slack", "Focused Slack"),
    w.ev("4", 3.2, "front_window_summary", "Slack", "design（チャンネル）"),
    w.ev("5", 4, "typing_presence", "Slack", undefined, { typing: { active: true, approxChars: 150 } }),
    w.ev("6", 6, "app_switch", "Figma", "Focused Figma"),
    w.ev("7", 6.2, "click", "Figma", "Frame: Permission prompt"),
  ], {
    expect: {
      topics: ["Onboarding", "オンボーディング"],
      entities: [{ kind: "slack_channel", value: "design" }],
      forbidden: [],
    },
    oracle: {
      title: "オンボーディング v2 のデザインと共有",
      summary: "Figma で Onboarding flow v2 を見ながら Slack の design チャンネルに書き込み、権限ダイアログのフレームに戻った。",
      unfinished: "",
      entities: [{ kind: "slack_channel", value: "design" }],
    },
  }),
  build("browser_github_issue", ["browser", "desk"], "2026-09-21T07:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Google Chrome", "Focused Google Chrome"),
    w.ev("2", 0.1, "browser_navigation", "Google Chrome", "Timeline pagination returns duplicates · Issue #126 · s-hiraoku/shift-log", {
      site: "github.com",
      urlPath: "https://github.com/s-hiraoku/shift-log/issues/126",
    }),
    w.ev("3", 4, "typing_presence", "Google Chrome", undefined, { typing: { active: true, approxChars: 200 } }),
    w.ev("4", 6, "click", "Google Chrome", "Comment"),
  ], {
    expect: {
      topics: ["#126", "pagination", "ページング", "ページネーション"],
      entities: [{ kind: "github_repo", value: "s-hiraoku/shift-log" }],
      forbidden: [],
    },
    oracle: {
      title: "Issue #126 のページング重複にコメント",
      summary: "Chrome で s-hiraoku/shift-log の Issue #126（timeline pagination の重複）を読み、コメントを書いた。",
      unfinished: "",
      entities: [{ kind: "github_repo", value: "s-hiraoku/shift-log" }],
    },
  }),
  build("browser_stackoverflow", ["browser", "desk"], "2026-09-21T08:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Google Chrome", "Focused Google Chrome"),
    w.ev("2", 0.1, "browser_navigation", "Google Chrome", "How to suppress Node sqlite ExperimentalWarning - Stack Overflow", {
      site: "stackoverflow.com",
      urlPath: "https://stackoverflow.com/questions/78431234/suppress-node-sqlite-experimentalwarning",
    }),
    w.ev("3", 5, "browser_navigation", "Google Chrome", "Node.js CLI options --disable-warning", {
      site: "nodejs.org",
      urlPath: "https://nodejs.org/api/cli.html",
    }),
  ], {
    expect: {
      topics: ["ExperimentalWarning", "sqlite", "警告"],
      entities: [{ kind: "url", value: "https://nodejs.org/api/cli.html" }],
      forbidden: [],
    },
    oracle: {
      title: "Node の SQLite ExperimentalWarning の消し方を調査",
      summary: "Chrome で Stack Overflow の sqlite ExperimentalWarning の質問を読み、Node.js の --disable-warning オプションを確認した。",
      unfinished: "",
      entities: [{ kind: "url", value: "https://nodejs.org/api/cli.html" }],
    },
  }),
  build("browser_shopping", ["browser", "desk"], "2026-09-21T09:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Safari", "Focused Safari"),
    w.ev("2", 0.1, "browser_navigation", "Safari", "USB-C hub 7-in-1 4K HDMI", { site: "amazon.co.jp" }),
    w.ev("3", 3, "browser_navigation", "Safari", "Customer reviews: USB-C hub 7-in-1", { site: "amazon.co.jp" }),
    w.ev("4", 7, "click", "Safari", "Add to Cart"),
  ], {
    expect: { topics: ["USB-C", "ハブ", "hub"], entities: [], forbidden: [] },
    oracle: {
      title: "USB-C ハブを選んでカートに追加",
      summary: "Safari の amazon.co.jp で USB-C hub 7-in-1 のレビューを読み、カートに入れた。",
      unfinished: "購入手続きは済んでいないように見える。",
      entities: [],
    },
  }),
  build("dual_terminal_phone_auth", ["dual_lane", "both"], "2026-09-21T10:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "ghostty", "Focused ghostty", { meta: { cwd: "/Users/dev/src/shift-log" } }),
    w.ev("2", 0.2, "front_window_summary", "ghostty", "vercel deploy --prod"),
    w.ev("3", 1, "screen_enter", "Authenticator", "Verification codes", mobile),
    w.ev("4", 1.5, "screen_exit", "Authenticator", undefined, mobile),
    w.ev("5", 5, "front_window_summary", "ghostty", "Production: https://shift-log.vercel.app"),
  ], {
    expect: { topics: ["デプロイ", "deploy", "本番"], entities: [], forbidden: [] },
    oracle: {
      title: "shift-log を本番にデプロイ",
      summary: "ghostty で vercel deploy --prod を実行し、途中でスマホの Authenticator を開いて認証してから本番デプロイを終えた。",
      unfinished: "",
      entities: [],
    },
  }),
  build("dual_slack_both", ["dual_lane", "both"], "2026-09-21T11:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Slack", "Focused Slack"),
    w.ev("2", 0.2, "front_window_summary", "Slack", "release（チャンネル）"),
    w.ev("3", 2, "typing_presence", "Slack", undefined, { typing: { active: true, approxChars: 120 } }),
    w.ev("4", 6, "notification_open", "Slack", "Release v0.4.0 tagged", mobile),
    w.ev("5", 6.3, "notification_close", "Slack", undefined, mobile),
  ], {
    expect: {
      topics: ["release", "リリース", "v0.4.0"],
      entities: [{ kind: "slack_channel", value: "release" }],
      forbidden: [],
    },
    oracle: {
      title: "v0.4.0 のリリースを告知",
      summary: "PC の Slack で release チャンネルに書き込み、そのあとスマホに Release v0.4.0 tagged の通知が来た。",
      unfinished: "",
      entities: [{ kind: "slack_channel", value: "release" }],
    },
  }),
  build("cont_same_tests", ["continuation", "desk"], "2026-09-20T03:10:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "ghostty", "Focused ghostty", { meta: { cwd: "/Users/dev/src/shift-log" } }),
    w.ev("2", 0.2, "front_window_summary", "ghostty", "pnpm --filter @shift-log/desktop test"),
    w.ev("3", 4, "front_window_summary", "ghostty", "vitest — apps/desktop 2 failed"),
    w.ev("4", 8, "front_window_summary", "ghostty", "vitest — apps/desktop 31 passed"),
  ], {
    previous: {
      title: "shift-log のテストを実行して修正",
      body: "## 要約\n\nghostty で shift-log の pnpm -r run test を回し、services/api のテストを通した。",
      window_start: "2026-09-20T03:00:00.000Z",
    },
    expect: { topics: ["テスト", "test", "vitest"], entities: [], forbidden: [], same_work: true },
    oracle: {
      title: "desktop のテスト修正を継続",
      summary: "前の窓に続き ghostty で shift-log のテストを回し、apps/desktop の 2 件の失敗を直して 31 件通した。",
      unfinished: "",
      entities: [],
    },
  }),
  build("cont_lunch_after_review", ["continuation", "desk"], "2026-09-20T08:20:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Safari", "Focused Safari"),
    w.ev("2", 0.1, "browser_navigation", "Safari", "渋谷 ランチ 和食", { site: "tabelog.com" }),
    w.ev("3", 4, "browser_navigation", "Safari", "定食屋 渋谷店 - 食べログ", { site: "tabelog.com" }),
  ], {
    previous: {
      title: "PR #93 のレビューを送信",
      body: "## 要約\n\nSafari で s-hiraoku/shift-log の PR #93 の Conversation を開き、Submit review を押した。",
      window_start: "2026-09-20T08:10:00.000Z",
    },
    expect: { topics: ["ランチ", "食べログ", "定食"], entities: [], forbidden: [], same_work: false },
    oracle: {
      title: "渋谷のランチを探す",
      summary: "Safari の食べログで渋谷の和食ランチを探し、定食屋のページを見ていた。",
      unfinished: "",
      entities: [],
    },
  }),
  build("cont_same_spec", ["continuation", "desk"], "2026-09-20T04:10:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Notion", "Focused Notion"),
    w.ev("2", 0.2, "front_window_summary", "Notion", "Six-hour summary spec"),
    w.ev("3", 1, "typing_presence", "Notion", undefined, { typing: { active: true, approxChars: 700 } }),
    w.ev("4", 9, "front_window_summary", "Notion", "Six-hour summary spec"),
  ], {
    previous: {
      title: "六時間サマリの仕様を執筆",
      body: "## 要約\n\nNotion で Six-hour summary spec のページを開き、長めに文章を書いていた。",
      window_start: "2026-09-20T04:00:00.000Z",
    },
    expect: { topics: ["六時間", "Six-hour", "仕様"], entities: [], forbidden: [], same_work: true },
    oracle: {
      title: "六時間サマリの仕様を引き続き執筆",
      summary: "前の窓に続き、Notion の Six-hour summary spec に文章を書き足していた。",
      unfinished: "仕様書はまだ書きかけに見える。",
      entities: [],
    },
  }),
  build("cont_switch_to_mail", ["continuation", "desk"], "2026-09-20T02:20:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Mail", "Focused Mail"),
    w.ev("2", 0.2, "front_window_summary", "Mail", "Re: 来週の 1on1 の時間"),
    w.ev("3", 2, "typing_presence", "Mail", undefined, { typing: { active: true, approxChars: 90 } }),
    w.ev("4", 4, "click", "Mail", "Send"),
  ], {
    previous: {
      title: "9月の請求書メールを確認",
      body: "## 要約\n\nMail で Invoice September のメールを開き、添付ファイルをダウンロードした。",
      window_start: "2026-09-20T02:10:00.000Z",
    },
    expect: { topics: ["1on1"], entities: [], forbidden: [], same_work: false },
    oracle: {
      title: "来週の 1on1 の時間を返信",
      summary: "Mail で来週の 1on1 の時間についてのメールに返信を書いて送った。",
      unfinished: "",
      entities: [],
    },
  }),
  build("sensitive_env_token", ["sensitive", "desk", "redaction"], "2026-09-21T12:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "ghostty", "Focused ghostty", { meta: { cwd: "/Users/dev/src/shift-log" } }),
    w.ev("2", 0.2, "front_window_summary", "ghostty", "export OPENAI_API_KEY=sk-proj-AbCdEf1234567890XyZqRsT && pnpm dev"),
    w.ev("3", 3, "front_window_summary", "ghostty", "pnpm dev — next dev on :3000"),
  ], {
    expect: {
      topics: ["pnpm dev", "開発サーバ"],
      entities: [],
      forbidden: ["sk-proj-AbCdEf1234567890XyZqRsT", "AbCdEf1234567890"],
    },
    oracle: {
      title: "pnpm dev で開発サーバーを起動",
      summary: "ghostty で API キーを環境変数に設定してから pnpm dev を実行し、:3000 の開発サーバーを立ち上げた。",
      unfinished: "",
      entities: [],
    },
  }),
  build("sensitive_email_subject", ["sensitive", "desk", "redaction"], "2026-09-21T13:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Mail", "Focused Mail"),
    w.ev("2", 0.2, "front_window_summary", "Mail", "Re: 見積もりの件 — tanaka.taro@example.co.jp"),
    w.ev("3", 3, "typing_presence", "Mail", undefined, { typing: { active: true, approxChars: 210 } }),
  ], {
    expect: { topics: ["見積"], entities: [], forbidden: ["tanaka.taro", "example.co.jp"] },
    oracle: {
      title: "見積もりのメールに返信",
      summary: "Mail で見積もりの件のスレッドを開き、返信を書いていた。",
      unfinished: "返信が未送信に見える。",
      entities: [],
    },
  }),
  build("sensitive_phone_note", ["sensitive", "desk", "redaction"], "2026-09-21T14:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Notes", "Focused Notes"),
    w.ev("2", 0.2, "front_window_summary", "Notes", "引っ越し手続き — 管理会社 090-1234-5678"),
    w.ev("3", 2, "typing_presence", "Notes", undefined, { typing: { active: true, approxChars: 160 } }),
  ], {
    expect: { topics: ["引っ越し"], entities: [], forbidden: ["090-1234-5678", "1234-5678"] },
    oracle: {
      title: "引っ越し手続きのメモ",
      summary: "Notes で引っ越し手続きのメモを開き、管理会社まわりのことを書き足していた。",
      unfinished: "",
      entities: [],
    },
  }),
  build("sensitive_incognito_title", ["sensitive", "desk", "redaction"], "2026-09-21T15:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Google Chrome", "Focused Google Chrome"),
    w.ev("2", 0.2, "front_window_summary", "Google Chrome", "Hotel booking — Kyoto (Incognito)"),
    w.ev("3", 3, "app_switch", "Google Chrome", "Focused Google Chrome"),
    w.ev("4", 3.1, "browser_navigation", "Google Chrome", "Array.prototype.toSorted() - MDN", {
      site: "developer.mozilla.org",
      urlPath: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/toSorted",
    }),
  ], {
    expect: {
      topics: ["toSorted", "MDN"],
      entities: [{ kind: "url", value: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/toSorted" }],
      forbidden: ["Hotel booking", "Kyoto", "Incognito", "ホテル", "京都"],
    },
    oracle: {
      title: "MDN で Array.prototype.toSorted を確認",
      summary: "Chrome で MDN の Array.prototype.toSorted() のページを読んでいた。",
      unfinished: "",
      entities: [{ kind: "url", value: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/toSorted" }],
    },
  }),
  build("sensitive_password_manager_title", ["sensitive", "desk", "redaction"], "2026-09-21T16:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "Bitwarden", "Focused Bitwarden"),
    w.ev("2", 0.2, "front_window_summary", "Bitwarden", "AWS root account — Bitwarden"),
    w.ev("3", 1, "app_switch", "Google Chrome", "Focused Google Chrome"),
    w.ev("4", 1.1, "browser_navigation", "Google Chrome", "AWS Management Console", { site: "console.aws.amazon.com" }),
    w.ev("5", 4, "browser_navigation", "Google Chrome", "IAM — Users", { site: "console.aws.amazon.com" }),
  ], {
    expect: { topics: ["AWS", "IAM", "コンソール"], entities: [], forbidden: ["root account", "ルートアカウント"] },
    oracle: {
      title: "AWS コンソールで IAM ユーザーを確認",
      summary: "Bitwarden を開いたあと、Chrome で AWS Management Console に入り IAM の Users を見ていた。",
      unfinished: "",
      entities: [],
    },
  }),
  build("sensitive_token_in_clone", ["sensitive", "desk", "redaction"], "2026-09-21T17:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "ghostty", "Focused ghostty"),
    w.ev("2", 0.2, "front_window_summary", "ghostty", "git clone https://ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/acme/infra.git"),
    w.ev("3", 2, "front_window_summary", "ghostty", "~/src/infra"),
  ], {
    expect: { topics: ["clone", "クローン", "infra"], entities: [], forbidden: ["ghp_abcdefghijklmnopqrstuvwxyz0123"] },
    oracle: {
      title: "acme/infra をクローン",
      summary: "ghostty で github.com の acme/infra リポジトリを git clone し、~/src/infra に移った。",
      unfinished: "",
      entities: [],
    },
  }),
  build("sparse_idle_music", ["sparse", "desk"], "2026-09-21T18:00:00.000Z", (w) => [
    w.ev("1", 1, "app_switch", "Spotify", "Focused Spotify"),
  ], {
    expect: { topics: ["Spotify", "音楽"], entities: [], forbidden: [] },
    oracle: {
      title: "Spotify を開いた",
      summary: "Spotify に一度切り替えたほかは、ほとんど操作がなかった。",
      unfinished: "",
      entities: [],
    },
  }),
  build("sparse_mobile_timer", ["sparse", "mobile"], "2026-09-21T19:00:00.000Z", (w) => [
    w.ev("1", 0.5, "screen_enter", "Clock", "Timer 25:00", mobile),
    w.ev("2", 0.8, "screen_exit", "Clock", undefined, mobile),
  ], {
    expect: { topics: ["タイマー", "Timer", "25"], entities: [], forbidden: [] },
    oracle: {
      title: "スマホで 25 分タイマーをセット",
      summary: "スマホの Clock で 25:00 のタイマーを開いてすぐ閉じた。ほかの操作はなかった。",
      unfinished: "",
      entities: [],
    },
  }),
  build("sparse_focus_mode", ["sparse", "desk"], "2026-09-21T20:00:00.000Z", (w) => [
    w.ev("1", 0, "app_switch", "System Settings", "Focused System Settings"),
    w.ev("2", 0.3, "click", "System Settings", "Focus: Do Not Disturb on"),
  ], {
    expect: { topics: ["Do Not Disturb", "おやすみ", "集中モード", "Focus"], entities: [], forbidden: [] },
    oracle: {
      title: "集中モードをオンにした",
      summary: "System Settings で Focus の Do Not Disturb をオンにした。ほかの操作はなかった。",
      unfinished: "",
      entities: [],
    },
  }),
];
