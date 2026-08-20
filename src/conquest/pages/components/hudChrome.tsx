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
 * `hudChrome.test.ts` measures over the whole sRGB cube in both ramps.
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

/** Semantic accent driving value colour + corner-bracket colour. */
export type HudAccent = "teal" | "amber" | "neutral" | "danger";

const BRACKET: Record<HudAccent, string> = {
  teal: "border-cyan-400/70",
  amber: "border-amber-400/70",
  neutral: "border-border",
  danger: "border-red-500/70",
};

const LABEL: Record<HudAccent, string> = {
  teal: "text-cyan-400/90",
  amber: "text-amber-400/90",
  neutral: "text-muted-foreground",
  danger: "text-red-400/90",
};

const VALUE: Record<HudAccent, string> = {
  teal: "text-cyan-300",
  amber: "text-amber-300",
  neutral: "text-foreground",
  danger: "text-red-400",
};

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
  const corner = accentColor ? "" : BRACKET[accent];
  const cornerStyle = accentColor ? { borderColor: accentColor } : undefined;
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
      className={`${positioned ? "" : "relative"} rounded-md border border-border/50 bg-card/70 ${className ?? ""}`}
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
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
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
