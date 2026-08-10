/**
 * A glyph per kind of thing on the hub, so a grid can be scanned rather than
 * read.
 *
 * The same five glyphs the hub website draws (`components/KindIcon.tsx` in
 * tomjn/coilbox-hub), redrawn here rather than swapped for lucide equivalents:
 * somebody who found an item on the website and opened it here should see the
 * same mark for it. They are paths rather than an image so they take the
 * surrounding text colour.
 *
 * Warpath and conquest share the dots-and-lines vocabulary because they are the
 * same kind underneath, and differ by linear against branching, which is the
 * difference the payload actually records.
 *
 * Nothing here is announced: the badge these sit in carries the kind as text.
 */

import type { HubKind } from "../api";

/** Two teams facing each other, which is what a preset describes. Two blocks
 * rather than a grid of slots, because at 14px the slots fill in solid. */
function Preset() {
  return (
    <>
      <rect x="3" y="5" width="7" height="14" rx="2" />
      <rect x="14" y="5" width="7" height="14" rx="2" />
      <path d="M12 3v18" />
    </>
  );
}

/** A route with one destination. */
function Warpath() {
  return (
    <>
      <path d="M4 17l5-5 5 3 4.5-6" />
      <circle cx="20" cy="7" r="2.5" />
    </>
  );
}

/** Systems joined to each other, with no single end. */
function Conquest() {
  return (
    <>
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M8.5 7.2l7 0.6" />
      <path d="M7.2 9.2l3.6 6.6" />
      <path d="M16.7 10.1l-3.4 5.8" />
    </>
  );
}

/** A game, an engine and its maps, stacked into one thing to install. */
function SetupPack() {
  return (
    <>
      <path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" />
      <path d="M3 12.5l9 4.5 9-4.5" />
      <path d="M3 17l9 4.5 9-4.5" />
    </>
  );
}

/** An objective to reach. */
function Scenario() {
  return (
    <>
      <path d="M6 21V3" />
      <path d="M6 3h12l-3 3.5L18 10H6" />
    </>
  );
}

/**
 * Mode before kind, matching `describeItem`: a challenge is a conquest or
 * a warpath run before it is a challenge. An unrecognised kind gets no glyph
 * rather than a wrong one, the same way the label falls back to itself.
 */
export function KindIcon({
  kind,
  mode,
  className = "size-3.5",
}: {
  kind: HubKind | string;
  mode?: string | null;
  className?: string;
}) {
  const glyph =
    mode === "warpath" ? (
      <Warpath />
    ) : mode === "conquest" ? (
      <Conquest />
    ) : kind === "preset" ? (
      <Preset />
    ) : kind === "setup-pack" ? (
      <SetupPack />
    ) : kind === "scenario" ? (
      <Scenario />
    ) : null;

  if (!glyph) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {glyph}
    </svg>
  );
}
