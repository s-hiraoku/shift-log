import { afterEach, describe, expect, it } from "vitest";
import { LlmMemorySchema } from "@shift-log/schema";
import { extractEntities } from "./entities.js";
import { summarizeWithLlm } from "./llm.js";
import { deterministicTenMinuteBody, summarizeTenMinuteWindow } from "./summarize.js";
import { ghosttySlackRoundTripUpload } from "./summarize-ten-minute.test.js";
import { MemoryStore } from "../lib/store.js";

const originalKey = process.env.SHIFTLOG_LLM_API_KEY;

function sampleUpload() {
  const end = new Date();
  const start = new Date(end.getTime() - 10 * 60_000);
  return {
    metadata: {
      window_id: "w-llm",
      window_start: start.toISOString(),
      window_end: end.toISOString(),
      devices: ["desk"] as const,
      dual_lane: false,
      event_count: 1,
      schema_version: "1" as const,
    },
    events: [
      {
        id: "e1",
        type: "app_switch" as const,
        ts: start.toISOString(),
        device: "desk" as const,
        app: "Code",
        summary: "Editing persist.ts",
      },
    ],
  };
}

afterEach(() => {
  if (originalKey === undefined) delete process.env.SHIFTLOG_LLM_API_KEY;
  else process.env.SHIFTLOG_LLM_API_KEY = originalKey;
});

describe("LlmMemorySchema", () => {
  it("accepts title, summary, unfinished, and entities", () => {
    const parsed = LlmMemorySchema.parse({
      title: "ghostty と Slack",
      summary: "ghostty で作業し、Slack のチャンネルを見ていた。",
      unfinished: "PR レビューが途中",
      entities: [{ kind: "slack_channel", value: "team_frontend-pr-n10n" }],
    });
    expect(parsed.entities).toEqual([
      { kind: "slack_channel", value: "team_frontend-pr-n10n" },
    ]);
  });

  it("rejects a free-form title/body payload", () => {
    const parsed = LlmMemorySchema.safeParse({
      title: "Code — LLM",
      body: "## 作業サマリ\n- persist.ts",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("extractEntities", () => {
  it("reads slack_channel and github_repo from the #34 desk window without an LLM", () => {
    const upload = ghosttySlackRoundTripUpload();
    const fallback = deterministicTenMinuteBody(upload);
    const entities = extractEntities(upload, fallback.aggregate);
    expect(entities).toContainEqual({
      kind: "slack_channel",
      value: "team_frontend-pr-n10n",
    });
    expect(entities).toContainEqual({
      kind: "github_repo",
      value: "DietrichGebert/ponytail",
    });
  });
});

describe("optional LLM summarization", () => {
  it("returns null when no API key is configured", async () => {
    delete process.env.SHIFTLOG_LLM_API_KEY;
    const called: string[] = [];
    const out = await summarizeWithLlm(sampleUpload(), async (url) => {
      called.push(String(url));
      return new Response("{}", { status: 200 });
    });
    expect(out).toBeNull();
    expect(called).toEqual([]);
  });

  it("parses a chat-completion JSON object against LlmMemorySchema", async () => {
    process.env.SHIFTLOG_LLM_API_KEY = "sk-test";
    const payload = {
      title: "Code — LLM",
      summary: "persist.ts を直していた。",
      unfinished: "",
      entities: [{ kind: "file", value: "persist.ts" }],
    };
    const out = await summarizeWithLlm(sampleUpload(), async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(payload) } }],
        }),
        { status: 200 },
      );
    });
    expect(out).toEqual(LlmMemorySchema.parse(payload));
  });

  it("returns null when the model omits summary", async () => {
    process.env.SHIFTLOG_LLM_API_KEY = "sk-test";
    const out = await summarizeWithLlm(sampleUpload(), async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ title: "Code — LLM", body: "old shape" }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    expect(out).toBeNull();
  });

  it("falls back to the template when the provider is unset and still stores entities", async () => {
    delete process.env.SHIFTLOG_LLM_API_KEY;
    const store = new MemoryStore("llm-fallback");
    const upload = ghosttySlackRoundTripUpload();
    const fallback = deterministicTenMinuteBody(upload);
    const record = await summarizeTenMinuteWindow(store, upload);
    expect(record.front_matter.title).toBe(fallback.title);
    expect(record.body).toContain("Focus span");
    expect(record.front_matter.entities).toContainEqual({
      kind: "slack_channel",
      value: "team_frontend-pr-n10n",
    });
    expect(record.front_matter.entities).toContainEqual({
      kind: "github_repo",
      value: "DietrichGebert/ponytail",
    });
  });

  it("sends the previous memory and writes a continuation summary", async () => {
    delete process.env.SHIFTLOG_LLM_API_KEY;
    const store = new MemoryStore("llm-continue");
    const first = ghosttySlackRoundTripUpload();
    await summarizeTenMinuteWindow(store, first);
    process.env.SHIFTLOG_LLM_API_KEY = "sk-test";

    const secondStart = "2026-09-11T06:49:00.000Z";
    const secondEnd = "2026-09-11T06:59:00.000Z";
    const second = {
      metadata: {
        window_id: "w-2026-09-11-0649",
        window_start: secondStart,
        window_end: secondEnd,
        devices: ["desk"] as const,
        dual_lane: false,
        event_count: 1,
        paused: false,
        schema_version: "1" as const,
      },
      events: [
        {
          id: "n1",
          type: "front_window_summary" as const,
          ts: secondStart,
          device: "desk" as const,
          app: "Slack",
          summary: "team_frontend-pr-n10n（チャンネル） - DietrichGebert/ponytail",
        },
      ],
    };

    const prompts: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { content: string }[];
      };
      prompts.push(body.messages[1]!.content);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Slack レビューの続き",
                  summary:
                    "直前の十分に続き、Slack の team_frontend-pr-n10n で ponytail のレビューを続けていた。",
                  unfinished: "レビューコメントが未投稿",
                  entities: [],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const record = await summarizeTenMinuteWindow(store, second);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("previous_memory:");
      expect(prompts[0]).toContain("ghostty");
      expect(record.body).toContain("直前の十分に続き");
      expect(record.body).toContain("Focus span");
      expect(record.front_matter.description).toContain("直前の十分に続き");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
