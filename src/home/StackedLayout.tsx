import { Slot } from "@picoframe/frame";
import { Fragment, type ReactNode } from "react";
import { backdropStyle, resolveHomeBackground } from "./background";
import type { HomeEntry, ZoneId } from "./config";
import HomeMarkup from "./HomeMarkup";
import type { HomeLayoutProps } from "./layout";
import Continue from "./zones/Continue";
import Greeting from "./zones/Greeting";
import Onboarding from "./zones/Onboarding";
import ResumeRail from "./zones/ResumeRail";
import SuggestedMap, { SuggestedMapCard } from "./zones/SuggestedMap";
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
        {renderEntries(entries)}
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
 * suggested map is a new section so it is wider.
 */
const ZONE_SPACING: Partial<Record<ZoneId, string>> = {
  // The onboarding cards' own gap, and the space to whatever follows. Inherited
  // from the content plugin's `home.top` contribution, which is where these
  // cards used to live.
  onboarding: "mb-2 flex flex-col gap-4",
  // The spacing the hero and the rail get when they are *not* side by side,
  // which is a profile that separated them or listed only one. Adjacent, they
  // share {@link RESUME_ROW} instead.
  continue: "mt-6 empty:hidden",
  resume: "mt-3 empty:hidden",
  suggested: "mt-8 empty:hidden",
};

/**
 * The row the continue hero and the resume rail share.
 *
 * They were two full-width bands, and the hero's band was mostly empty. One row
 * reads as one thing: what you were last doing, then the couple of other things
 * you could go back to.
 *
 * `flex-wrap`, so the rail drops under the hero when the line cannot hold both.
 * That is the two-row page this replaced, which is still the right answer on a
 * narrow window and with a rail three cards wide. The gap is the rail's own card
 * gap, so the space between the hero and the first rail card is the same as the
 * space between rail cards.
 *
 * A column below `sm`, because that is where the rail's own cards go full width
 * (`RAIL_CARD_CLASS`). A row there would size the rail to its text instead, and
 * the cards would come out narrower than the hero above them for no reason the
 * page could explain. The window can be dragged to 600px, so this is reachable.
 *
 * `empty:hidden` on the row, with the two zones as its direct children and no
 * wrapper each. That is what makes the block vanish on a fresh install: both
 * zones render null, the row has no child nodes at all, and it takes its own top
 * margin with it. Wrapping each zone would leave the row holding two empty divs,
 * so it would keep the margin and the page would open with a gap in it.
 *
 * ## The rail keeps its own height
 *
 * `items-start`, so the row's bottom edge goes ragged rather than the rail
 * carrying the hero's spare depth. A flex row stretches its items by default, and
 * a hero whose title or action wrapped is a taller item: at 1512 with an 80
 * character title the hero is 185px and the rail cards were stretched from their
 * own 101px to match, so each one held 84px of nothing between its detail line
 * and the action `mt-auto` pins to its foot (#1074).
 *
 * Aligned at the top the row keeps one straight edge, and it is the edge the page
 * reads from: the greeting sits directly above it and both zones start on the
 * same line. Centring or aligning at the foot each cost that edge to buy the
 * other one, and left the rail floating against nothing.
 *
 * Only from `sm`, where the row is a row. Below that the main axis is vertical,
 * `items-start` would be a width, and the rail's full-width cards would come out
 * narrower than the hero above them.
 *
 * The rail's own cards still stretch to each other, because this aligns the two
 * zones and the rail is a flex container of its own. One rail card wrapping its
 * title still sets the height of its siblings, which is what keeps their actions
 * on one line.
 */
const RESUME_ROW =
  "mt-6 flex flex-col gap-3 empty:hidden sm:flex-row sm:flex-wrap sm:items-start";

/**
 * What the layout tells the hero about its width: as wide as its contents, and
 * never wider than 42rem.
 *
 * It used to fill whatever the rail left, and that is what left the action a long
 * way from the text it belongs to (#1059). How far depended on how many rail
 * cards there happened to be, which is a thing the hero cannot see and should not
 * have to. A card sized to its contents has no spare room to spread, so the
 * question stops being asked.
 *
 * No flex utility at all, because `flex: 0 1 auto` is already the answer: size to
 * the content, do not grow into the rest of the line, and shrink only when the
 * hero alone is wider than the line it is on. It is the same nothing the rail is
 * handed, and for the same reason.
 *
 * 42rem is a title's limit, not a card's. Past it a run's name is a paragraph, and
 * the row would rather wrap the title than push the rail onto a second line: a
 * hero at the cap still leaves a two-card rail beside it on a 1256px page. The cap
 * is only from `sm`, since below that {@link RESUME_ROW} is a column and the card
 * is narrower than 42rem anyway.
 *
 * `min-w-0` so a long title shrinks and wraps rather than pushing the row wider
 * than the page.
 *
 * Used for a lone hero too, not just the row. A profile that separated the zones
 * asked for them apart, not for a card the width of the window.
 */
