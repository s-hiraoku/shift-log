import { describe, expect, it } from "vitest";
import { canCollect, PermissionsConfigSchema } from "@shift-log/schema";

describe("web privacy defaults", () => {
  it("keeps collection off until memories are enabled", () => {
    const config = PermissionsConfigSchema.parse({ enabled: true });
    expect(canCollect(config)).toBe(false);
  });
});
