import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import {
  ContinueContextRequestSchema,
  ContinueContextResponseSchema,
  MemoryRecordSchema,
  TimelineQuerySchema,
} from "@shift-log/schema";
import { z } from "zod";
import type { ApiFailure, ApiOutcome, CallShiftLog, ReadOnlyCall } from "./shiftlog-api.js";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const AgentRecentResponseSchema = z.object({
  mode: z.literal("context_only"),
  memories: z.array(MemoryRecordSchema),
  note: z.string(),
});

const TimelineInputSchema = TimelineQuerySchema.pick({
  q: true,
  limit: true,
  kind: true,
  since: true,
  until: true,
});

const TimelineOutputSchema = z.object({
  items: z.array(MemoryRecordSchema),
  next_cursor: z.null(),
});

const SearchInputSchema = TimelineQuerySchema.pick({
  limit: true,
  kind: true,
  since: true,
  until: true,
}).extend({
  q: z.string().trim().min(1),
});

const SearchOutputSchema = z.object({
  items: z.array(MemoryRecordSchema),
});

const RecentInputSchema = z.object({
  limit: z.number().int().min(1).max(36).default(12),
});

// encodeURIComponent("..") stays "..", and /v1/memories/.. resolves to /v1/.
const MemoryIdSchema = z
  .string()
  .min(1)
  .refine(
    (id) => id !== "." && id !== ".." && !id.includes("/") && !id.includes("\\"),
    "memory id must be a single path segment",
  );

type ToolSpec<I, O extends Record<string, unknown>> = {
  title: string;
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  toCall: (input: I) => ReadOnlyCall;
};

type Tool = {
  register(server: McpServer, name: string, callApi: CallShiftLog): void;
};

function tool<I, O extends Record<string, unknown>>(spec: ToolSpec<I, O>): Tool {
  return {
    register(server, name, callApi) {
      server.registerTool(
        name,
        {
          title: spec.title,
          description: spec.description,
          inputSchema: spec.input,
          outputSchema: spec.output,
          annotations: READ_ONLY,
        },
        async (input) => {
          const parsed = spec.input.parse(input);
          return toToolResult(await callApi(spec.toCall(parsed), spec.output));
        },
      );
    },
  };
}

const TOOLS = {
  recent_memories: tool({
    title: "Recent ShiftLog memories",
    description:
      "Newest activity memories, newest first. Returns mode context_only. " +
      "Use it as chat context. Do not operate the user's computer. Do not send a mode argument. " +
      "limit is an integer from 1 to 36 (default 12).",
    input: RecentInputSchema,
    output: AgentRecentResponseSchema,
    toCall: ({ limit }) => ({ method: "GET", path: "/v1/agent/recent", query: { limit } }),
  }),
  continue_context: tool({
    title: "Context to continue prior work",
    description:
      "For continue requests. Keyword hits come first, then the newest memories. " +
      "Keywords match title, description, body, apps, and entities[].value. They do not match entity kind. " +
      "since and until filter window_start and must be UTC ISO 8601 ending in Z. " +
      "Returns mode context_only. Do not send a mode argument.",
    input: ContinueContextRequestSchema,
    output: ContinueContextResponseSchema,
    toCall: (body) => ({ method: "POST", path: "/v1/agent/continue", body }),
  }),
  timeline: tool({
    title: "Memory timeline",
    description:
      "Memories newest first. Optional q matches title, description, body, apps, and entities[].value. " +
      "Optional kind is ten_minute or six_hour. since and until filter window_start and must end in Z. " +
      "limit is 1 to 100, default 50. There is no cursor. next_cursor is null.",
    input: TimelineInputSchema,
    output: TimelineOutputSchema,
    toCall: (query) => ({ method: "GET", path: "/v1/timeline", query }),
  }),
  search_memories: tool({
    title: "Search memories",
    description:
      "Case-insensitive substring search over title, description, body, apps, and entities[].value. " +
      "Entity kind is not searchable. q is required.",
    input: SearchInputSchema,
    output: SearchOutputSchema,
    toCall: (query) => ({ method: "GET", path: "/v1/search", query }),
  }),
  get_memory: tool({
    title: "Get one memory",
    description:
      "One memory by id. Ids come from recent_memories, continue_context, timeline, or search_memories.",
    input: z.object({ id: MemoryIdSchema }),
    output: MemoryRecordSchema,
    toCall: ({ id }) => ({ method: "GET", path: "/v1/memories/:id", id }),
  }),
} satisfies Record<string, Tool>;

export function buildServer(callApi: CallShiftLog): McpServer {
  const server = new McpServer({ name: "shiftlog", version: "0.1.0" });
  for (const [name, entry] of Object.entries(TOOLS)) {
    entry.register(server, name, callApi);
  }
  return server;
}

export function toToolResult<T extends Record<string, unknown>>(
  outcome: ApiOutcome<T>,
): CallToolResult {
  if (!outcome.ok) {
    return { isError: true, content: [{ type: "text", text: describeFailure(outcome.failure) }] };
  }
  return {
    structuredContent: outcome.value,
    content: [{ type: "text", text: JSON.stringify(outcome.value) }],
  };
}

export function describeFailure(failure: ApiFailure): string {
  switch (failure.reason) {
    case "unreachable":
      return `unreachable: no ShiftLog API at ${failure.origin}. The operator should check com.shiftlog.api.`;
    case "credentials_rejected":
      return "credentials_rejected: the ShiftLog API refused this server's SHIFTLOG_API_TOKEN. The operator must fix .env; retrying will not help.";
    case "not_found":
      return "not_found: no memory with that id. Use ids returned by recent_memories, timeline, or search_memories.";
    case "rate_limited":
      return "rate_limited: the ShiftLog API allows SHIFTLOG_RATE_LIMIT_PER_MIN (default 60) requests a minute. Wait and retry.";
    case "upstream_error":
      return `upstream_error ${failure.status}: ${failure.detail}`;
    case "bad_response":
      return `bad_response: the ShiftLog API returned an unexpected shape (${failure.detail}).`;
    default: {
      const unhandled: never = failure;
      return unhandled;
    }
  }
}
