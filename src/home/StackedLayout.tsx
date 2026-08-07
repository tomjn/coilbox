import { Slot } from "@picoframe/frame";
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
 */
export default function StackedLayout() {
  return (
    <div className="p-8">
      {/* Onboarding sits where the content plugin's order-0 `home.top`
          contribution used to, so anything else injecting there still lands
          under it. The wrapper is that contribution's own spacing, kept here
          because the space around a zone is the layout's to set. */}
      <div className="mb-2 flex flex-col gap-4">
        <Onboarding />
      </div>
      <Slot id="home.top" />
      <Greeting />
      <ToolCards />
      <Slot id="home.bottom" />
    </div>
  );
}
