import type { ReactNode } from "react";

/**
 * Shared "command console" chrome for the conquest + warpath (runlite) map
 * overlays, so the two surfaces read as one visual system by construction
 * rather than by copy-paste. Conquest owns it because runlite already imports
 * conquest UI (`GalaxyView`, `FactionDot`); the reverse would be a cycle.
 *
 * `BracketFrame` is the framed tile (L-shaped corner accents over a translucent
 * card); `StatCard` is the two-tier stat readout the mockups call for — a small
 * tracked-allcaps label above a large display value.
 */

/**
 * The band a label wears when it sits straight on the galaxy canvas (#1052).
 *
 * Most of the map's HUD is inside a {@link BracketFrame}, which paints a card
 * under its text. A couple of labels are not, and what is behind those is a
 * rendered starfield that moves as the player pans, zooms and tilts. Theme ink
 * on that is a coin toss: `--muted-foreground` is a 41% dark grey in the light
 * scheme, and the pan/zoom hint measured 3.60:1 against the empty backdrop
 * before this, worse over any star.
 *
 * The band is the same answer `src/home/cardShell.ts` reached for text on card
 * art, and the same two alphas, so the guarantee is the one that file already
 * proves: 78% of the page's own background over the canvas leaves a colour both
 * inks clear 4.5:1 against, whatever the canvas was painting. That is the point
 * of a band rather than a brighter ink. It turns "legible over a starfield",
 * which nothing can measure, into "legible over a known colour", which
 * `hudChrome.test.ts` measures over the whole sRGB cube.
 *
 * Raw `hsl(var(--token))` rather than `bg-background/78`, for the reason
 * cardShell gives at length: Tailwind's alpha syntax mixes in oklab, and the
 * measurement is a straight sRGB composite.
 */
export const MAP_BAND_CLASS = "rounded-md bg-[hsl(var(--background)/0.78)]";

/** Body ink in the band. */
export const MAP_INK_CLASS = "text-[hsl(var(--foreground))]";

/** The quieter ink in the band, for a label or a hint. */
export const MAP_DIM_INK_CLASS = "text-[hsl(var(--foreground)/0.75)]";

/**
 * The card a {@link BracketFrame} paints between the galaxy canvas and its text
 * (#1785).
 *
 * The band above is for the two labels with nothing under them. This is every
 * other tile on both maps, which does have something under it, just not enough
 * of it: the card was `bg-card/70`, so 30% of whatever the starfield was
 * rendering landed behind the text. Over empty space that is fine. Over a star
 * it is not, and `text-muted-foreground` on a card over a white pixel measured
 * 2.3:1 in the dark scheme against the 4.5:1 small text needs.
 *
 * 78% is the same figure `ART_BAND_CLASS` and {@link MAP_BAND_CLASS} use, and it
 * buys the same thing: a backdrop bounded by the card rather than by the sky. It
 * is not enough on its own, because what the alpha fixes and what it cannot fix
 * are different problems.
 *
 * - It fixes the body ink. `--card-foreground` over this card measures 6.62:1,
 *   worst case over any canvas colour on any base.
 * - It does not fix `--muted-foreground`, which is calibrated against a flat
 *   surface and would need the card at 95% to survive a star. That is opaque in
 *   all but name. {@link HUD_DIM_INK_CLASS} steps the card's own ink down
 *   instead, which is `cardShell.ts`'s fact three reached again from the other
 *   direction. `.hud-card` in `src/index.css` points the token at that ink for
 *   the whole subtree, so a HUD label written as `text-muted-foreground` is
 *   bounded wherever it is.
 *
 * Raw `hsl(var(--card)/0.78)` rather than `bg-card/78`, for the oklab reason
 * cardShell gives.
 */
export const HUD_CARD_CLASS =
  "hud-card rounded-md border border-border/50 bg-[hsl(var(--card)/0.78)]";

/** Body ink on the HUD card. */
export const HUD_INK_CLASS = "text-[hsl(var(--card-foreground))]";

/** The quieter ink on the HUD card, for a label, a hint or a meta figure. */
export const HUD_DIM_INK_CLASS = "text-[hsl(var(--card-foreground)/0.75)]";

/** Semantic accent driving value colour + corner-bracket colour. */
export type HudAccent = "teal" | "amber" | "neutral" | "danger";

const BRACKET: Record<HudAccent, string> = {
  teal: "border-cyan-400/70",
  amber: "border-amber-400/70",
  neutral: "border-border",
  danger: "border-red-500/70",
};

/**
 * Accent text on the HUD card, one value each, for the dark ramp.
 *
 * These were `text-cyan-300`, `text-amber-400/90` and friends, and the card's
 * alpha was never their problem. A Tailwind 300/400 shade is picked to sit on a
 * dark surface, and the HUD did not force a dark scheme, so on a light one they
 * were cyan on white: 1.0:1 for the teal and the amber, 1.7:1 for the danger
 * red. Raising the card's opacity cannot help, because the card is white there
 * too. So #1785 gave each accent a value per ramp.
 *
 * #1810 then answered the same defect at the root: both maps hold the dark ramp
 * whatever theme the player picked, because a starfield has no light version to
 * put a light HUD on. That made the light value unreachable, and an unreachable
 * value is not free. It is a shape every later accent has to be poured into, and
 * the violet below was very nearly poured a light value nobody could ever have
 * seen. So they are single values again, and this time the ramp is decided
 * rather than guessed (#1811).
 *
 * The two map routes are what decide it, with `appearance: "dark"` on the route
 * itself, and `hudChrome.test.ts` holds the assumption up by checking both that
 * they still say so and that nothing imports this file from outside them. If the
 * forcing ever goes, these need their other half back.
 *
 * Written as `hsl()` literals rather than palette classes so `hudChrome.test.ts`
 * can read the shipped numbers back out and re-measure them. Each clears 4.5:1
 * over {@link HUD_CARD_CLASS} whatever the canvas paints, on every base preset,
 * with the worst case between 4.85:1 and 5.29:1.
 *
 * The danger red is the one that visibly moved. Red has little luminance to
 * spend, so clearing AA over a card the sky is showing through means a pale red.
 * The corner brackets keep the saturated colour, since they are decoration
 * rather than text.
 *
 * A tile's label and its value now take the same accent, where the label used to
 * be a 90% alpha step below. Both values have to clear AA on their own, so the
 * step was a tenth of an alpha doing nothing the 10px-versus-20px size gap was
 * not already doing louder.
 *
 * `violet` is here for its measurement rather than for a tile. Nothing gives a
 * frame a violet bracket. The warpath's signal overlay marks itself with a violet
 * icon, `text-violet-400` measured 2.59:1 on the dark card, and an accent that
 * lives in this map is one `hudChrome.test.ts` sweeps for free (#1801).
 */
