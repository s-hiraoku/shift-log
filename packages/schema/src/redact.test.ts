import { describe, expect, it } from "vitest";
import {
  REDACTED,
  isSensitiveApp,
  redactEvent,
  redactSensitiveText,
  titleLooksPrivate,
} from "./redact.js";

describe("redactSensitiveText", () => {
  it.each([
    ["~/src/app — export OPENAI_API_KEY=sk-proj-abcdefghijklmnop1234", "sk-proj-"],
    ['~/src — curl -H "Authorization: Bearer abc123def456ghi789"', "abc123def456ghi789"],
    ["~/src — gh auth login --with-token ghp_abcdefghijklmnopqrstuvwxyz0123", "ghp_"],
    ["psql postgresql://alice:hunter2@db.example.com/app", "hunter2"],
    ["mysql -u root --password hunter2", "hunter2"],
    ["DATABASE_PASSWORD='p@ss w0rd' pnpm dev", "p@ss w0rd"],
    ["aws configure AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7EXAMPLE"],
    ["xoxb-1234567890-abcdefghij token", "xoxb-"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop", "eyJ"],
    ["https://example.com/reset?token=abc&user=alice", "token=abc"],
    ["9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 secret", "9f86d081"],
  ])("removes the secret from %s", (input, secret) => {
    const out = redactSensitiveText(input);
    expect(out).not.toContain(secret);
  });

  it("masks email, phone, and card numbers", () => {
    const out = redactSensitiveText(
      "Re: 見積 - taro.yamada@example.co.jp 090-1234-5678 4111 1111 1111 1111",
    );
    expect(out).not.toContain("taro.yamada");
    expect(out).not.toContain("090-1234-5678");
    expect(out).not.toContain("4111");
    expect(out).toContain("[email]");
  });

  it("keeps ordinary work titles", () => {
    for (const title of [
      "~/src/shift-log (main) — pnpm install",
      "shift-log — collector.ts",
      "Pull Request #42 · s-hiraoku/shift-log",
      "06:39-06:40 standup",
      "token budget — design doc",
    ]) {
      expect(redactSensitiveText(title)).toBe(title);
    }
  });

  it("replaces with the redaction marker", () => {
    expect(redactSensitiveText("API_KEY=abc123")).toBe(`API_KEY=${REDACTED}`);
  });
});

describe("redactEvent", () => {
  it("redacts summary, urlPath query, and nested meta strings", () => {
    const event = redactEvent({
      summary: "export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123",
      urlPath: "/callback?code=secret-code",
      meta: { cwd: "~/src", file: "alice@example.com.txt", nested: ["password=x1"] },
    });
    expect(event.summary).not.toContain("ghp_");
    expect(event.urlPath).toBe("/callback");
    expect(JSON.stringify(event.meta)).not.toContain("alice@example.com");
    expect(JSON.stringify(event.meta)).not.toContain("x1");
  });
});

describe("isSensitiveApp / titleLooksPrivate", () => {
  it("recognizes password managers", () => {
    expect(isSensitiveApp("1Password")).toBe(true);
    expect(isSensitiveApp("Keychain Access")).toBe(true);
    expect(isSensitiveApp("Code")).toBe(false);
  });

  it("recognizes private browser windows", () => {
    expect(titleLooksPrivate("New Tab - Google Chrome (Incognito)")).toBe(true);
    expect(titleLooksPrivate("Mozilla Firefox Private Browsing")).toBe(true);
    expect(titleLooksPrivate("Bing - [InPrivate] - Microsoft Edge")).toBe(true);
    expect(titleLooksPrivate("GitHub - Google Chrome")).toBe(false);
  });
});
