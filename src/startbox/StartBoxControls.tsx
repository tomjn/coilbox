import { Button } from "@picoframe/frame";
import { ArrowLeftRight } from "lucide-react";
import { useState } from "react";
import { allyLetter, readableText } from "@/lib/allyDisplay";
import type { StartRect } from "./geometry";
import { rotateBoxes, rotateOrder } from "./presets";
import { StartBoxPresetsPopover } from "./StartBoxPresetsPopover";

/**
 * Controls for editing start boxes: ally picker, clear buttons and the
 * split-preset popover. Lives under the start-position dropdown (shown only in
 * choose-in-game mode) while the drag editor itself stays on the minimap, so
 * the picked ally is owned by `useStartBoxAllies` on the page and shared
 * between the two. Used by a hosted battle and by singleplayer alike, which is
 * why nothing here knows about a lobby.
 */

/**
 * Derive the box-editing ally state from the colour each ally already has: the
 * allies to offer (those with a player, plus any that already have a box,
 * falling back to [0, 1]) and the ally the next drawn box belongs to (picked,
 * else the lowest without a box).
 *
 * `allyColors` is the caller's job because the two surfaces read a roster
 * differently: a battle takes each ally's first player's colour off the lobby
 * roster, a skirmish off its participant list.
 */
export function useStartBoxAllies(
  allyColors: Record<number, string>,
  startRects: Record<string, StartRect>,
) {
  const [pickedAlly, setPickedAlly] = useState<number | null>(null);

  const allySet = new Set<number>();
  for (const k of Object.keys(allyColors)) allySet.add(Number(k));
  for (const k of Object.keys(startRects)) allySet.add(Number(k));
  const sortedAllies = [...allySet].sort((a, b) => a - b);
  const allyList = sortedAllies.length > 0 ? sortedAllies : [0, 1];
  const activeAlly =
    pickedAlly ?? allyList.find((a) => !startRects[String(a)]) ?? allyList[0];

  return { allyList, activeAlly, pickAlly: setPickedAlly };
}

export function StartBoxControls({
  mapName,
  rects,
  allyList,
  allyColors,
  activeAlly,
  onPickAlly,
  onSetBox,
  onClearBox,
}: {
  mapName: string;
  /** The live rects, keyed by 0-based ally as string. */
  rects: Record<string, StartRect>;
  allyList: number[];
  allyColors: Record<number, string>;
  activeAlly: number;
  onPickAlly: (ally: number) => void;
  onSetBox: (ally: number, rect: StartRect) => void;
  onClearBox: (ally: number) => void;
}) {
  const hasBoxes = Object.keys(rects).length > 0;
  const clearAll = () => {
    for (const k of Object.keys(rects)) onClearBox(Number(k));
  };

  // How many times Swap has run. The ally order the presets assign by is derived
  // from it rather than stored, so a roster change can never leave a stale ally
  // in the order. Held here rather than in the popover because the button that
  // moves it sits out here, and both need the same answer: a swap that moved the
  // boxes but not the presets would be undone by the next preset click.
  const [swaps, setSwaps] = useState(0);
  let allyOrder = allyList;
  for (let i = 0; i < swaps % Math.max(allyList.length, 1); i++)
    allyOrder = rotateOrder(allyOrder);

  const boxHolders = allyList.filter((a) => rects[String(a)]).length;
  // Rotating only ever reassigns boxes that already exist, so it sends each
  // changed ally through onSetBox and clears nothing.
  const swapBoxes = () => {
    const next = rotateBoxes(rects, allyList);
    for (const [k, rect] of Object.entries(next)) {
      if (rect !== rects[k]) onSetBox(Number(k), rect);
    }
    setSwaps((n) => n + 1);
  };

  return (
    <div className="mt-2 space-y-2 border-t border-border/50 pt-2 text-xs">
      {/* The ally picker sits with the heading because it is the drawing tool,
          the thing you reach for before anything else here. The buttons below
          act on boxes that already exist, so they come second. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-semibold">Start boxes</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {allyList.map((a) => {
            const color = allyColors[a] ?? "#e5e7eb";
            const active = a === activeAlly;
            return (
              <button
                key={a}
                type="button"
                aria-pressed={active}
                onClick={() => onPickAlly(a)}
                className={`flex size-6 items-center justify-center rounded font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "ring-2 ring-foreground" : "opacity-70 hover:opacity-100"}`}
                style={{ background: color, color: readableText(color) }}
                title={`Draw ally ${allyLetter(a)}'s box${rects[String(a)] ? " (has one already)" : ""}`}
              >
                {allyLetter(a)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <StartBoxPresetsPopover
          mapName={mapName}
          rects={rects}
          allyOrder={allyOrder}
          allyColors={allyColors}
          onSetBox={onSetBox}
          onClearBox={onClearBox}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={boxHolders < 2}
          title={
            boxHolders < 2
              ? "Needs at least two allies with a box"
              : boxHolders === 2
                ? "Swap the two allies' boxes"
                : `Move each of the ${boxHolders} boxes on to the next ally`
          }
          onClick={swapBoxes}
        >
          <ArrowLeftRight className="size-3.5" />
          Swap
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasBoxes}
          onClick={clearAll}
        >
          Clear all
        </Button>
      </div>

      <p className="text-muted-foreground">
        Drag on the map to draw ally {allyLetter(activeAlly)}'s box. Drag a box
        to move it, its handles to resize, its cross to clear it.
      </p>
    </div>
  );
}
