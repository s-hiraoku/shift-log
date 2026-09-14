import { LlmMemorySchema, type LlmMemory, type WindowUpload } from "@shift-log/schema";
import { aggregateTenMinuteWindow, type TenMinuteAggregate } from "./ten-minute.js";

export type LlmSummary = LlmMemory;

export type LlmContext = {
  aggregate?: TenMinuteAggregate;
  previous?: { title: string; body: string };
};

function llmConfigured(): boolean {
  return Boolean(process.env.SHIFTLOG_LLM_API_KEY);
}

function buildPrompt(
  upload: WindowUpload,
  aggregate: TenMinuteAggregate,
  previous?: { title: string; body: string },
): string {
  return [
    "Summarize this 10-minute activity window.",
    "Write Japanese. Do not invent keystrokes, screenshots, or private-browsing activity.",
    'Return JSON {"title": string, "summary": string, "unfinished": string, "entities": [{"kind":"github_repo"|"github_pr"|"slack_channel"|"url"|"file","value":string}]} only.',
    "title is short. summary is 2 to 3 sentences about what the person was doing.",
    "If the previous memory is the same work, write summary as a continuation of that work.",
    "unfinished is work that still looks open. Use an empty string when none.",
    `window: ${upload.metadata.window_start} -> ${upload.metadata.window_end}`,
    `dwell: ${JSON.stringify(aggregate.apps_dwell)}`,
    `top_app: ${aggregate.top_app ?? ""}`,
    `focus_spans: ${JSON.stringify(
      aggregate.spans.map((span) => ({
        start: span.start,
        end: span.end,
        app: span.app,
        title: span.title,
        site: span.site,
      })),
    )}`,
    previous
      ? `previous_memory: ${JSON.stringify({ title: previous.title, body: previous.body })}`
      : "previous_memory: null",
  ].join("\n");
}

export async function summarizeWithLlm(
  upload: WindowUpload,
  fetchImpl: typeof fetch = fetch,
  context: LlmContext = {},
): Promise<LlmMemory | null> {
  if (!llmConfigured()) return null;
  const key = process.env.SHIFTLOG_LLM_API_KEY!;
  const base = (process.env.SHIFTLOG_LLM_BASE_URL ?? "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const model = process.env.SHIFTLOG_LLM_MODEL ?? "gpt-4o-mini";
  const aggregate = context.aggregate ?? aggregateTenMinuteWindow(upload);
  const prompt = buildPrompt(upload, aggregate, context.previous);

  try {
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You write concise Computer-History-style activity memories.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = LlmMemorySchema.safeParse(JSON.parse(content));
    if (!parsed.success) return null;
    return {
      ...parsed.data,
      title: parsed.data.title.slice(0, 120),
    };
  } catch {
    return null;
  }
}

export function renderLlmBody(llm: LlmMemory, deterministicBody: string): string {
  const unfinished = llm.unfinished.trim() === "" ? "（なし）" : llm.unfinished.trim();
  return [
    "## 要約",
    "",
    llm.summary.trim(),
    "",
    "## 未完",
    "",
    unfinished,
    "",
    deterministicBody,
  ].join("\n");
}
