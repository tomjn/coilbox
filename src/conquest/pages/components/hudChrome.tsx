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
 * echoing the mockup's console framing. `accent` colours the corners.
 */
export function BracketFrame({
  accent = "neutral",
  className,
  children,
}: {
  accent?: HudAccent;
  className?: string;
  children: ReactNode;
}) {
  const corner = BRACKET[accent];
  return (
    <div
      className={`relative rounded-md border border-border/50 bg-card/70 ${className ?? ""}`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute left-0 top-0 size-2.5 rounded-tl-md border-l-2 border-t-2 ${corner}`}
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute bottom-0 right-0 size-2.5 rounded-br-md border-b-2 border-r-2 ${corner}`}
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
