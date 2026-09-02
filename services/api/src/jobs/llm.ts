import type { InteractionEvent, WindowUpload } from "@shift-log/schema";

export type LlmSummary = {
  title: string;
  body: string;
};

function llmConfigured(): boolean {
  return Boolean(process.env.SHIFTLOG_LLM_API_KEY);
}

/**
 * Optional OpenAI-compatible chat completion.
 * Never sends keystroke text (callers must pass already-sanitized events).
 * Returns null when unset or on any failure — caller falls back to template.
 */
export async function summarizeWithLlm(
  upload: WindowUpload,
  fetchImpl: typeof fetch = fetch,
): Promise<LlmSummary | null> {
  if (!llmConfigured()) return null;
  const key = process.env.SHIFTLOG_LLM_API_KEY!;
  const base = (process.env.SHIFTLOG_LLM_BASE_URL ?? "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const model = process.env.SHIFTLOG_LLM_MODEL ?? "gpt-4o-mini";
  const events = upload.events.slice(0, 40).map((e: InteractionEvent) => ({
    type: e.type,
    ts: e.ts,
    device: e.device,
    app: e.app,
    site: e.site,
    summary: e.summary,
  }));
  const prompt = [
    "Summarize this 10-minute activity window as Japanese Markdown.",
    "Do not invent keystrokes, screenshots, or private-browsing activity.",
    "Return JSON {\"title\": string, \"body\": string} only.",
    `window: ${upload.metadata.window_start} → ${upload.metadata.window_end}`,
    `events: ${JSON.stringify(events)}`,
  ].join("\n");

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
    const parsed = JSON.parse(content) as Partial<LlmSummary>;
    if (!parsed.title || !parsed.body) return null;
    return { title: String(parsed.title).slice(0, 120), body: String(parsed.body) };
  } catch {
    return null;
  }
}
