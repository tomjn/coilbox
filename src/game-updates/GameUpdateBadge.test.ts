import { describe, expect, it } from "vitest";
import { badgeLabel } from "./GameUpdateBadge";

describe("badgeLabel", () => {
  it("names a single update", () => {
    expect(badgeLabel(["Zero-K"], 1)).toBe("Update Zero-K");
  });

  it("names the first and counts the rest", () => {
    expect(badgeLabel(["Zero-K", "Engine 2025.06.12"], 2)).toBe(
      "Update Zero-K +1",
    );
  });

  it("falls back to a count when nothing has a name yet", () => {
    expect(badgeLabel([], 1)).toBe("1 update");
    expect(badgeLabel([], 3)).toBe("3 updates");
  });
});
