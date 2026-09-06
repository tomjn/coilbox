import { useFrame, useTheme } from "@picoframe/frame";
import type { NavItem } from "@picoframe/plugin-sdk";
import { ExternalLink } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { type CardArt, cardIsIconOnly, resolveCardArt } from "../art";
import {
  ART_BAND_CLASS,
  ART_DIM_CLASS,
  ART_FADE_CLASS,
  ART_CARD_CLASS as ART_SHELL_CLASS,
  CARD_FOCUS_CLASS,
  CARD_SHELL_CLASS,
} from "../cardShell";
import { forgetContentArt } from "../contentArt";
import { groupDescription } from "../groupDescription";
import { homeToolGroups, splitGroupItems } from "../nav";
import { openExternal, useResolvedNavItem } from "../navItem";
import { accentHueRotate, useThemeColor } from "../useThemeColor";
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
 *
 * ## How tall a card is, is the row's decision
 *
 * A card the distribution set `art: false` has no picture, and how it should be
 * drawn depends on what is beside it rather than on anything about the card. In
 * a row where everything is pictureless the compact card is right and the row is
 * simply shorter, which is what the design was written around. In a row with
 * pictures in it the same card has to hold its own footprint or the row goes
 * ragged (issue #1113).
 *
 * That is a fact about the group, so the group settles it and hands it down,
 * exactly as the page settles art above the layout and settles the suggested
 * map in `CoilboxHome`. No card is asked what its neighbour drew.
 *
 * It is answered from the chain rather than from what the cards rendered, so it
 * is available before any of them render. That leaves one seam: a tool hidden by
 * `useVisible` is counted, because visibility is a hook the row cannot call, and
 * the grid resolves it a component per item for that reason. The error only ever
 * runs one way. A hidden tool with a picture makes an otherwise pictureless row
 * draw at full height, which is even and looks deliberate, and a row with a
 * picture in it can never be mistaken for a pictureless one.
 */
export default function ToolCards({ suggested }: { suggested?: ReactNode }) {
  const { nav } = useFrame();
  // The scheme the cards will be drawn for, so the row asks the chain the same
  // question its cards will. See `ToolCard` for why it comes from the theme.
  const { resolved } = useTheme();
  // Groups as composeNav sorted them, minus Home and anything left empty, so the
  // grid mirrors the sidebar. Shared with the Greeting, which needs the same
  // answer to decide whether to say there are no tools.
  const groups = homeToolGroups(nav);
  if (groups.length === 0) return null;

  return (
    <div className="mt-6 space-y-8">
      {groups.map((group) => {
        const { tools, links } = splitGroupItems(group.items);
        const description = groupDescription(group.id);
        // The suggested map's card is a picture of a map, so a group holding it
        // has a picture in it whatever its tools resolved to.
        const withSuggested = group.id === SUGGESTED_MAP_GROUP && suggested;
        const compact =
          !withSuggested &&
          tools.every((item) => cardIsIconOnly(item.id, undefined, resolved));
        return (
          <section
            key={group.id}
            className="hidden has-[[data-nav-item]]:block"
          >
            {group.label && (
              <div className="mb-3">
                <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </h2>
                {/* What the group is for, in one line. Absent for the link
                    groups a distribution injects, which this cannot describe.
                    See `../groupDescription`. */}
                {description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              {tools.map((item) => (
                <ToolCard key={item.id} item={item} compact={compact} />
              ))}
              {withSuggested}
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
 * What a tool card adds to the shared shell in both rendering modes. Sizing, the
 * border cue and the focus ring: full width on a phone, a fixed 16rem above that
 * so cards pack left and wrap instead of stretching to fill a grid cell.
 */
const TOOL_CARD_CLASS = `transition-colors hover:border-ring sm:w-64 ${CARD_FOCUS_CLASS}`;

/**
 * The icon-only card: an icon beside a label, on the card surface. What every
 * card looked like before issue #991, kept as a mode rather than deleted because
 * a distribution can switch art off per tool (issue #1000), and because it is
 * the floor when every URL the chain offers fails to load. No art, so none of
 * the band applies.
 *
 * Only drawn where the whole row is pictureless, so the row is short together
 * rather than one card short of its neighbours. See {@link ToolCards}.
 */
const ICON_CARD_CLASS = `${CARD_SHELL_CLASS} ${TOOL_CARD_CLASS} items-center gap-3 bg-card p-4 text-card-foreground hover:bg-accent`;

/**
 * The art card: the shared shell of `cardShell.ts`, which owns why the text on it
 * clears AA over any picture in either colour scheme.
 *
 * The hover cue is a shadow and a slow push into the art, because the icon
 * card's `hover:bg-accent` is invisible under a full-bleed image. The shadow
 * matches the game and map cards elsewhere in the app.
 *
 * Worn by the pictureless card in a row that has pictures in it too, which is
 * the same card with a plain panel where the picture goes.
 */
const ART_CARD_CLASS = `${ART_SHELL_CLASS} ${TOOL_CARD_CLASS} hover:shadow-md`;

/**
 * The art window: everything above the band, growing with the card so a row of
 * cards whose names wrap to different depths still shows art edge to edge under
 * all of them.
 */
const ART_WINDOW_CLASS = "relative min-h-28 flex-1";

/**
 * The window with no picture in it: `bg-muted`, the one surface the card design
 * already uses for a panel that holds an icon rather than content.
 *
 * A tone of its own is the whole point. Left on the card's own background the
 * card is a rectangle of flat page colour with a label at the foot, which is
 * what a picture that failed to load looks like. A muted panel is evidently a
 * surface somebody chose, and it is the same tone the compact card puts behind
 * its icon, so a distribution's pictureless tool is drawn in one colour whether
 * its row is short or full height.
 */
const BLANK_WINDOW_CLASS = `${ART_WINDOW_CLASS} bg-muted`;

/**
 * Which art a card should paint, given what the chain resolved and which URL (if
 * any) has already failed to load.
 *
 * Pure, so the fallback is testable without a DOM. A URL that errors is refused
 * here whatever the chain says, so a step that goes on offering it cannot put
 * the card back on it. Where the card lands is then the chain's business: a
 * withdrawn URL leaves an illustration, and a URL nothing withdraws leaves the
 * icon-only mode, which is the one presentation guaranteed to need nothing off
 * disk or off the network.
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
export function ToolCard({
  item,
  compact = false,
}: {
  item: NavItem;
  /**
   * Whether every card in this card's row is pictureless, in which case a card
   * with no art of its own may size to its content and the row is short
   * together. {@link ToolCards} decides it for the whole group and hands it
   * down, so no card learns what its neighbours drew.
   *
   * Defaults to false, the shape of every row that has a picture in it, so a
   * caller with no row to speak of gets the card that keeps a full footprint.
   */
  compact?: boolean;
}) {
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
  // until something else made it render. The colour comes through
  // `useThemeColor` for the same reason: an accent change lands its CSS after
  // the render it caused, so a card has to be told to look again.
  const { resolved, accent } = useTheme();
  const themeColor = useThemeColor();
  if (!visible) return null;

  const resolvedArt = resolveCardArt(item.id, themeColor, resolved);
  const art = cardArtUrl(resolvedArt, broken);
  // A cycling accent (rainbow, opal) animates `--primary` with no render, so
  // drawn art is counter-rotated by the compositor to keep up. Never a photo:
  // those are not theme-tinted, so there is nothing for them to keep up with.
  const drawn =
    resolvedArt.kind === "art" &&
    (resolvedArt.source === "bundled" || resolvedArt.source === "procedural");
  const hueFilter = drawn ? accentHueRotate(accent, themeColor) : undefined;
  // The band across the foot, and the only thing in either full-size card that
  // carries text. One copy, so a pictureless card in a row of pictures reads at
  // the same height and in the same colours as the cards either side of it
  // rather than resembling them.
  const band = (
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
  );

  let inner: ReactNode;
  if (art) {
    inner = (
      <>
        <img
          src={art}
          alt=""
          style={hueFilter ? { filter: hueFilter } : undefined}
          className="absolute inset-0 size-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-105"
          onError={() => {
            // Told to the content step as well as remembered here. That URL may
            // be a cache file the last launch painted and something has since
            // evicted, and only the step that offered it can withdraw it, which
            // is what lets the chain answer with an illustration rather than
            // leaving this card on its icon.
            forgetContentArt(art);
            setBroken(art);
          }}
        />
        <span aria-hidden="true" className={ART_WINDOW_CLASS} />
        {band}
      </>
    );
  } else if (compact) {
    inner = (
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
  } else {
    // Pictureless in a row that has pictures in it: the art card with a plain
    // panel where the picture goes, so the row stays even and the icon and the
    // name sit at the foot where every other card in the row puts them.
    inner = (
      <>
        <span aria-hidden="true" className={BLANK_WINDOW_CLASS} />
        {band}
      </>
    );
  }

  const cardClass = art || !compact ? ART_CARD_CLASS : ICON_CARD_CLASS;
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
