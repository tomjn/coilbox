/**
 * The note that says a layout is drawn somewhere its own numbers do not say
 * (issue #1427).
 *
 * An author who opens a hand written layout, reads a position out of it and
 * looks at the screen sees the two disagree, and cannot tell a bug from a
 * rounding error from the build grid doing its job. This says which of the three
 * it is, and offers the fix in the same breath, because writing the drawn
 * positions into somebody's layout is a thing they ask for rather than a thing
 * that happens to them.
 *
 * The offer is deliberately not automatic and not on load. See `./offGrid.ts`.
 */

import { Button } from "@picoframe/frame";

import type { OffGridBuilding } from "./offGrid";

/** Buildings named by their place in the layout, the way an author counts
 *  them. The same counting the layout's other notes use. */
function listed(off: OffGridBuilding[]): string {
  return off.map((one) => one.index + 1).join(", ");
}

export function OffGridNote({
  offGrid,
  onSnap,
}: {
  /** Buildings the engine will not build where the layout says. Empty when the
   *  grid agrees, and also when the game's units have not been read, because
   *  without them nothing knows what any of these stand on. */
  offGrid: OffGridBuilding[];
  /** Write the drawn positions into the layout. An edit like any other, so it
   *  goes through the history and through the shared layout rules. */
  onSnap: () => void;
}) {
  if (offGrid.length === 0) return null;
  const one = offGrid.length === 1;

  return (
    <div className="space-y-2 rounded bg-slate-800/70 px-2 py-1.5 text-[11px] text-slate-300">
      <p>
        This blueprint's numbers do not agree with the build grid. Building
        {one ? " " : "s "}
        {listed(offGrid)} {one ? "is" : "are"} drawn where the engine will build{" "}
        {one ? "it" : "them"}, which is not the position the blueprint holds for{" "}
        {one ? "it" : "them"}. Nothing has been changed.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-full px-2 text-[11px]"
        onClick={onSnap}
      >
        Put the blueprint on the build grid
      </Button>
    </div>
  );
}
