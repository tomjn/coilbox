import { describe, expect, it } from "vitest";
import { shouldShowNeedsGameBadge } from "./navBadgeLogic";

describe("shouldShowNeedsGameBadge", () => {
  it("hides the badge once ready", () => {
    expect(shouldShowNeedsGameBadge(true, false)).toBe(false);
  });

  it("shows the badge when not ready and the scan has settled", () => {
    expect(shouldShowNeedsGameBadge(false, false)).toBe(true);
  });

  it("hides the badge while still loading, even if not (yet) ready", () => {
    // Guards against a flash: "not ready" during the initial scan shouldn't
    // badge on and then off once the scan resolves ready.
    expect(shouldShowNeedsGameBadge(false, true)).toBe(false);
  });

  it("hides the badge while loading even if the readiness value happens to be true", () => {
    expect(shouldShowNeedsGameBadge(true, true)).toBe(false);
  });
});
