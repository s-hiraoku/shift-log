import { describe, expect, it } from "vitest";
import { permissionsLoadPhase } from "./permissions-ui";

describe("permissionsLoadPhase", () => {
  it("leaves loading when the API error is set", () => {
    expect(permissionsLoadPhase(null, "Error: 401: unauthorized")).toBe("error");
  });

  it("stays on loading only while there is no config and no error", () => {
    expect(permissionsLoadPhase(null, "")).toBe("loading");
  });

  it("shows the form after a successful load", () => {
    expect(permissionsLoadPhase({ enabled: false }, "")).toBe("form");
  });
});
