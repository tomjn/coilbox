import { GetStartedCard } from "../../content/pages/components/GetStartedCard";
import { SetupCard } from "../../content/pages/components/SetupCard";
import { getOnboardingPlacement } from "../../profile/profile";

/**
 * First run: the dismissible "Set up Coilbox" card (content folder + engine)
 * followed by the get-started download suggestions. Both cards already hide
 * themselves once they have nothing left to offer, so a healthy install sees
 * nothing from this zone.
 *
 * The content plugin used to inject these into picoframe's `home.top` slot,
 * because picoframe owned the home page and injection was the only way in.
 * Coilbox owns the page now (issue #985), so they compose directly. `home.top`
 * itself stays rendered for plugins other than Coilbox's own.
 *
 * The zone renders the cards and nothing around them. The gap between them and
 * the space to whatever sits next are the layout's, which is what lets the
 * branded home and the stacked layout each keep the spacing they already had.
 *
 * Of the `onboarding` placements only `"off"` belongs here, since it is the one
 * that decides whether this zone exists at all. `"above"` and `"below"` are
 * positions, so the layout applies them: {@link ../BrandedHome} puts the zone
 * on the chosen side of the welcome, and {@link ../StackedLayout} has no
 * welcome to sit relative to, so the cards stay at the top of the page.
 */
export default function Onboarding() {
  if (getOnboardingPlacement() === "off") return null;
  return (
    <>
      <SetupCard dismissible />
      <GetStartedCard />
    </>
  );
}
