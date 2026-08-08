import { useFrame, useTheme } from "@picoframe/frame";
import type { NavItem } from "@picoframe/plugin-sdk";
import { ExternalLink } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { type CardArt, resolveCardArt } from "../art";
import {
  ART_BAND_CLASS,
  ART_DIM_CLASS,
  ART_FADE_CLASS,
  ART_CARD_CLASS as ART_SHELL_CLASS,
  CARD_SHELL_CLASS,
} from "../cardShell";
import { homeToolGroups, splitGroupItems } from "../nav";
import { openExternal, useResolvedNavItem } from "../navItem";
import LinkCard from "./LinkCard";

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
 *
 * A group's external links do not each get a card. They share one, at the end of
 * their own group - see {@link LinkCard} for why there and not somewhere of its
 * own.
 *
 * `suggested` is the suggested map's card, handed over by the layout. A map
 * suggestion is a download, so it belongs in the Downloads group rather than in a
 * section of its own at the foot of the page (issue #1037). The grid places it
 * and never builds it: what it is, and whether there is one at all, stays the
 * suggested map zone's business.
 */
export default function ToolCards({ suggested }: { suggested?: ReactNode }) {
  const { nav } = useFrame();
  // Groups as composeNav sorted them, minus Home and anything left empty, so the
  // grid mirrors the sidebar. Shared with the Greeting, which needs the same
  // answer to decide whether to say there are no tools.
  const groups = homeToolGroups(nav);
  if (groups.length === 0) return null;

  return (
    <div className="mt-6 space-y-8">
      {groups.map((group) => {
        const { tools, links } = splitGroupItems(group.items);
        return (
          <section
            key={group.id}
            className="hidden has-[[data-nav-item]]:block"
          >
            {group.label && (
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h2>
            )}
            <div className="flex flex-wrap gap-3">
              {tools.map((item) => (
                <ToolCard key={item.id} item={item} />
              ))}
              {group.id === SUGGESTED_MAP_GROUP && suggested}
              {links.length > 0 && <LinkCard items={links} />}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * The nav group the suggested map's card joins.
 *
 * The downloads plugin's group id. It is always there: plugins are registered in
 * `app.plugins.ts` rather than configured, and of its three items a profile can
 * hide Browse Rapid and Games but not Maps, so the group never empties.
 *
 * After the tools and before the shared links card. Links leave the app, so they
 * stay last, which is the order {@link LinkCard} already argues for.
 */
const SUGGESTED_MAP_GROUP = "downloads";

/**
 * What a tool card adds to the shared shell in both rendering modes. Sizing and
 * the border cue: full width on a phone, a fixed 16rem above that so cards pack
 * left and wrap instead of stretching to fill a grid cell.
 */
const TOOL_CARD_CLASS = "transition-colors hover:border-ring sm:w-64";

/**
 * The icon-only card: an icon beside a label, on the card surface. What every
 * card looked like before issue #991, kept as a mode rather than deleted because
 * a distribution can switch art off per tool (issue #1000), and because a
 * broken image URL falls back to it. No art, so none of the band applies.
 */
const ICON_CARD_CLASS = `${CARD_SHELL_CLASS} ${TOOL_CARD_CLASS} items-center gap-3 bg-card p-4 text-card-foreground hover:bg-accent`;

/**
 * The art card: the shared shell of `cardShell.ts`, which owns why the text on it
 * clears AA over any picture in either colour scheme.
 *
 * The hover cue is a shadow and a slow push into the art, because the icon
 * card's `hover:bg-accent` is invisible under a full-bleed image. The shadow
 * matches the game and map cards elsewhere in the app.
 */
const ART_CARD_CLASS = `${ART_SHELL_CLASS} ${TOOL_CARD_CLASS} hover:shadow-md`;

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

/**
 * One tool as a card.
 *
 * ## The two markers a drawn card leaves
 *
 * - `data-nav-item`, which its group's section looks for to decide whether to
 *   draw itself at all. The links card's chips carry it too, so a group with
 *   nothing but links still gets its heading.
 * - `data-tool-card`, which says this particular card is a way *into* Coilbox.
 *   Only {@link ToolCard} sets it, and {@link splitGroupItems} is what decides
 *   which items reach here, so it means exactly "the grid drew a tool".
 *
 * The Greeting reads the second one, in CSS, to decide whether to say there is a
 * tool to choose. `./Greeting` explains why that sentence has to be answered from
 * what the grid drew rather than from the nav it drew off.
 */
export function ToolCard({ item }: { item: NavItem }) {
  // Mirror the sidebar: an item gated off via `useVisible` is hidden everywhere,
  // this grid included. Resolved unconditionally (per-item component, so
  // hook-safe) before the early return. A card that stands down leaves neither
  // marker, which is what makes both of them mean "drawn" rather than "listed".
  const { visible, label, icon: Icon, description } = useResolvedNavItem(item);
  // The URL that failed, not a flag, so art arriving later (a source whose cache
  // warms mid-session) gets its own chance rather than inheriting the verdict on
  // a URL it has replaced.
  const [broken, setBroken] = useState<string | null>(null);
  // The art Coilbox draws is drawn for the scheme the card is in, and the theme
  // is the only thing here that re-renders when that flips. Reading the scheme
  // inside `resolveCardArt` instead would leave a card painting the old ramp
  // until something else made it render.
  const { resolved } = useTheme();
  if (!visible) return null;

  const art = cardArtUrl(resolveCardArt(item.id, undefined, resolved), broken);
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
        data-tool-card=""
        onClick={() => openExternal(href)}
        className={cardClass}
      >
        {inner}
      </button>
    );
  }
  return (
    <Link
      to={item.to ?? "/"}
      data-nav-item=""
      data-tool-card=""
      className={cardClass}
    >
      {inner}
    </Link>
  );
}
