import { describe, expect, it } from "vitest";
import { onboardingPlacement } from "./onboarding";

describe("onboardingPlacement", () => {
  it("passes through explicit placements", () => {
    expect(onboardingPlacement("above")).toBe("above");
    expect(onboardingPlacement("below")).toBe("below");
    expect(onboardingPlacement("off")).toBe("off");
  });

  it("defaults an omitted value to below", () => {
    expect(onboardingPlacement(undefined)).toBe("below");
  });

  it("defaults an unrecognized value to below", () => {
    // A profile could carry a stray/legacy value; treat it as the default.
    expect(onboardingPlacement("nonsense" as never)).toBe("below");
  });
});