const HERO_WIDTH = "min-w-0 sm:max-w-2xl";

/**
 * The page's entries, with two pairs of zones composed into one.
 *
 * - `continue` then `resume`: one row, the hero and the runners-up beside it.
 * - `cards` then `suggested`: the map card joins the tool grid's Downloads group
 *   as a fourth card, because a map suggestion is a download and had been sitting
 *   alone below every tool group at a size nothing around it shared (issue
 *   #1037).
 *
 * The pairing belongs to the layout. No zone knows the other exists: each still
 * renders nothing when it has nothing to say, and the grid is handed the map card
 * as a child rather than told to build one. That is what leaves a later layout
 * free to put them somewhere else, or to leave them stacked.
 *
 * Only an adjacent pair, in that order, pairs. A profile that separated them,
 * reversed them, or listed one without the other wrote the order it wanted, and
 * each zone keeps the stacked spacing it had. The map card standing alone is why
 * `SuggestedMap` still has a heading of its own.
 *
 * An entry carrying `before` or `after` markup does not pair either. That markup
 * renders whether or not its zone drew anything, so in the resume row it would be
 * a third item sitting beside the hero and would hold the row open on a page with
 * nothing to resume, and around the grid it would land inside a group.
 */
function renderEntries(entries: readonly HomeEntry[]): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const next: HomeEntry | undefined = entries[i + 1];
    if (bare(entry, "continue") && next && bare(next, "resume")) {
      out.push(
        <div key={i} className={RESUME_ROW}>
          <Continue className={HERO_WIDTH} />
          <ResumeRail />
        </div>,
      );
      i += 1;
      continue;
    }
    if (bare(entry, "cards") && next && bare(next, "suggested")) {
      out.push(<ToolCards key={i} suggested={<SuggestedMapCard />} />);
      i += 1;
      continue;
    }
    out.push(renderEntry(entry, i));
  }
  return out;
}

/** A zone entry naming `zone` and carrying no markup of its own. */
function bare(entry: HomeEntry, zone: ZoneId): boolean {
  return (
    entry.kind === "zone" &&
    entry.zone === zone &&
    entry.strings.before === undefined &&
    entry.strings.after === undefined
  );
}

/**
 * One entry of the page, with the layout's own spacing around it.
 *
 * A custom `html` entry gets no spacing at all. It is a section the layout knows
 * nothing about, so any margin picked here would be one its author then has to
 * fight, and their markup can carry its own.
 *
 * A zone's `before` and `after` markup sits inside that zone's spacing wrapper,
 * so an intro sentence takes the gap that separated the zone from what came
 * before it and the zone itself stays tight under the sentence. Two consequences
 * worth knowing when authoring:
 *
 * - Markup renders whether or not the zone next to it drew anything. Whether
 *   there is a battle to rejoin is the zone's own runtime state, and a `before`
 *   that means "sometimes" is harder to write against than one that means
 *   "always". It is also the only way to say "always", since a custom `html`
 *   entry is unconditional by definition.
 * - Because the wrapper is no longer empty, the `empty:hidden` that collapses a
 *   silent zone's gap stops applying to that entry. Same rule, seen from the
 *   layout's side.
 */
function renderEntry(entry: HomeEntry, index: number): ReactNode {
  if (entry.kind === "html")
    return <HomeMarkup key={index} markup={entry.html} />;
  const { before, after } = entry.strings;
  const spacing = ZONE_SPACING[entry.zone];
  const node = (
    <>
      {before !== undefined && <HomeMarkup markup={before} />}
      {zoneNode(entry)}
      {after !== undefined && <HomeMarkup markup={after} />}
    </>
  );
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
        <Greeting title={entry.strings.title} tagline={entry.strings.tagline} />
      );
    case "continue":
      return <Continue className={HERO_WIDTH} />;
    case "resume":
      return <ResumeRail />;
    case "cards":
      return <ToolCards />;
    case "suggested":
      return <SuggestedMap />;
  }
}
