import { describe, expect, it } from "vitest";
import { observeFrontWindow, siteFromTitle, type ExecFileFn } from "./os-observe.js";

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
