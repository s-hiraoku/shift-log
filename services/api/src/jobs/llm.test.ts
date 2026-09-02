import { afterEach, describe, expect, it } from "vitest";
import { summarizeWithLlm } from "./llm.js";
import { deterministicTenMinuteBody, summarizeTenMinuteWindow } from "./summarize.js";
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

  it("parses a chat-completion JSON object", async () => {
    process.env.SHIFTLOG_LLM_API_KEY = "sk-test";
    const out = await summarizeWithLlm(sampleUpload(), async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Code — LLM",
                  body: "## 作業サマリ\n- persist.ts",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    expect(out).toEqual({
      title: "Code — LLM",
      body: "## 作業サマリ\n- persist.ts",
    });
  });

  it("falls back to the template when the provider is unset", async () => {
    delete process.env.SHIFTLOG_LLM_API_KEY;
    const store = new MemoryStore("llm-fallback");
    const upload = sampleUpload();
    const fallback = deterministicTenMinuteBody(upload);
    const record = await summarizeTenMinuteWindow(store, upload);
    expect(record.front_matter.title).toBe(fallback.title);
    expect(record.body).toContain("作業サマリ");
  });
});
