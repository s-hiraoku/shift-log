import { describe, expect, it } from "vitest";
import {
  interpretWindowTitle,
  observeFrontWindow,
  siteFromTitle,
  type ExecFileFn,
} from "./os-observe.js";

describe("siteFromTitle", () => {
  it("extracts a host from a Chrome title", () => {
    expect(
      siteFromTitle("s-hiraoku/shift-log · github.com - Google Chrome", "Google Chrome"),
    ).toBe("github.com");
  });

  it("extracts a URL host", () => {
    expect(siteFromTitle("https://learn.chatgpt.com/docs - Safari", "Safari")).toBe(
      "learn.chatgpt.com",
    );
  });

  it("ignores non-browser apps", () => {
    expect(siteFromTitle("github.com is mentioned", "Code")).toBeUndefined();
  });
});

describe("interpretWindowTitle", () => {
  it("reads VS Code and Cursor documented project — file titles", () => {
    expect(interpretWindowTitle("Code", "shift-log — collector.ts")).toEqual({
      project: "shift-log",
      file: "collector.ts",
    });
    expect(interpretWindowTitle("Cursor", "shift-log — collector.ts")).toEqual({
      project: "shift-log",
      file: "collector.ts",
    });
  });

  it("reads file — project titles when the file side has an extension", () => {
    expect(interpretWindowTitle("Visual Studio Code", "collector.ts — shift-log")).toEqual({
      file: "collector.ts",
      project: "shift-log",
    });
  });

  it("strips a trailing app name from an editor title", () => {
    expect(interpretWindowTitle("Cursor", "shift-log — Cursor")).toEqual({
      project: "shift-log",
    });
  });

  it("reads ghostty / iTerm2 / Terminal cwd (branch) titles from the docs", () => {
    expect(interpretWindowTitle("ghostty", "~/src/shift-log (main)")).toEqual({
      cwd: "~/src/shift-log",
      branch: "main",
    });
    expect(interpretWindowTitle("iTerm2", "~/src/shift-log (main) — pnpm install")).toEqual({
      cwd: "~/src/shift-log",
      branch: "main",
    });
    expect(interpretWindowTitle("Terminal", "~/src/shift-log (main)")).toEqual({
      cwd: "~/src/shift-log",
      branch: "main",
    });
    expect(interpretWindowTitle("WezTerm", "~/src/shift-log")).toEqual({
      cwd: "~/src/shift-log",
    });
  });

  it("leaves username-only and command-only terminal titles unstructured", () => {
    expect(interpretWindowTitle("ghostty", "hiraoku.shinichi")).toBeUndefined();
    expect(interpretWindowTitle("ghostty", "pnpm install")).toBeUndefined();
  });

  it("does not interpret browser titles", () => {
    expect(
      interpretWindowTitle("Google Chrome", "s-hiraoku/shift-log · github.com - Google Chrome"),
    ).toBeUndefined();
  });
});

describe("observeFrontWindow", () => {
  it("reads the Linux front window via xdotool", async () => {
    const exec: ExecFileFn = async (file, args) => {
      if (file === "xdotool" && args[0] === "getactivewindow") {
        return { stdout: "12345\n", stderr: "" };
      }
      if (file === "xdotool" && args[0] === "getwindowname") {
        return { stdout: "shift-log — Cursor\n", stderr: "" };
      }
      if (file === "xdotool" && args[0] === "getwindowclassname") {
        return { stdout: "Cursor\n", stderr: "" };
      }
      throw new Error(`unexpected ${file} ${args.join(" ")}`);
    };
    const front = await observeFrontWindow({ platform: "linux", exec });
    expect(front).toEqual({
      app: "Cursor",
      title: "shift-log — Cursor",
      site: undefined,
      meta: { project: "shift-log" },
    });
  });

  it("reads the macOS front app via osascript", async () => {
    const exec: ExecFileFn = async (file, args) => {
      if (file === "osascript" && args[1]?.includes("System Events")) {
        return { stdout: "Safari\tComputer History\n", stderr: "" };
      }
      if (file === "osascript" && args[1]?.includes("Safari")) {
        return { stdout: "https://learn.chatgpt.com/docs\n", stderr: "" };
      }
      throw new Error(`unexpected ${file} ${args.join(" ")}`);
    };
    const front = await observeFrontWindow({ platform: "darwin", exec });
    expect(front?.app).toBe("Safari");
    expect(front?.site).toBe("learn.chatgpt.com");
  });
});
