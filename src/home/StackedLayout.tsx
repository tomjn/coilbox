import { Slot } from "@picoframe/frame";
import { backdropStyle, resolveHomeBackground } from "./background";
import Continue from "./zones/Continue";
import FeaturedMap from "./zones/FeaturedMap";
import Greeting from "./zones/Greeting";
import Onboarding from "./zones/Onboarding";
import ToolCards from "./zones/ToolCards";

/**
 * The one home layout Coilbox ships: zones stacked down the page in a single
 * column. Registered as `stacked` in {@link ./layout}, which explains why the
 * name matters.
 *
 * Later issues in milestone 16 insert the Continue, ResumeRail and FeaturedMap
 * zones around the tool grid.
 *
 * `home.top` and `home.bottom` keep rendering because picoframe plugins inject
 * into them.
 *
 * The backdrop is painted here rather than inside a zone, because it is behind
 * all of them and a zone that owned it would be one the others sat on top of.
 * See {@link ./background} for what it resolves to and how far it may be seen.
 */
export default function StackedLayout() {
  // The configured value arrives with the `profile.home` schema in issue #998.
  // Until then nothing is configurable and every install gets the default wash.
  const backdrop = backdropStyle(resolveHomeBackground(undefined));
  return (
    <div className="relative min-h-full">
      {backdrop && (
        // Two layers, because the dimming that keeps text legible is a
        // composite over the theme background and not over whatever happens to
        // be behind the page. The frame already paints `bg-background` here, so
        // repeating it changes nothing visually and makes the arithmetic in
        // `background.test.ts` true whatever else is painted behind.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-background"
        >
          <div className="absolute inset-0" style={backdrop} />
        </div>
      )}
      {/* Positioned, so the zones paint over the backdrop without a z-index. */}
      <div className="relative p-8">
        {/* Onboarding sits where the content plugin's order-0 `home.top`
            contribution used to, so anything else injecting there still lands
            under it. The wrapper is that contribution's own spacing, kept here
            because the space around a zone is the layout's to set. */}
        <div className="mb-2 flex flex-col gap-4">
          <Onboarding />
        </div>
        <Slot id="home.top" />
        <Greeting />
        {/* Directly under the greeting, because the greeting's tagline promises
            it ("Pick up where you left off."), and above the tool grid, because
            resuming beats starting something new. The gap is the layout's, so the
            zone stays placeable elsewhere, and `empty:hidden` takes the gap away
            again on an install with nothing to resume. */}
        <div className="mt-6 empty:hidden">
          <Continue />
        </div>
        <ToolCards />
        {/* Under the tool grid, because it offers one thing to try rather than a
            way to reach what you already have, and the grid is the page's main
            business. The gap is the layout's, and `empty:hidden` takes it away
            again when the zone stands down. */}
        <div className="mt-8 empty:hidden">
          <FeaturedMap />
        </div>
        <Slot id="home.bottom" />
      </div>
    </div>
  );
}
