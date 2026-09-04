import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type FrontWindow = {
  app: string;
  title: string;
  site?: string;
  privateBrowsing?: boolean;
};

export type ExecFileFn = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const defaultExec: ExecFileFn = async (file, args) => {
  const { stdout, stderr } = await execFileAsync(file, args, {
    timeout: 2500,
    windowsHide: true,
  });
  return { stdout: String(stdout), stderr: String(stderr) };
};

function hostnameFromUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Best-effort host from a browser window title (never treats the title as keystrokes). */
export function siteFromTitle(title: string, app: string): string | undefined {
  const lowerApp = app.toLowerCase();
  const isBrowser = /chrome|chromium|firefox|safari|edge|brave|vivaldi/.test(lowerApp);
  if (!isBrowser) return undefined;
  const urlMatch = title.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) return hostnameFromUrl(urlMatch[0]);
  const hostMatch = title.match(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/i);
  return hostMatch?.[0]?.toLowerCase();
}

async function observeMac(exec: ExecFileFn): Promise<FrontWindow | null> {
  const script = [
    'tell application "System Events"',
    "  set p to first application process whose frontmost is true",
    "  set n to name of p",
    '  set t to ""',
    "  try",
    "    set t to name of front window of p",
    "  end try",
    "  return n & tab & t",
    "end tell",
  ].join("\n");
  const { stdout } = await exec("osascript", ["-e", script]);
  const [appRaw, ...rest] = stdout.replace(/\r/g, "").trim().split("\t");
  const app = (appRaw ?? "").trim();
  if (!app) return null;
  const title = rest.join("\t").trim();
  let site = siteFromTitle(title, app);
  try {
    if (/^safari$/i.test(app)) {
      const url = await exec("osascript", [
        "-e",
        'tell application "Safari" to return URL of front document',
      ]);
      site = hostnameFromUrl(url.stdout) ?? site;
    } else if (/google chrome|chromium|brave browser/i.test(app)) {
      const url = await exec("osascript", [
        "-e",
        `tell application "${app}" to return URL of active tab of front window`,
      ]);
      site = hostnameFromUrl(url.stdout) ?? site;
    }
  } catch {
    // Automation permission denied — fall back to title heuristic.
  }
  return { app, title, site };
}

async function observeLinux(exec: ExecFileFn): Promise<FrontWindow | null> {
  try {
    const idOut = await exec("xdotool", ["getactivewindow"]);
    const id = idOut.stdout.trim();
    if (!id) return null;
    const [nameOut, classOut] = await Promise.all([
      exec("xdotool", ["getwindowname", id]).catch(() => ({ stdout: "", stderr: "" })),
      exec("xdotool", ["getwindowclassname", id]).catch(() => ({ stdout: "", stderr: "" })),
    ]);
    const title = nameOut.stdout.trim();
    const app = (classOut.stdout.trim() || title.split("—").pop() || title || "unknown").trim();
    if (!app && !title) return null;
    return {
      app: app || "unknown",
      title,
      site: siteFromTitle(title, app),
    };
  } catch {
    // xdotool missing — try xprop
  }
  try {
    const root = await exec("xprop", ["-root", "_NET_ACTIVE_WINDOW"]);
    const idMatch = root.stdout.match(/0x[0-9a-f]+/i);
    if (!idMatch) return null;
    const props = await exec("xprop", ["-id", idMatch[0], "WM_CLASS", "WM_NAME"]);
    const classMatch = props.stdout.match(/WM_CLASS\(.*?\) = "([^"]+)", "([^"]+)"/);
    const nameMatch = props.stdout.match(/WM_NAME\(.*?\) = "([^"]*)"/);
    const app = (classMatch?.[2] || classMatch?.[1] || "unknown").trim();
    const title = (nameMatch?.[1] ?? "").trim();
    return { app, title, site: siteFromTitle(title, app) };
  } catch {
    return null;
  }
}

export async function observeFrontWindow(
  opts: { platform?: NodeJS.Platform; exec?: ExecFileFn } = {},
): Promise<FrontWindow | null> {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultExec;
  try {
    if (platform === "darwin") return await observeMac(exec);
    if (platform === "linux") return await observeLinux(exec);
    return null;
  } catch {
    return null;
  }
}
