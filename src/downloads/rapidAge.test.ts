import { describe, expect, it } from "vitest";
import { refreshedLabel } from "./rapidAge";

describe("refreshedLabel", () => {
  it("says just now under a minute", () => {
    expect(refreshedLabel(0)).toBe("refreshed just now");
    expect(refreshedLabel(59)).toBe("refreshed just now");
  });

  it("counts whole minutes, hours and days", () => {
    expect(refreshedLabel(180)).toBe("refreshed 3 min ago");
    expect(refreshedLabel(3600)).toBe("refreshed 1 h ago");
    expect(refreshedLabel(86_400 * 2 + 5)).toBe("refreshed 2 d ago");
  });
});
