import { Button } from "@picoframe/frame";
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
  const { map, loading, source, inventory } = useSuggestedMapAnswer();
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

  const installedName = state === "installed" ? springNameOf(map) : undefined;
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
          <span aria-hidden="true" className={ART_WINDOW_CLASS} />
        </>
      ) : (
        <span
          aria-hidden="true"
          className={`flex items-center justify-center ${ART_WINDOW_CLASS}`}
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
            {error ??
              (source === "battle"
                ? BATTLE_BLURB
                : (map.blurb ?? "Curated map"))}
          </span>
        </span>
        <Action
          state={state}
          canDownload={canDownload}
          onDownload={download}
          title={map.title}
        />
      </span>
    </>
  );

  // A `section` with a label in the resume row, where the card stands among
  // zones rather than among cards and is otherwise the only thing up there with
  // nothing saying what it is. A plain div everywhere else: in the Downloads
  // group the group's heading already says it, and the `section` variant has one
  // of its own wrapped around this.
  const Column = variant === "row" ? "section" : "div";
  return labelled(
    <Column
      className={COLUMN_CLASS}
      aria-label={variant === "row" ? "Suggested map" : undefined}
    >
      {installedName ? (
        // Installed: the card is the way to the map, so the whole surface is the
        // link and the band carries no button to nest inside it.
        <Link
          to={`/content/maps/${encodeURIComponent(installedName)}`}
          className={`${art ? ART_CARD_CLASS : PLAIN_CARD_CLASS} hover:border-ring ${CARD_FOCUS_CLASS}`}
        >
          {body}
        </Link>
      ) : (
        <div className={art ? ART_CARD_CLASS : PLAIN_CARD_CLASS}>{body}</div>
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

/**
 * The subtitle when the map came from a live battle rather than the rotation.
 *
 * It replaces the catalog blurb rather than joining it, because the band gives
 * the subtitle one truncated line and the reason this map is here outranks its
 * description. It is also the only thing that distinguishes the two sources on
 * screen: the card is otherwise identical either way, so without this line the
 * feature could not be confirmed by looking at it.
 */
const BATTLE_BLURB = "Being played now";

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
  canDownload,
  onDownload,
  title,
}: {
  state: SuggestedState;
  canDownload: boolean;
  onDownload: () => void;
  title: string;
}) {
  if (state === "installed") {
    return (
      <span className="flex shrink-0 items-center gap-1 px-1 text-xs">
        <Check className="size-4" />
        Installed
      </span>
    );
  }
  if (state === "active" || state === "queued") {
    return (
      <span className="flex shrink-0 items-center gap-1 px-1 text-xs">
        <Loader2 className="size-3.5 motion-safe:animate-spin" />
        {state === "active" ? "Downloading…" : "Queued"}
      </span>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className={`shrink-0 ${ART_BUTTON_CLASS}`}
      onClick={onDownload}
      disabled={!canDownload || state === "unavailable"}
      aria-label={
        state === "failed" ? `Retry installing ${title}` : `Install ${title}`
      }
    >
      <Download className="size-4" />
      {state === "failed" ? "Retry" : "Install"}
    </Button>
  );
}

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

/**
 * The art card: the shared shell of `cardShell.ts`, which owns why the text over a
 * minimap clears AA in both colour schemes. A minimap is whatever colour the map
 * is, from a snowfield to a night battle, and the shell's measurement bounds both
 * ends.
 */
const ART_CARD_CLASS = ART_SHELL_CLASS;

/** The no-art card: the ordinary card surface, with the map icon in place of art. */
const PLAIN_CARD_CLASS = `${CARD_SHELL_CLASS} ${CARD_STACK_CLASS} bg-card text-card-foreground`;

/** The band on the no-art card, where the ordinary card colours apply. */
const PLAIN_BAND_CLASS =
  "relative flex items-center gap-3 border-t border-border p-3";
