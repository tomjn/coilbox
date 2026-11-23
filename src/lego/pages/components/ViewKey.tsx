/**
 * The line at the foot of the view: a key to what the view draws, then a word
 * on the gesture in progress.
 *
 * The caller decides what is drawn, and so what has a key. This only words it.
 */

import { useLingui } from "@lingui/react/macro";
import { type BalanceResult, balanceSummary } from "../../balance";
import { type OverlapResult, overlapSummary } from "../../overlap";
import { GUIDE_COLOUR } from "./guideLayer";
import { reachColour } from "./weaponReachLayer";

export function ViewKey({
  fourViews,
  pieceDots,
  collision,
  aimPoint,
  guides,
  balance,
  overlap,
  reaches,
  hint,
}: {
  /** The four view layout, where the hint is left out (#5410). It is about
   *  the one view. The footprint is in the Game tab. */
  fourViews: boolean;
  /** The dots drawn on the selected piece: its own anchors, the faces and
   *  corners of its box, or none. */
  pieceDots: "anchors" | "box" | null;
  /** The collision boxes drawn, and whether a piece's boxes are among them,
   *  or null for none. */
  collision: { pieceBoxes: boolean } | null;
  aimPoint: boolean;
  guides: boolean;
  balance: BalanceResult | null;
  overlap: OverlapResult | null;
  reaches: readonly { number: number }[];
  hint: string;
}) {
  const { t } = useLingui();
  return (
    // One row, wrapping only when the view is too narrow to hold it: each
    // group is a handful of words, and stacking them took a strip off the
    // model for no gain.
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {pieceDots ? (
        <div className="flex gap-3">
          <Dot colour="#8b5cf6" label={t`Turns here`} />
          {/* A piece with anchors of its own offers only those, so the box's
              key would be naming dots that are not drawn. */}
          {pieceDots === "anchors" ? (
            <Dot colour="#f472b6" label={t`Anchors`} />
          ) : (
            <>
              <Dot colour="#38bdf8" label={t`Faces`} shape="face" />
              <Dot colour="#fbbf24" label={t`Corners`} shape="corner" />
            </>
          )}
        </div>
      ) : null}
      {/* Named only while the boxes are drawn, and the piece swatch only
          while there are piece boxes to name. Two oranges with no key was
          the thing that made a piece's box hard to place at all. */}
      {collision ? (
        <div className="flex gap-3">
          <Dot colour="#f97316" label={t`Unit volume`} />
          {collision.pieceBoxes ? (
            <Dot colour="#facc15" label={t`Piece boxes`} />
          ) : null}
        </div>
      ) : null}
      {aimPoint ? (
        <div className="flex gap-3">
          <Dot colour="#ef4444" label={t`Aim point`} />
        </div>
      ) : null}
      {guides ? (
        <div className="flex gap-3">
          <Dot colour={`#${GUIDE_COLOUR.toString(16)}`} label={t`Guides`} />
        </div>
      ) : null}
      {balance ? (
        <span
          className={
            balance.status === "outside" ? "text-orange-400" : undefined
          }
        >
          {balanceSummary(balance)}
        </span>
      ) : null}
      {overlap ? <span>{overlapSummary(overlap)}</span> : null}
      {reaches.length > 0 ? (
        <div className="flex gap-3">
          {reaches.map((reach, index) => {
            const weaponNumber = reach.number;
            return (
              <Dot
                key={reach.number}
                colour={reachColour(index)}
                label={t`Weapon ${weaponNumber}`}
              />
            );
          })}
        </div>
      ) : null}
      {fourViews ? null : <span>{hint}</span>}
    </div>
  );
}

/** A key to the dots drawn on the selected piece. */
function Dot({
  colour,
  label,
  shape = "dot",
}: {
  colour: string;
  label: string;
  /** What the key draws, matching what the view draws for it: a square lying
   *  in a face, a cube on a corner, a plain dot for everything else. */
  shape?: "dot" | "face" | "corner";
}) {
  return (
    <span className="flex items-center gap-1">
      {shape === "dot" ? (
        <span
          className="size-1.5 rounded-full"
          style={{ backgroundColor: colour }}
        />
      ) : (
        <Iso colour={colour} shape={shape} />
      )}
      {label}
    </span>
  );
}

/**
 * The key's own swatch for a face or a corner, drawn at the angle the view
 * shows them from.
 *
 * A flat square and a cube both come out as a circle in plan, so a key of
 * round dots says nothing about which marker it names. Shaded per face rather
 * than outlined, because an outline dark enough to read against the model is
 * invisible against the panel behind the key.
 */
function Iso({ colour, shape }: { colour: string; shape: "face" | "corner" }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className="size-3 shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      {shape === "face" ? (
        <polygon points="6,2 11,6 6,10 1,6" fill={colour} />
      ) : (
        <>
          <polygon points="6,1 11,3.5 6,6 1,3.5" fill={colour} />
          <polygon points="1,3.5 6,6 6,11 1,8.5" fill={colour} opacity={0.75} />
          <polygon
            points="11,3.5 6,6 6,11 11,8.5"
            fill={colour}
            opacity={0.5}
          />
        </>
      )}
    </svg>
  );
}
