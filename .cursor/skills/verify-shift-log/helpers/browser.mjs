#!/usr/bin/env node
/**
 * Chrome DevTools Protocol driver for verify-shift-log.
 * Uses the system google-chrome binary. No extra npm packages.
 *
 *   node browser.mjs start
 *   node browser.mjs goto /
 *   node browser.mjs click --text "有効化してデモデータを投入"
 *   node browser.mjs fill --placeholder "検索（タイトル・本文・アプリ）" --value Code
 *   node browser.mjs wait --text "準備完了"
 *   node browser.mjs snapshot --path /tmp/out.txt
 *   node browser.mjs screenshot --path /tmp/out.png
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/opt/google/chrome/chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean);

function die(msg) {
  console.error(`verify-shift-log browser: ${msg}`);
  process.exit(1);
}

function loadState() {
  const file = process.env.SHIFTLOG_VERIFY_STATE || "/tmp/shiftlog-verify-current";
  if (!existsSync(file)) die(`no state file at ${file}. Run helpers/launch.sh first.`);
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  if (!env.WEB_ORIGIN || !env.STATE_DIR) die(`incomplete state file ${file}`);
  env._file = realpathSync(file);
  return env;
}

function writeStateField(state, key, value) {
  const file = state._file;
  const lines = readFileSync(file, "utf8").split("\n");
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) next.push(`${key}=${value}`);
  writeFileSync(file, `${next.join("\n").replace(/\n+$/, "")}\n`);
}

function parseArgs(argv) {
  const cmd = argv[0];
  const flags = {};
  const positional = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      flags[key] = val;
    } else {
      positional.push(a);
    }
  }
  return { cmd, flags, positional };
}

function chromeBin() {
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  die("no Chrome/Chromium binary found");
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function waitForCdp(port, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      return await fetchJson(`http://127.0.0.1:${port}/json/version`);
    } catch {
      await sleep(200);
    }
  }
  throw new Error(`CDP on :${port} did not become ready`);
}

async function startChrome(state) {
  if (state.CHROME_PID && !Number.isNaN(Number(state.CHROME_PID))) {
    try {
      process.kill(Number(state.CHROME_PID), 0);
      await waitForCdp(state.CDP_PORT, 4000);
      return;
    } catch {
      // stale pid
    }
  }
  const profile = `${state.STATE_DIR}/chrome-profile`;
  mkdirSync(profile, { recursive: true });
  const bin = chromeBin();
  const child = spawn(
    bin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--window-size=1280,900",
      `--remote-debugging-port=${state.CDP_PORT}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  writeStateField(state, "CHROME_PID", String(child.pid));
  state.CHROME_PID = String(child.pid);
  await waitForCdp(state.CDP_PORT);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

async function connectPage(state) {
  await startChrome(state);
  const list = await fetchJson(`http://127.0.0.1:${state.CDP_PORT}/json/list`);
  let page = list.find((t) => t.type === "page");
  if (!page) {
    page = await fetchJson(`http://127.0.0.1:${state.CDP_PORT}/json/new?about:blank`);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("CDP websocket failed"));
  });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  return cdp;
}

function jsString(value) {
  return JSON.stringify(value);
}

const CLICK_FN = `
(text) => {
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const want = norm(text);
  const nodes = [...document.querySelectorAll('button, a, [role="button"], label, input[type="submit"], input[type="button"]')];
  const el = nodes.find((n) => {
    const name = norm(n.innerText || n.textContent || n.getAttribute("aria-label") || n.value || "");
    return name === want || name.includes(want);
  });
  if (!el) {
    const shown = nodes.map((n) => norm(n.innerText || n.textContent || "")).filter(Boolean).slice(0, 20);
    throw new Error("no clickable named " + JSON.stringify(want) + "; saw: " + shown.join(" | "));
  }
  el.click();
  return { tag: el.tagName, text: norm(el.innerText || el.textContent || "") };
}
`;

const FILL_PLACEHOLDER_FN = `
(placeholder, value) => {
  const el = document.querySelector('input[placeholder=' + JSON.stringify(placeholder) + ']');
  if (!el) throw new Error("no input with placeholder " + JSON.stringify(placeholder));
  el.focus();
  const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  proto.set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { value: el.value };
}
`;

const CHECK_FN = `
(labelText, checked) => {
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const want = norm(labelText);
  const labels = [...document.querySelectorAll("label")];
  const label = labels.find((l) => norm(l.innerText || l.textContent).includes(want));
  if (!label) throw new Error("no label named " + JSON.stringify(want));
  const input = label.querySelector('input[type="checkbox"]') || document.getElementById(label.getAttribute("for"));
  if (!input) throw new Error("label has no checkbox: " + JSON.stringify(want));
  if (Boolean(input.checked) !== Boolean(checked)) input.click();
  return { checked: input.checked, label: norm(label.innerText || "") };
}
`;

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(desc);
  }
  return result.result?.value;
}

async function waitText(cdp, text, timeoutMs) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    last = (await evaluate(cdp, "document.body ? document.body.innerText : ''")) || "";
    if (last.includes(text)) return last;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${JSON.stringify(text)}; last text:\n${last.slice(0, 1500)}`);
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true });
}

async function main() {
  const { cmd, flags, positional } = parseArgs(process.argv.slice(2));
  if (!cmd) {
    die("usage: browser.mjs <start|goto|click|fill|check|wait|snapshot|screenshot|eval> ...");
  }
  const state = loadState();

  if (cmd === "start") {
    await startChrome(state);
    console.log(`chrome pid=${state.CHROME_PID} cdp=:${state.CDP_PORT}`);
    return;
  }

  const cdp = await connectPage(state);
  try {
    if (cmd === "goto") {
      const path = positional[0] || "/";
      const url = path.startsWith("http") ? path : `${state.WEB_ORIGIN}${path}`;
      await cdp.send("Page.navigate", { url });
      await cdp.send("Page.loadEventFired").catch(() => {});
      await sleep(400);
      console.log(url);
      return;
    }
    if (cmd === "click") {
      const text = flags.text || positional[0];
      if (!text) die("click requires --text");
      const result = await evaluate(cdp, `(${CLICK_FN})(${jsString(text)})`);
      console.log(JSON.stringify(result));
      return;
    }
    if (cmd === "fill") {
      const placeholder = flags.placeholder;
      const value = flags.value ?? "";
      if (!placeholder) die("fill requires --placeholder and --value");
      const result = await evaluate(cdp, `(${FILL_PLACEHOLDER_FN})(${jsString(placeholder)}, ${jsString(value)})`);
      console.log(JSON.stringify(result));
      return;
    }
    if (cmd === "check") {
      const text = flags.text || positional[0];
      const checked = flags.checked !== "false";
      if (!text) die("check requires --text");
      const result = await evaluate(cdp, `(${CHECK_FN})(${jsString(text)}, ${checked})`);
      console.log(JSON.stringify(result));
      return;
    }
    if (cmd === "wait") {
      const text = flags.text || positional[0];
      const timeout = Number(flags["timeout-ms"] || 15000);
      if (!text) die("wait requires --text");
      await waitText(cdp, text, timeout);
      console.log(`found ${JSON.stringify(text)}`);
      return;
    }
    if (cmd === "snapshot") {
      const path = flags.path || positional[0];
      if (!path) die("snapshot requires --path");
      const text = (await evaluate(cdp, "document.body ? document.body.innerText : ''")) || "";
      const html = (await evaluate(cdp, "document.documentElement ? document.documentElement.outerHTML : ''")) || "";
      ensureParent(path);
      writeFileSync(path, text);
      if (flags.html) writeFileSync(flags.html, html);
      console.log(path);
      return;
    }
    if (cmd === "screenshot") {
      const path = flags.path || positional[0];
      if (!path) die("screenshot requires --path");
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      ensureParent(path);
      writeFileSync(path, Buffer.from(shot.data, "base64"));
      console.log(path);
      return;
    }
    if (cmd === "eval") {
      const js = flags.js || positional[0];
      if (!js) die("eval requires --js");
      const result = await evaluate(cdp, js);
      console.log(typeof result === "string" ? result : JSON.stringify(result));
      return;
    }
    die(`unknown command ${cmd}`);
  } finally {
    cdp.close();
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
