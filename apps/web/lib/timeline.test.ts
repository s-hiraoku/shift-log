import { describe, expect, it } from "vitest";
import { timelineEmptyMessage } from "./timeline";

describe("timelineEmptyMessage", () => {
  it("keeps the unseeded copy when the query is empty", () => {
    expect(timelineEmptyMessage("")).toBe(
      "まだ記憶がありません。収集を有効化して窓をアップロードしてください。",
    );
  });

  it("names the query when a search returns no hits", () => {
    expect(timelineEmptyMessage("Code")).toBe(
      "「Code」に一致する記憶はありません。",
    );
  });
});
