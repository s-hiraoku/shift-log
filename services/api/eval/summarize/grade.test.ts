import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmMemory } from "@shift-log/schema";
import { summarizeTenMinuteWindow } from "../../src/jobs/summarize.js";
import { sanitizeWindowUpload } from "../../src/lib/sanitize.js";
import { MemoryStore } from "../../src/lib/store.js";
import { CASES, type EvalCase } from "./cases.js";
import { gradeCase } from "./grade.js";

const originalKey = process.env.SHIFTLOG_LLM_API_KEY;

beforeEach(() => {
  process.env.SHIFTLOG_LLM_API_KEY = "eval-test";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.SHIFTLOG_LLM_API_KEY;
  else process.env.SHIFTLOG_LLM_API_KEY = originalKey;
});

function byId(id: string): EvalCase {
  const c = CASES.find((x) => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  return c;
}

/** Run one case through the production path with the LLM replying `reply`. */
async function gradeWithReply(c: EvalCase, reply: LlmMemory) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), {
        status: 200,
      }),
    ),
  );
  const store = new MemoryStore(`grade_${c.id}`);
  if (c.previous) {
    const end = new Date(Date.parse(c.previous.window_start) + 600_000).toISOString();
    store.putMemory({
      id: `mem_prev_${c.id}`,
      created_at: end,
      updated_at: end,
      front_matter: {
        title: c.previous.title,
        description: "",
        apps: [],
        device: "desk",
        window_start: c.previous.window_start,
        window_end: end,
        kind: "ten_minute",
        window_ids: [],
        skill_candidate: false,
      },
      body: c.previous.body,
    });
  }
  const sanitized = sanitizeWindowUpload(c.upload, store.permissions);
  const record = await summarizeTenMinuteWindow(store, sanitized);
  return gradeCase(c, record, sanitized);
}

describe("summarize eval graders", () => {
  it("score every hand-written oracle reply as a pass", async () => {
    for (const c of CASES) {
      const { grade, explanation } = await gradeWithReply(c, c.oracle);
      expect({ id: c.id, grade, explanation }).toMatchObject({
        grade: { pass: 1, continuity: 1, entities: 1, llm_used: 1 },
      });
    }
  });

  it("fail a generic reply on topical", async () => {
    const c = byId("focus_code_store");
    const { grade } = await gradeWithReply(c, {
      title: "作業",
      summary: "作業をしていた。",
      unfinished: "",
      entities: [],
    });
    expect(grade.topical).toBe(0);
    expect(grade.pass).toBe(0);
  });

  it("fail an app, URL, or entity the window does not contain", async () => {
    const c = byId("focus_code_store");
    for (const reply of [
      { ...c.oracle, summary: `${c.oracle.summary} Discord も見ていた。` },
      { ...c.oracle, summary: `${c.oracle.summary} https://example.com/spec を参照。` },
      { ...c.oracle, entities: [{ kind: "github_repo" as const, value: "acme/secret-repo" }] },
    ]) {
      const { grade, explanation } = await gradeWithReply(c, reply);
      expect(grade.grounded, explanation.grounded).toBe(0);
      expect(grade.pass).toBe(0);
    }
  });

  it("fail a leak of what the sanitizer dropped and claims of capture", async () => {
    const privateCase = byId("sensitive_private_browsing");
    const leak = await gradeWithReply(privateCase, {
      ...privateCase.oracle,
      summary: "pnpm のドキュメントと bank-private.example の Mortgage calculator を見ていた。",
    });
    expect(leak.grade.private).toBe(0);

    const claim = await gradeWithReply(byId("focus_figma"), {
      ...byId("focus_figma").oracle,
      summary: "Figma のスクリーンショットを撮りながら設定画面を調整していた。",
    });
    expect(claim.grade.private).toBe(0);
  });

  it("check continuation cues in both directions", async () => {
    const same = byId("cont_same_store");
    const noCue = await gradeWithReply(same, {
      ...same.oracle,
      title: "store.ts を編集",
      summary: "store.ts を編集していた。",
    });
    expect(noCue.grade.continuity).toBe(0);

    const different = byId("cont_switch_topic");
    const falseCue = await gradeWithReply(different, {
      ...different.oracle,
      summary: "前の作業の続きとして Invoice September のメールを開いた。",
    });
    expect(falseCue.grade.continuity).toBe(0);
  });

  it("keep sanitized secrets out of the stored memory even without an LLM", async () => {
    delete process.env.SHIFTLOG_LLM_API_KEY;
    for (const c of CASES.filter((x) => x.tags[0] === "sensitive")) {
      const store = new MemoryStore(`grade_fallback_${c.id}`);
      const sanitized = sanitizeWindowUpload(c.upload, store.permissions);
      const record = await summarizeTenMinuteWindow(store, sanitized);
      expect(gradeCase(c, record, sanitized).grade.private).toBe(1);
    }
  });
});
