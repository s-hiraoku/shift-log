import { describe, expect, it } from "vitest";
import { sixHourBucketUtc, sixHourMemoryId } from "./summarize.js";

describe("sixHourBucketUtc", () => {
  it("snaps to UTC 00/06/12/18 boundaries", () => {
    expect(sixHourBucketUtc("2026-09-12T00:00:00.000Z")).toEqual({
      start: "2026-09-12T00:00:00.000Z",
      end: "2026-09-12T06:00:00.000Z",
    });
    expect(sixHourBucketUtc("2026-09-12T05:59:59.000Z").start).toBe(
      "2026-09-12T00:00:00.000Z",
    );
    expect(sixHourBucketUtc("2026-09-12T06:00:00.000Z").start).toBe(
      "2026-09-12T06:00:00.000Z",
    );
    expect(sixHourBucketUtc("2026-09-12T13:10:00.000Z")).toEqual({
      start: "2026-09-12T12:00:00.000Z",
      end: "2026-09-12T18:00:00.000Z",
    });
    expect(sixHourBucketUtc("2026-09-12T23:50:00.000Z").start).toBe(
      "2026-09-12T18:00:00.000Z",
    );
  });

  it("builds a stable memory id from the bucket start", () => {
    expect(sixHourMemoryId("2026-09-12T06:00:00.000Z")).toBe(
      "mem_6h_2026-09-12T06:00:00.000Z",
    );
  });
});
