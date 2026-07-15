import BrandedWelcome from "../../profile/BrandedWelcome";
import { getOnboardingPlacement } from "../../profile/profile";
import { GetStartedCard } from "./components/GetStartedCard";
import { SetupCard } from "./components/SetupCard";

/**
 * The branded `/` override: the profile's welcome, plus the first-run onboarding
 * (setup + get-started suggestion cards). Installed as the home only when
 * `profile.welcome` is present (see main.tsx); vanilla Coilbox uses picoframe's
 * built-in launcher instead, which shows the onboarding via the content plugin's
 * `home.top` slot.
 *
 * The welcome is always rendered and never replaced — the `onboarding` placement
 * only positions the cards above, below, or off (see {@link getOnboardingPlacement}).
 * The root is a definite-height scroll container so the welcome sizes to its own
 * content (rather than an ambiguous `h-full` that collapses to zero inside
 * picoframe's overflow-auto content region).
 */
export default function SetupHome() {
  const placement = getOnboardingPlacement();
  const onboarding =
    placement === "off" ? null : (
      <>
        <SetupCard dismissible />
        <GetStartedCard />
      </>
    );
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4">
      {placement === "above" && onboarding}
      <BrandedWelcome />
      {placement === "below" && onboarding}
    </div>
  );
}
