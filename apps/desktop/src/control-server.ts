import { createServer, type Server } from "node:http";
import type { DesktopCollector } from "./collector.js";

export type ControlState = {
  paused: boolean;
  lastApp?: string;
  lastObserveAt?: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export type ControlServerOptions = {
  port?: number;
  onQuit?: () => void;
};

export function startControlServer(
  collector: DesktopCollector,
  state: ControlState,
  opts: ControlServerOptions = {},
): Server {
  const port = opts.port ?? Number(process.env.SHIFTLOG_CONTROL_PORT ?? 8791);
  const onQuit = opts.onQuit ?? (() => process.exit(0));
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (code: number, body: unknown) => {
      const json = JSON.stringify(body);
      res.writeHead(code, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(json),
      });
      res.end(json);
    };

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/menu")) {
      const html = `<!doctype html><meta charset="utf-8"><title>ShiftLog</title>
<body style="font-family:sans-serif;background:#111;color:#eee;padding:16px">
<h1>ShiftLog</h1>
<p>paused: <b id="p">${state.paused ? "true" : "false"}</b> last: <span id="a">${escapeHtml(state.lastApp ?? "-")}</span></p>
<button onclick="post('/pause')">一時停止</button>
<button onclick="post('/resume')">再開</button>
<button onclick="post('/quit')">終了</button>
<script>
async function post(p){await fetch(p,{method:'POST'}); location.reload()}
setInterval(()=>location.reload(), 5000)
</script></body>`;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return send(200, { ok: true, ...state });
    }
    if (req.method === "POST" && url.pathname === "/pause") {
      collector.pause();
      state.paused = true;
      return send(200, { ok: true, paused: true });
    }
    if (req.method === "POST" && url.pathname === "/resume") {
      collector.resume();
      state.paused = false;
      return send(200, { ok: true, paused: false });
    }
    if (req.method === "POST" && url.pathname === "/quit") {
      send(200, { ok: true, quitting: true });
      setTimeout(() => onQuit(), 50);
      return;
    }
    return send(404, { error: "not_found" });
  });

  server.listen(port, "127.0.0.1", () => {
    const addr = server.address();
    const actual = typeof addr === "object" && addr ? addr.port : port;
    console.log(`[desktop] menu-bar control http://127.0.0.1:${actual}`);
  });
  return server;
}
