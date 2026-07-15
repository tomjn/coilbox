/** Where the onboarding cards sit relative to the branded welcome (see `onboarding`). */
export type OnboardingPlacement = "above" | "below" | "off";

/**
 * Normalize a profile's `onboarding` value to a valid {@link OnboardingPlacement},
 * defaulting to `"below"` for an omitted or unrecognized value. Pure and free of the
 * plugin-sdk imports in `./profile`, so it stays unit-testable.
 */
export function onboardingPlacement(
  value: OnboardingPlacement | undefined,
): OnboardingPlacement {
  return value === "above" || value === "off" ? value : "below";
}
