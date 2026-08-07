import { Slot, useFrame } from "@picoframe/frame";
import ToolCards from "./zones/ToolCards";

/**
 * The one home layout Coilbox ships: zones stacked down the page in a single
 * column. Registered as `stacked` in {@link ./layout}, which explains why the
 * name matters.
 *
 * Today it reproduces picoframe's launcher exactly, so taking ownership of `/`
 * changes nothing a user can see. Later issues in milestone 16 insert the
 * Greeting, Continue, ResumeRail, Onboarding and FeaturedMap zones around the
 * tool grid.
 *
 * `home.top` and `home.bottom` keep rendering because picoframe plugins inject
 * into them. The content plugin's first-run setup card arrives via `home.top`.
 *
 * The title heading is inline rather than a zone because the Greeting zone that
 * owns it (title, tagline, logged-in name) lands in issue #986.
 */
export default function StackedLayout() {
  const { title } = useFrame();
  return (
    <div className="p-8">
      <Slot id="home.top" />
      <h1 className="text-2xl font-semibold">{title}</h1>
      <ToolCards />
      <Slot id="home.bottom" />
    </div>
  );
}
