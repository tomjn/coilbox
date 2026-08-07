import { Button } from "@picoframe/frame";
import { Check, Download, Loader2, Map as MapIcon } from "lucide-react";
import { Link } from "react-router";
import {
  type FeaturedState,
  springNameOf,
  useFeaturedMap,
  useFeaturedMapArt,
  useFeaturedMapInstall,
} from "../featuredMap";

/**
 * One curated map, promoted for the day, with a button that installs it.
 *
 * Which map is decided in {@link ../featuredMap}: a daily rotation over the maps
 * the GitHub `catalog.json` already curates for the map packs. This file is only
 * the card.
 *
 * The states it can be in, and why each is what it is:
 *
 * - Catalog not back yet: a placeholder the size of the card, so the page below
 *   does not jump when it arrives.
 * - Catalog back and nothing curated: nothing at all. `catalog.json` ships inside
 *   the app bundle and the Rust side falls back to it, so an offline player still
 *   gets the full curated list. An empty pool therefore means a build with its
 *   catalog stripped, and a card announcing a featured map it does not have is
 *   worse than the zone standing down, which is what the design has every zone do
 *   when it has nothing.
 * - Already installed: the same map everyone else sees today, because the daily
 *   rotation is the whole point and skipping to one the player lacks would break
 *   it. What changes is the offer: the card links to the map instead of selling a
 *   download the player already made.
 * - Downloading, queued, failed: said plainly on the card, because this card owns
 *   one map and a silent failure reads as a dead button.
 */
export default function FeaturedMap() {
  const { map, loading, source } = useFeaturedMap();
  const { state, error, canDownload, download } = useFeaturedMapInstall(map);
  const art = useFeaturedMapArt(map, state === "installed");

  if (loading) return <Placeholder />;
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
          />
          {/* The art window. Grows with the card, so the picture reaches the
              band however deep the band gets. */}
          <span aria-hidden="true" className="relative min-h-40 flex-1" />
        </>
      ) : (
        <span
          aria-hidden="true"
          className="flex min-h-40 flex-1 items-center justify-center"
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
              (source === "battle" ? BATTLE_BLURB : (map.blurb ?? "Curated map"))}
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

  return (
    <section aria-labelledby="featured-map-heading">
      <Heading />
      {installedName ? (
        // Installed: the card is the way to the map, so the whole surface is the
        // link and the band carries no button to nest inside it.
        <Link
          to={`/content/maps/${encodeURIComponent(installedName)}`}
          className={`${art ? ART_CARD_CLASS : PLAIN_CARD_CLASS} hover:border-ring`}
        >
          {body}
        </Link>
      ) : (
        <div className={art ? ART_CARD_CLASS : PLAIN_CARD_CLASS}>{body}</div>
      )}
      {!canDownload && state !== "installed" && (
        <p className="mt-2 max-w-[33rem] text-xs text-muted-foreground">
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
    </section>
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
      id="featured-map-heading"
      className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
    >
      Featured map
    </h2>
  );
}

/**
 * The card's footprint while the catalog is still loading. Not a spinner: the
 * catalog usually comes off disk and resolves in a frame or two, and a spinner
 * that flashes is worse than a shape that settles.
 */
function Placeholder() {
  return (
    <section aria-labelledby="featured-map-heading">
      <Heading />
      <div
        aria-hidden="true"
        className={`${PLAIN_CARD_CLASS} min-h-52 motion-safe:animate-pulse`}
      />
    </section>
  );
}

/** What the card offers for the map, given where its download has got to. */
function Action({
  state,
  canDownload,
  onDownload,
  title,
}: {
  state: FeaturedState;
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
      className={ACTION_BUTTON_CLASS}
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
 * The install button's colours, restated as raw tokens.
 *
 * picoframe's `outline` variant is `border-input bg-background`, Tailwind
 * utilities both. Inside the dark island of the art card those resolve to the
 * *page's* scheme, not the card's, so on a light page the button would be white
 * with the band's light text on it and read as blank. Restating them as
 * `hsl(var(--token))` makes them substitute on the button itself, which is
 * inside `.dark` and so gets the dark ramp. `cn`'s tailwind-merge drops the
 * variant's versions, since both are background and border utilities.
 *
 * The same string is correct on the no-art card, where the tokens are the page's
 * because there is no `.dark` above it, which is exactly what the variant would
 * have given.
 */
const ACTION_BUTTON_CLASS =
  "shrink-0 border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]";

/**
 * The card shell. One card wide enough for a map to be worth looking at, capped
 * so it does not stretch across a wide window, and full width below that.
 */
const CARD_CLASS =
  "group relative flex w-full max-w-[33rem] flex-col overflow-hidden rounded-lg border border-border text-left";

/**
 * The art card, following the tool cards of issue #991: art edge to edge, and a
 * band at the foot carrying the text over it.
 *
 * `dark` is the load-bearing class, for the reason `ToolCards.tsx` sets out at
 * length. A minimap is whatever colour the map is, including a snowfield, so the
 * text over it must be light in a light page too. Declaring the card a dark
 * island borrows the theme's own dark ramp instead of hardcoding white, and a
 * distribution that themes that ramp themes this card with it.
 *
 * The tokens are the raw picoframe triples rather than Tailwind's
 * `bg-background`, because Tailwind v4 substitutes `var(--background)` into
 * `--color-background` at `:root` and so drags the page's scheme in regardless of
 * `.dark` here.
 */
const ART_CARD_CLASS = `${CARD_CLASS} dark bg-[hsl(var(--background))]`;

/** The no-art card: the ordinary card surface, with the map icon in place of art. */
const PLAIN_CARD_CLASS = `${CARD_CLASS} bg-card text-card-foreground`;

/**
 * The band the title and action sit in, dimming the art under them enough for
 * the text to clear WCAG AA. `featuredMap.test.ts` reads the alpha out of this
 * string and measures the contrast it leaves against a pure white pixel, which is
 * the worst case a photographic minimap can produce. Changing the number re-runs
 * that measurement rather than quietly weakening it.
 */
const ART_BAND_CLASS =
  "relative flex items-center gap-3 bg-[hsl(var(--background)/0.78)] p-3 text-[hsl(var(--foreground))]";

/** The same band on the no-art card, where the ordinary card colours apply. */
const PLAIN_BAND_CLASS =
  "relative flex items-center gap-3 border-t border-border p-3";

/**
 * A short fade above the band so it reads as art receding rather than as a bar
 * bolted across the card. Its top edge is transparent, so no text ever sits on
 * the fade and the measured contrast belongs to the band alone.
 */
const ART_FADE_CLASS =
  "pointer-events-none absolute inset-x-0 bottom-full h-10 bg-gradient-to-t from-[hsl(var(--background)/0.78)] to-transparent";

/**
 * Secondary text on the art card. A step down in opacity from the foreground
 * rather than `--muted-foreground`, which is calibrated against a 7% background
 * and measures well under AA over this band.
 */
const ART_DIM_CLASS = "text-[hsl(var(--foreground)/0.75)]";

/** The class strings the contrast test measures. Not part of the card's API. */
export const FEATURED_ART_CLASSES = {
  band: ART_BAND_CLASS,
  dim: ART_DIM_CLASS,
  fade: ART_FADE_CLASS,
};
