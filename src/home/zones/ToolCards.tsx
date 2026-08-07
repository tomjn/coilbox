import { useFrame } from "@picoframe/frame";
import type { NavItem } from "@picoframe/plugin-sdk";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { type CardArt, resolveCardArt } from "../art";
import { homeToolGroups } from "../nav";

/**
 * Every navigable route as a card, grouped exactly as the sidebar groups them.
 *
 * A fork of picoframe's built-in launcher grid, copied rather than imported
 * because the package exports only `Home` as a whole page and not its parts.
 *
 * Both of picoframe's launcher sentences ("Choose a tool to get started." and
 * the empty-grid "No tools available yet.") moved to the Greeting zone in issue
 * #987, which owns the line under the heading. The grid now does what every zone
 * does and renders nothing when it has nothing.
 */
export default function ToolCards() {
  const { nav } = useFrame();
  // Groups as composeNav sorted them, minus Home and anything left empty, so the
  // grid mirrors the sidebar. Shared with the Greeting, which needs the same
  // answer to decide whether to say there are no tools.
  const groups = homeToolGroups(nav);
  if (groups.length === 0) return null;

  return (
    <div className="mt-6 space-y-8">
      {groups.map((group) => (
        <section key={group.id} className="hidden has-[[data-nav-item]]:block">
          {group.label && (
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {group.label}
            </h2>
          )}
          <div className="flex flex-wrap gap-3">
            {group.items.map((item) => (
              <ToolCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Resolve a nav item's live presentation, in one fixed hook-call order.
 *
 * picoframe's own `useResolvedNavItem` is internal to the package, so this is a
 * copy. Every hook runs even where the result is unused, because hooks must run
 * unconditionally per fiber. As picoframe requires, a given item id must
 * consistently define, or not define, each hook.
 */
function useResolvedNavItem(item: NavItem) {
  return {
    // biome-ignore-start lint/correctness/useHookAtTopLevel: the hook call is guarded by whether the nav item defines it, which picoframe's contract requires to be stable for a given item id. The sidebar resolves items the same way.
    visible: item.useVisible ? item.useVisible() : true,
    label: item.useLabel ? item.useLabel() : item.label,
    icon: item.useIcon ? item.useIcon() : item.icon,
    description: item.useDescription ? item.useDescription() : item.description,
    // biome-ignore-end lint/correctness/useHookAtTopLevel: end of the guarded resolver
  };
}

/**
 * The card layout shared by both rendering modes. Sizing only: full width on a
 * phone, a fixed 16rem above that so cards pack left and wrap instead of
 * stretching to fill a grid cell.
 */
const CARD_CLASS =
  "group relative flex w-full rounded-lg border border-border text-left transition-colors hover:border-ring sm:w-64";

/**
 * The icon-only card: an icon beside a label, on the card surface. What every
 * card looked like before this issue, kept as a mode rather than deleted because
 * a distribution can switch art off per tool (issue #1000), and because a
 * broken image URL falls back to it.
 */
const ICON_CARD_CLASS = `${CARD_CLASS} items-center gap-3 bg-card p-4 text-card-foreground hover:bg-accent`;

/**
 * The art card: art edge to edge behind the whole card, with the icon and name
 * in a band across the foot of it.
 *
 * `dark` is the load-bearing class. Card art is dark whatever the colour scheme
 * (see `proceduralArt.ts`), so the text on it has to be light in a light page
 * too. Rather than hardcode a light colour, the card declares itself a dark
 * island: picoframe's `.dark` block re-declares `--foreground` and `--background`
 * on this element, and everything inside reads them through `hsl(var(--token))`.
 * A distribution that themes its dark ramp therefore themes these cards, and in
 * dark mode the class is a no-op, so one card renders identically in both
 * schemes.
 *
 * Note the tokens are the raw picoframe triples, not Tailwind's `bg-background`
 * utility. Tailwind v4's `--color-*` variables substitute `var(--background)` at
 * `:root`, so they carry the page's scheme into this subtree no matter what
 * `.dark` says here. The raw token substitutes on the element that uses it,
 * which is the whole point.
 *
 * `bg-` is a backstop for art that does not cover: a transparent illustration,
 * or the moment before an image decodes. Without it a light page would show
 * through and take the light text with it.
 *
 * The hover cue is a shadow and a slow push into the art, because the icon
 * card's `hover:bg-accent` is invisible under a full-bleed image. The shadow
 * matches the game and map cards elsewhere in the app.
 */
const ART_CARD_CLASS = `${CARD_CLASS} dark flex-col overflow-hidden bg-[hsl(var(--background))] hover:shadow-md`;

/**
 * The band the icon and name sit in, dimming the art under them enough for the
 * text to clear WCAG AA. `toolCards.test.ts` reads the alpha out of this string
 * and measures the contrast it leaves, so changing the number re-runs the
 * measurement rather than quietly weakening it.
 */
const ART_BAND_CLASS =
  "relative flex items-center gap-3 bg-[hsl(var(--background)/0.78)] p-3 text-[hsl(var(--foreground))]";

/**
 * A short fade above the band so it reads as art receding rather than as a bar
 * bolted across the card. Its own top edge is transparent, so no text is ever
 * over it: the measured contrast belongs to the band alone.
 */
const ART_FADE_CLASS =
  "pointer-events-none absolute inset-x-0 bottom-full h-10 bg-gradient-to-t from-[hsl(var(--background)/0.78)] to-transparent";

/**
 * Secondary text on the art card: the description and the external-link mark.
 *
 * A step down in opacity from the foreground rather than `--muted-foreground`,
 * which cannot be used here. That token is calibrated against a 7% background,
 * and on a vivid base it is a saturated colour rather than a grey: over this
 * band it measures 3.0:1, well under AA. Dropping the foreground's alpha keeps
 * the same hierarchy and holds 6.8:1. Measured alongside the band above.
 */
const ART_DIM_CLASS = "text-[hsl(var(--foreground)/0.75)]";

/**
 * Which art a card should paint, given what the chain resolved and which URL (if
 * any) has already failed to load.
 *
 * Pure, so the fallback is testable without a DOM. A URL that errors takes the
 * card back to the icon-only mode, which is the one presentation guaranteed to
 * need nothing off disk or off the network.
 */
export function cardArtUrl(art: CardArt, broken: string | null): string | null {
  if (art.kind !== "art") return null;
  return art.url === broken ? null : art.url;
}

export function ToolCard({ item }: { item: NavItem }) {
  // Mirror the sidebar: an item gated off via `useVisible` is hidden everywhere,
  // this grid included. Resolved unconditionally (per-item component, so
  // hook-safe) before the early return. Visible cards carry `data-nav-item` so
  // their section stays shown.
  const { visible, label, icon: Icon, description } = useResolvedNavItem(item);
  // The URL that failed, not a flag, so art arriving later (a source whose cache
  // warms mid-session) gets its own chance rather than inheriting the verdict on
  // a URL it has replaced.
  const [broken, setBroken] = useState<string | null>(null);
  if (!visible) return null;

  const art = cardArtUrl(resolveCardArt(item.id), broken);
  const inner = art ? (
    <>
      <img
        src={art}
        alt=""
        className="absolute inset-0 size-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-105"
        onError={() => setBroken(art)}
      />
      {/* The art window. Grows with the card so a row of cards whose names wrap
          to different depths still shows art edge to edge under all of them. */}
      <span aria-hidden="true" className="relative min-h-28 flex-1" />
      <span className={ART_BAND_CLASS}>
        <span aria-hidden="true" className={ART_FADE_CLASS} />
        {Icon && <Icon size={20} className="shrink-0" />}
        <span className="min-w-0 flex-1">
          {/* Wraps to two lines rather than truncating: the band has the room,
              and a long tool name reads better broken than clipped. No `block`,
              because `line-clamp` sets its own display and the two fight. */}
          <span className="line-clamp-2 font-medium">{label}</span>
          {description != null && (
            <span className={`block truncate text-xs ${ART_DIM_CLASS}`}>
              {description}
            </span>
          )}
        </span>
        {item.href && (
          <ExternalLink size={16} className={`shrink-0 ${ART_DIM_CLASS}`} />
        )}
      </span>
    </>
  ) : (
    <>
      {Icon && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-background">
          <Icon size={20} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {description != null && (
          <span className="block truncate text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      {item.href && (
        <ExternalLink size={16} className="shrink-0 text-muted-foreground" />
      )}
    </>
  );

  const cardClass = art ? ART_CARD_CLASS : ICON_CARD_CLASS;
  if (item.href) {
    const href = item.href;
    return (
      <button
        type="button"
        data-nav-item=""
        onClick={() =>
          openUrl(href).catch((err) =>
            console.error(`home: could not open external url: ${href}`, err),
          )
        }
        className={cardClass}
      >
        {inner}
      </button>
    );
  }
  return (
    <Link to={item.to ?? "/"} data-nav-item="" className={cardClass}>
      {inner}
    </Link>
  );
}

/** The class strings the contrast test measures. Not part of the card's API. */
export const ART_CLASSES = {
  band: ART_BAND_CLASS,
  dim: ART_DIM_CLASS,
  fade: ART_FADE_CLASS,
};
