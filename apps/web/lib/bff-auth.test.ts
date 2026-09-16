import { describe, expect, it } from "vitest";
import { resolveBffApiToken } from "./bff-auth";

describe("resolveBffApiToken", () => {
  it("uses SHIFTLOG_API_TOKEN when set", () => {
    expect(resolveBffApiToken({ SHIFTLOG_API_TOKEN: "secret" })).toEqual({
      token: "secret",
    });
  });

  it("does not fall back to dev-token when unset", () => {
    expect(resolveBffApiToken({})).toEqual({
      error:
        "SHIFTLOG_API_TOKEN must be set. Refusing to proxy with an implicit token (fail-closed).",
    });
  });

  it("allows implicit dev-token only with SHIFTLOG_ALLOW_INSECURE_DEV=1", () => {
    expect(
      resolveBffApiToken({ SHIFTLOG_ALLOW_INSECURE_DEV: "1" }),
    ).toEqual({ token: "dev-token" });
  });
});
