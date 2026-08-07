import BrandedWelcome from "../profile/BrandedWelcome";
import { getOnboardingPlacement } from "../profile/profile";
import Onboarding from "./zones/Onboarding";

/**
 * The home page for a distribution that ships its own welcome markup: that
 * welcome, plus the {@link Onboarding} zone.
 *
 * The welcome is always rendered and never replaced. The `onboarding` placement
 * only positions the cards above, below, or off (see
 * {@link getOnboardingPlacement}); the zone itself is the same one the stacked
 * layout renders.
 *
 * The root is a definite-height scroll container so the welcome sizes to its own
 * content, rather than an ambiguous `h-full` that collapses to zero inside
 * picoframe's overflow-auto content region.
 *
 * Moved here from `content/pages/SetupHome` when Coilbox took ownership of `/`
 * (issue #985). Unchanged otherwise, so existing distributions render as before.
 */
export default function BrandedHome() {
  const placement = getOnboardingPlacement();
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4">
      {placement === "above" && <Onboarding />}
      <BrandedWelcome />
      {placement === "below" && <Onboarding />}
    </div>
  );
}
