import { Slot } from "@picoframe/frame";
import { Fragment, type ReactNode } from "react";
import { backdropStyle, resolveHomeBackground } from "./background";
import { type HomeEntry, type ZoneId, zoneString } from "./config";
import type { HomeLayoutProps } from "./layout";
import Continue from "./zones/Continue";
import FeaturedMap from "./zones/FeaturedMap";
import Greeting from "./zones/Greeting";
import Onboarding from "./zones/Onboarding";
import ResumeRail from "./zones/ResumeRail";
import ToolCards from "./zones/ToolCards";

/**
 * The one home layout Coilbox ships: zones stacked down the page in a single
 * column. Registered as `stacked` in {@link ./layout}, which explains why the
 * name matters.
 *
 * The zones and their order come from the profile (see `./config`), which on an
 * unconfigured install is every zone in the order below. A distribution that
 * lists `home.zones` gets exactly that list, so this layout has to render any
 * subset of the zones in any order.
 *
 * `home.top` and `home.bottom` keep rendering because picoframe plugins inject
 * into them, and they bookend the zones rather than sitting among them: they are
 * the page's extension points, not entries a distribution can move.
 *
 * The backdrop is painted here rather than inside a zone, because it is behind
 * all of them and a zone that owned it would be one the others sat on top of.
 * See {@link ./background} for what it resolves to and how far it may be seen.
 */
export default function StackedLayout({
  entries,
  background,
}: HomeLayoutProps) {
  const backdrop = backdropStyle(resolveHomeBackground(background));
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
        <Slot id="home.top" />
        {entries.map(renderEntry)}
        <Slot id="home.bottom" />
      </div>
    </div>
  );
}

/**
 * The space this layout puts around each zone, by zone.
 *
 * Spacing belongs to the layout rather than to the zones, which is what lets the
 * branded home reuse the same zone components with different spacing, and what
 * will let a second layout arrange them differently. A zone with no entry here
 * brings its own spacing or needs none.
 *
 * Every gap is a top margin plus `empty:hidden`, so a zone that stands down
 * takes its gap with it and the page closes up. The sizes read as a hierarchy:
 * the continue hero sits under the greeting whose tagline promised it, the
 * resume rail is the small half of that same block so it is tighter, and the
 * featured map is a new section so it is wider.
 */
const ZONE_SPACING: Partial<Record<ZoneId, string>> = {
  // The onboarding cards' own gap, and the space to whatever follows. Inherited
  // from the content plugin's `home.top` contribution, which is where these
  // cards used to live.
  onboarding: "mb-2 flex flex-col gap-4",
  continue: "mt-6 empty:hidden",
  resume: "mt-3 empty:hidden",
  featured: "mt-8 empty:hidden",
};

/** One entry of the page, with the layout's own spacing around it. */
function renderEntry(entry: HomeEntry, index: number): ReactNode {
  // Custom markup entries arrive with issue #999. Recognised by the schema
  // already, so they hold their place in the order, and skipped here until
  // there is something to render for them.
  if (entry.kind !== "zone") return null;
  const spacing = ZONE_SPACING[entry.zone];
  const node = zoneNode(entry);
  // Zones with no spacing of their own are not wrapped at all, so the markup is
  // the same as before the zone list became configurable.
  return spacing ? (
    <div key={index} className={spacing}>
      {node}
    </div>
  ) : (
    <Fragment key={index}>{node}</Fragment>
  );
}

/** The component for a built-in zone, with whatever config the entry carries. */
function zoneNode(entry: Extract<HomeEntry, { kind: "zone" }>): ReactNode {
  switch (entry.zone) {
    case "onboarding":
      return <Onboarding />;
    case "greeting":
      return (
        <Greeting
          title={zoneString(entry.entry, "title")}
          tagline={zoneString(entry.entry, "tagline")}
        />
      );
    case "continue":
      return <Continue />;
    case "resume":
      return <ResumeRail />;
    case "cards":
      return <ToolCards />;
    case "featured":
      return <FeaturedMap />;
  }
}
