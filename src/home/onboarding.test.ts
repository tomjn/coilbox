import { describe, expect, it, vi } from "vitest";

// The zone and the branded home are plain functions of the profile with no hooks
// of their own, so these tests call them and read the returned element tree.
// Vitest runs in node with no DOM, and the cards pull in @picoframe/frame and the
// Tauri API, so the leaves are stubbed (same approach as layout.test.ts).
vi.mock("../content/pages/components/SetupCard", () => ({
  SetupCard: () => null,
}));
vi.mock("../content/pages/components/GetStartedCard", () => ({
  GetStartedCard: () => null,
}));
vi.mock("../profile/BrandedWelcome", () => ({ default: () => null }));
vi.mock("../profile/profile", () => ({ getOnboardingPlacement: vi.fn() }));

import { GetStartedCard } from "../content/pages/components/GetStartedCard";
import { SetupCard } from "../content/pages/components/SetupCard";
import BrandedWelcome from "../profile/BrandedWelcome";
import {
  type OnboardingPlacement,
  onboardingPlacement,
} from "../profile/onboarding";
import { getOnboardingPlacement } from "../profile/profile";
import BrandedHome from "./BrandedHome";
import Onboarding from "./zones/Onboarding";

type Node = { type?: unknown; props?: { children?: unknown } } | null;

function placement(value: OnboardingPlacement) {
  vi.mocked(getOnboardingPlacement).mockReturnValue(value);
}

/**
 * The child components of a rendered element, in order. A branch that rendered
 * nothing comes back as the `false` the `&&` produced, so position is visible.
 */
function childTypes(node: unknown): unknown[] {
  const kids = (node as Node)?.props?.children;
  return (Array.isArray(kids) ? kids : [kids]).map(
    (child) => (child as Node)?.type ?? child,
  );
}

/** What an omitted `onboarding` key resolves to, through the real normalizer. */
const ABSENT = onboardingPlacement(undefined);

describe("Onboarding zone", () => {
  it("renders the setup card then the get-started card", () => {
    placement("below");
    expect(childTypes(Onboarding())).toEqual([SetupCard, GetStartedCard]);
  });

  it("renders the same cards whichever side they are placed", () => {
    placement("above");
    expect(childTypes(Onboarding())).toEqual([SetupCard, GetStartedCard]);
  });

  it("renders nothing when the onboarding is off", () => {
    placement("off");
    expect(Onboarding()).toBeNull();
  });

  it("renders when the profile names no placement", () => {
    placement(ABSENT);
    expect(childTypes(Onboarding())).toEqual([SetupCard, GetStartedCard]);
  });
});

describe("BrandedHome placement", () => {
  it("puts the zone over the welcome for above", () => {
    placement("above");
    expect(childTypes(BrandedHome())).toEqual([
      Onboarding,
      BrandedWelcome,
      false,
    ]);
  });

  it("puts the zone under the welcome for below", () => {
    placement("below");
    expect(childTypes(BrandedHome())).toEqual([
      false,
      BrandedWelcome,
      Onboarding,
    ]);
  });

  it("leaves the welcome as the whole page for off", () => {
    placement("off");
    expect(childTypes(BrandedHome())).toEqual([false, BrandedWelcome, false]);
  });

  it("defaults to below when the profile names no placement", () => {
    placement(ABSENT);
    expect(childTypes(BrandedHome())).toEqual([
      false,
      BrandedWelcome,
      Onboarding,
    ]);
  });
});
