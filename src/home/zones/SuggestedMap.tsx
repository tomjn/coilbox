import { buttonVariants, cn } from "@picoframe/frame";
import { Check, Download, Loader2, Map as MapIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import {
  ART_BAND_CLASS,
  ART_BUTTON_CLASS,
  ART_DIM_CLASS,
  ART_FADE_CLASS,
  ART_CARD_CLASS as ART_SHELL_CLASS,
  CARD_FOCUS_CLASS,
  CARD_SHELL_CLASS,
  CARD_STACK_CLASS,
} from "../cardShell";
import {
  type SuggestedState,
  springNameOf,
  useSuggestedMapAnswer,
  useSuggestedMapArt,
  useSuggestedMapInstall,
} from "../suggestedMap";

/**
 * One curated map, promoted for the day, with a button that installs it.
 *
 * Which map is decided in {@link ../suggestedMap}: a daily rotation over the maps
 * the GitHub `catalog.json` already curates for the map packs. This file is only
 * the card.
 *
 * The card is a download card, so on the default page it sits in the tool grid's
 * Downloads group beside Browse Rapid, Maps and Games, at their size. The layout
 * composes that, not this file: {@link ../StackedLayout} hands {@link
 * SuggestedMapCard} to the cards zone whenever the two zones are adjacent, and
 * falls back to the standalone section below when a profile separates them.
 *
 * The states it can be in, and why each is what it is:
 *
 * - Catalog or inventory not back yet: a placeholder the size of the card, so
 *   the page below does not jump when the answer arrives.
 * - Nothing left to offer: nothing at all. Either the catalog curates no map
 *   this card can picture, or the player already has every one it does. Both are
 *   the same outcome and are decided in one place (see `../suggestedMap`), and a
 *   card announcing a map it cannot offer is worse than the zone standing down,
 *   which is what the design has every zone do when it has nothing.
 * - Already installed: only ever the map this card's own button just fetched.
 *   The rotation offers a map you do not have, so the way to reach this state is
 *   to press Install and watch it land. The card holds the map it was showing
 *   and links to it rather than skipping to the next map under the reader.
 * - Downloading, queued, failed: said plainly on the card, because this card owns
 *   one map and a silent failure reads as a dead button.
 */
export default function SuggestedMap() {
  return <SuggestedMapCard variant="section" />;
}

/**
 * The card, named for whoever it is standing among.
 *
 * - `group`: inside the tool grid's Downloads group. No heading, because the
 *   group has one already and a second inside it would read as a group within a
 *   group.
 * - `section`: standing on its own, which is what a profile that separated the
 *   zones asked for. The heading travels with the card rather than sitting in a
 *   wrapper above it, because the zone renders nothing at all when there is no
 *   map to offer and a label over an absent card would be the one thing left on
 *   the page.
 * - `row`: promoted into the resume row, where it is one card beside the hero
 *   and the rail. A visible heading there would split a row that reads as one
 *   block, so it carries the same kind of label the rail does instead, and the
 *   label goes on the card's own element because the row's children may not be
 *   wrapped (see `../StackedLayout`).
 */
export function SuggestedMapCard({
  variant = "group",
}: {
  variant?: "group" | "section" | "row";
}) {
  // The page's answer, not this card's. `CoilboxHome` resolves it once, above the
  // layout, because the same map is claimed against the tool cards and two
  // resolutions could drift apart (issue #1077).
  const { map, loading, inventory } = useSuggestedMapAnswer();
  const { state, error, canDownload, noWriteRoot, download } =
    useSuggestedMapInstall(map, inventory);
  // The URL that failed, not a flag, so a later answer gets its own chance
  // rather than inheriting the verdict on the URL it replaced.
  const [broken, setBroken] = useState<string | null>(null);
  const art = useSuggestedMapArt(map, broken);

  const labelled = (node: ReactNode) =>
    variant === "section" ? (
      <section aria-labelledby="suggested-map-heading">
        <Heading />
        {node}
      </section>
    ) : (
      node
    );

  if (loading) return labelled(<Placeholder />);
  if (!map) return null;

  const row = variant === "row";
  // In the resume row the card is the same card, at the height of the cards it is
  // standing among and the width that height allows. See {@link ROW_CARD_CLASS}.
  const artWindow = row ? ROW_ART_WINDOW_CLASS : ART_WINDOW_CLASS;
  const installedName = state === "installed" ? springNameOf(map) : undefined;
  // The states where pressing the card starts a download. Not `active` or
  // `queued`: one is already running and a second press would enqueue it twice.
  const offering = state === "available" || state === "failed";
  const body = (
    <>
      {art ? (
        <>
          <img
            src={art}
            alt=""
            className="absolute inset-0 size-full object-cover"
            onError={() => setBroken(art)}
          />
          {/* The art window. Grows with the card, so the picture reaches the
              band however deep the band gets. */}
          <span aria-hidden="true" className={artWindow} />
        </>
      ) : (
        <span
          aria-hidden="true"
          className={`flex items-center justify-center ${artWindow}`}
        >
          <MapIcon size={32} className="text-muted-foreground" />
        </span>
      )}
      <span className={art ? ART_BAND_CLASS : PLAIN_BAND_CLASS}>
        {art && <span aria-hidden="true" className={ART_FADE_CLASS} />}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-medium">{map.title}</span>
          <span
            className={`block truncate text-xs ${art ? ART_DIM_CLASS : "text-muted-foreground"}`}
          >
            {error ?? map.blurb ?? "Curated map"}
          </span>
        </span>
        <Action state={state} compact={row} />
      </span>
    </>
  );

  // A `section` with a label in the resume row, where the card stands among
  // zones rather than among cards and is otherwise the only thing up there with
  // nothing saying what it is. A plain div everywhere else: in the Downloads
  // group the group's heading already says it, and the `section` variant has one
  // of its own wrapped around this.
  const Column = row ? "section" : "div";
  const surface = cn(
    art ? ART_CARD_CLASS : PLAIN_CARD_CLASS,
    row && ROW_CARD_CLASS,
  );
  return labelled(
    <Column
      className={cn(COLUMN_CLASS, row && ROW_COLUMN_CLASS)}
      aria-label={row ? "Suggested map" : undefined}
    >
      {installedName ? (
        // Installed: the card is the way to the map, so the whole surface is the
        // link and the band carries no button to nest inside it.
        <Link
          to={`/library/maps/${encodeURIComponent(installedName)}`}
          className={cn(surface, INTERACTIVE_CLASS)}
        >
          {body}
        </Link>
      ) : offering ? (
        // The offer: the whole card installs the map. It is one card about one
        // map with one thing to do, and a small button in the corner of it was
        // the only part that did anything, on a page where every card beside it
        // is wholly clickable and says so on hover. The chip in the band stays as
        // the affordance, and is inert.
        <button
          type="button"
          onClick={download}
          disabled={!canDownload}
          aria-label={
            state === "failed"
              ? `Retry installing ${map.title}`
              : `Install ${map.title}`
          }
          className={cn(
            surface,
            INTERACTIVE_CLASS,
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {body}
        </button>
      ) : (
        <div className={surface}>{body}</div>
      )}
      {/* `noWriteRoot`, not `!canDownload`: the download folder takes a disk read
          to resolve, so `canDownload` is false on every first render however the
          user has it configured. Keying the line on that told a configured user
          to set a folder they had set, on every launch, and took the Downloads
          row to 239px until the read landed (issue #1099). */}
      {noWriteRoot && state !== "installed" && (
        <p className="text-xs text-muted-foreground">
          Set a download folder in{" "}
          <Link
            className="underline underline-offset-4"
            to="/settings/downloads"
          >
            Downloads settings
          </Link>{" "}
          to install it.
        </p>
      )}
    </Column>,
  );
}

/** The label above the card, matching the tool grid's group labels. */
function Heading() {
  return (
    <h2
      id="suggested-map-heading"
      className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
    >
      Suggested map
    </h2>
  );
}

/**
 * The card's footprint while the catalog is still loading.
 *
 * Not a spinner, and not skeleton bars either: the catalog usually comes off
 * disk and resolves in a frame or two, and anything that flashes there is worse
 * than a shape that settles. What it draws is the pulse and nothing else.
 *
 * What it is, though, is the card's own parts with no words in them, so its
 * height is the card's height rather than a number that once matched it. It was
 * `min-h-40`, 160px, which was the card's height while the card stood alone at
 * the foot of the page. Since #1069 put it in the Downloads group it is the
 * tallest thing in that row and sets the row's height, so being 15px short moved
 * the row and everything below it every time the catalog landed (issue #1083).
 *
 * Derived rather than declared, because the two must not drift again: the same
 * art window, the same band, and a blank line of each of the band's two type
 * sizes. It holds the shape of the card *with* art, which is 1px shorter than
 * the one without, because since #1070 the rotation only offers maps the catalog
 * can picture. That comes out at the card's 177px.
 *
 * A title that wraps to two lines still makes the card 201px, and no placeholder
 * can know whether it will, because the title is the thing the catalog has not
 * said yet. Reserving two lines instead would trade a jump on the six curated
 * maps whose titles wrap for a blank line under the other eighteen, every day.
 * So the common case is the one reserved, and the uncommon one costs 24px rather
 * than the 39px both cost before.
 */
function Placeholder() {
  return (
    <div className={COLUMN_CLASS}>
      <div
        aria-hidden="true"
        className={`${ART_CARD_CLASS} motion-safe:animate-pulse`}
      >
        <span className={ART_WINDOW_CLASS} />
        <span className={ART_BAND_CLASS}>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">&nbsp;</span>
            <span className="block truncate text-xs">&nbsp;</span>
          </span>
        </span>
      </div>
    </div>
  );
}

/** What the card offers for the map, given where its download has got to. */
function Action({
  state,
  compact = false,
}: {
  state: SuggestedState;
  /**
   * Drop the words and keep the icons.
   *
   * The promoted card is 248px wide where it has 256px in the Downloads group,
   * and it is a good deal shorter, so the band has to give something back. The
   * card is what carries the accessible name in every state, so nothing here is
   * the only place a word appears.
   */
  compact?: boolean;
}) {
  if (state === "installed") {
    return (
      <span className={STATUS_CLASS}>
        <Check className="size-4" />
        {!compact && "Installed"}
      </span>
    );
  }
  if (state === "active" || state === "queued") {
    return (
      <span className={STATUS_CLASS}>
        <Loader2 className="size-3.5 motion-safe:animate-spin" />
        {!compact && (state === "active" ? "Downloading…" : "Queued")}
      </span>
    );
  }
  // A span, not a button. The card around it is the control (see
  // {@link SuggestedMapCard}), and a button inside a button is not markup a
  // browser will render as written.
  return (
    <span
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "pointer-events-none shrink-0",
        compact && "px-2",
        ART_BUTTON_CLASS,
      )}
    >
      <Download className="size-4" />
      {!compact && (state === "failed" ? "Retry" : "Install")}
    </span>
  );
}

/** The two states that are a report rather than an offer. */
const STATUS_CLASS = "flex shrink-0 items-center gap-1 px-1 text-xs";

/**
 * The column the card sits in: the card, and under it the one line that only
 * appears when there is nowhere to download to.
 *
 * It carries the width, so the card and that line agree on it. `sm:w-64` is the
 * tool card's own width, because this is a fourth card in the Downloads group and
 * a card wider than its neighbours would read as a different kind of thing. The
 * card was `max-w-[33rem]`, which was the right answer while it stood alone at the
 * foot of the page and the wrong one beside three cards (issue #1037).
 */
const COLUMN_CLASS = "flex w-full flex-col gap-2 sm:w-64";

/**
 * How deep the picture is. The tool card's own art window, for the same reason
 * the width is: four cards in a row, one of them taller, reads as a mistake.
 */
const ART_WINDOW_CLASS = "relative min-h-28 flex-1";

/* -------------------------------------------------------------------------- *
 * The card in the resume row, which is the same card at the row's own size.
 * -------------------------------------------------------------------------- */

/**
 * How tall the card is when it is promoted into the resume row: the height of
 * the cards it is standing among.
 *
 * The card's shape is not in question and is not changed here. What was wrong is
 * that it kept its own 177px in a row of 101px cards, so the one thing at the top
 * of the page was a tall tile at exactly the width of the tool grid directly
 * below it, and it read as a card that had fallen out of that grid (issue #1114).
 *
 * The row is not made to match it, which is the other way to get one bottom edge
 * and the wrong one: a rail card stretched to 177px holds 76px of nothing between
 * its detail line and the action `mt-auto` pins to its foot (#1074). So the card
 * comes to the row rather than the row to the card, and `RESUME_ROW`'s
 * `items-start` stays exactly as it was.
 *
 * `6.5rem` is 104px, which is what the Warpath and Conquest cards stand at. Not
 * read off the rail, because no zone here knows another exists, and a number kept
 * in step by hand is the price of that.
 *
 * Only from `sm`. Below that the row is a column, the card is full width like
 * everything else in it, and a fixed height would crop the band.
 *
 * The accent border comes with it. The row reads left to right and the card is
 * first because it outranks the hero (see `../StackedLayout`), but the hero wore
 * the only accent on the page, which said the opposite. One accent, on the thing
 * that is first, and `Continue` is told to drop its own while this card is there.
 */
const ROW_CARD_CLASS = "border-primary/40 sm:h-[6.5rem]";

/**
 * How wide the card is in the row: 2.39:1 against the height above, which is
 * 248px.
 *
 * The card cannot simply take the row, which is the width of the window: at
 * 3440px it would be 33:1, a picture at one end and a button at the other. 2.39
 * is the anamorphic frame, and past it the picture stops being a picture of
 * anything.
 */
const ROW_COLUMN_CLASS = "sm:w-[calc(6.5rem*2.39)]";

/**
 * The picture in the promoted card: whatever the band leaves of the card's
 * height. No floor, because the card's height is the fixed thing there and
 * `min-h-28` would push it back to 177px, which is the whole of issue #1114.
 */
const ROW_ART_WINDOW_CLASS = "relative flex-1";

/**
 * The art card: the shared shell of `cardShell.ts`, which owns why the text over a
 * minimap clears AA in both colour schemes. A minimap is whatever colour the map
 * is, from a snowfield to a night battle, and the shell's measurement bounds both
 * ends.
 */
const ART_CARD_CLASS = ART_SHELL_CLASS;

/**
 * What a card that does something wears: the tool grid's own hover cue and the
 * shared focus ring.
 *
 * The grid's cards and the rail's are links, and every one of them lifts its
 * border on hover. This card was the exception while it was offering a map,
 * because the only thing that did anything was the chip in its band, so it looked
 * like a card that had stopped working. It is a control now, in both of its
 * states: a link to the map once the map is there, and the install before that.
 */
const INTERACTIVE_CLASS = `transition-colors hover:border-ring ${CARD_FOCUS_CLASS}`;

/** The no-art card: the ordinary card surface, with the map icon in place of art. */
const PLAIN_CARD_CLASS = `${CARD_SHELL_CLASS} ${CARD_STACK_CLASS} bg-card text-card-foreground`;

/** The band on the no-art card, where the ordinary card colours apply. */
const PLAIN_BAND_CLASS =
  "relative flex items-center gap-3 border-t border-border p-3";