export const HUD_ACCENT_INK = {
  teal: "text-[hsl(190_75%_74%)]",
  amber: "text-[hsl(42_90%_69%)]",
  danger: "text-[hsl(4_85%_87%)]",
  violet: "text-[hsl(258_70%_88%)]",
};

const LABEL: Record<HudAccent, string> = {
  teal: HUD_ACCENT_INK.teal,
  amber: HUD_ACCENT_INK.amber,
  danger: HUD_ACCENT_INK.danger,
  neutral: HUD_DIM_INK_CLASS,
};

const VALUE: Record<HudAccent, string> = {
  teal: HUD_ACCENT_INK.teal,
  amber: HUD_ACCENT_INK.amber,
  danger: HUD_ACCENT_INK.danger,
  neutral: HUD_INK_CLASS,
};

/** A `#rgb` or `#rrggbb` literal, which is all a galaxy document may name. */
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * The faction colour a frame will paint, or nothing.
 *
 * `Faction.color` is documented as `#rrggbb` and parsed as "any string at all"
 * (`parseFaction` in `../../model.ts`), and a galaxy can arrive from an imported
 * challenge code rather than from this app. What reaches the DOM here is a
 * corner bracket's `border-color`, so an unrecognised value falls back to the
 * accent's own bracket instead of being handed to the style property.
 *
 * The bound is on the format, not the luminance. The corners are `aria-hidden`
 * decoration and the panel names the faction in text beside its dot, so nothing
 * here has a contrast requirement to meet, and a galaxy is entitled to a dark
 * faction colour.
 */
export function bracketColor(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && HEX_COLOUR.test(trimmed) ? trimmed : undefined;
}

/**
 * A translucent card with L-shaped corner accents (top-left + bottom-right),
 * echoing the mockup's console framing. `accent` colours the corners from the
 * semantic palette; `accentColor` overrides that with an arbitrary CSS colour
 * (e.g. the owning faction's colour), taking precedence when set.
 */
export function BracketFrame({
  accent = "neutral",
  accentColor,
  className,
  children,
}: {
  accent?: HudAccent;
  accentColor?: string;
  className?: string;
  children: ReactNode;
}) {
  const colour = bracketColor(accentColor);
  const corner = colour ? "" : BRACKET[accent];
  const cornerStyle = colour ? { borderColor: colour } : undefined;
  // The corner accents are absolutely positioned, so the frame must establish a
  // positioning context. Add `relative` only when the caller hasn't set its own
  // position — otherwise Tailwind's `.relative` would override a caller's
  // `absolute`/`fixed` (they share specificity; `.relative` is emitted later),
  // dropping a self-positioned panel out of place.
  const positioned = /(?:^|\s)(?:absolute|fixed|sticky|relative)(?:\s|$)/.test(
    className ?? "",
  );
  return (
    <div
      className={`${positioned ? "" : "relative"} ${HUD_CARD_CLASS} ${className ?? ""}`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute left-0 top-0 size-2.5 rounded-tl-md border-l-2 border-t-2 ${corner}`}
        style={cornerStyle}
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute bottom-0 right-0 size-2.5 rounded-br-md border-b-2 border-r-2 ${corner}`}
        style={cornerStyle}
      />
      {children}
    </div>
  );
}

/**
 * One console tile: a top row with a tracked-allcaps `label` (left, with an
 * optional leading `icon` and trailing `action` such as a help popover) and
 * monospace `meta` figures (right), then a large display `value`, then optional
 * `children` (progress bar, pips, hint line). `label`/`value` use the Oxanium
 * display face; `accent` tints the value + bracket.
 */
export function StatCard({
  icon,
  label,
  meta,
  value,
  accent = "neutral",
  action,
  children,
  className,
}: {
  icon?: ReactNode;
  label: string;
  meta?: string;
  value: ReactNode;
  accent?: HudAccent;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <BracketFrame
      accent={accent}
      className={`min-w-[8.5rem] flex-1 px-3 py-2 ${className ?? ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`flex items-center gap-1.5 font-display text-[10px] font-medium uppercase tracking-[0.18em] ${LABEL[accent]}`}
        >
          {icon}
          {label}
          {action}
        </span>
        {meta && (
          <span
            className={`font-mono text-[11px] tabular-nums ${HUD_DIM_INK_CLASS}`}
          >
            {meta}
          </span>
        )}
      </div>
      <div
        className={`mt-1 font-display text-xl font-semibold uppercase leading-none tracking-wide tabular-nums ${VALUE[accent]}`}
      >
        {value}
      </div>
      {children}
    </BracketFrame>
  );
}
