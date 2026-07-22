import { Button } from "@picoframe/frame";
import { useState } from "react";
import type { StartRect } from "../bindings";
import { allyLetter, type MemberRow, readableText } from "./config";
import { StartBoxPresetsPopover } from "./StartBoxPresetsPopover";

/**
 * Host controls for editing start boxes: ally picker, clear buttons and the
 * split-preset popover. Lives under the start-position dropdown (shown only in
 * choose-in-game mode) while the drag editor itself stays on the minimap — so
 * the picked ally is owned by `useStartBoxAllies` on the page and shared
 * between the two.
 */

/**
 * Derive the battle's box-editing ally state: the allies to offer (roster's
 * allies plus any that already have a box, falling back to [0, 1]), each
 * ally's colour (its first player's), and the ally the next drawn box belongs
 * to (picked, else the lowest without a box).
 */
export function useStartBoxAllies(
  rows: MemberRow[],
  startRects: Record<string, StartRect>,
) {
  const [pickedAlly, setPickedAlly] = useState<number | null>(null);

  const players = rows
    .filter((r) => !r.spectator)
    .sort((a, b) => a.teamId - b.teamId);
  const allyColors: Record<number, string> = {};
  for (const r of players) {
    if (allyColors[r.ally] == null) allyColors[r.ally] = r.colorHex;
  }

  const allySet = new Set<number>();
  for (const k of Object.keys(allyColors)) allySet.add(Number(k));
  for (const k of Object.keys(startRects)) allySet.add(Number(k));
  const sortedAllies = [...allySet].sort((a, b) => a - b);
  const allyList = sortedAllies.length > 0 ? sortedAllies : [0, 1];
  const activeAlly =
    pickedAlly ?? allyList.find((a) => !startRects[String(a)]) ?? allyList[0];

  return { allyList, allyColors, activeAlly, pickAlly: setPickedAlly };
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
  /** The battle's live rects, keyed by 0-based ally as string. */
  rects: Record<string, StartRect>;
  allyList: number[];
  allyColors: Record<number, string>;
  activeAlly: number;
  onPickAlly: (ally: number) => void;
  onSetBox: (ally: number, rect: StartRect) => void;
  onClearBox: (ally: number) => void;
}) {
  const hasBoxes = Object.keys(rects).length > 0;
  const activeHasBox = !!rects[String(activeAlly)];
  const clearAll = () => {
    for (const k of Object.keys(rects)) onClearBox(Number(k));
  };

  return (
    <div className="mt-2 space-y-2 border-t border-border/50 pt-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">Start boxes</span>
        <div className="flex items-center gap-1">
          <StartBoxPresetsPopover
            mapName={mapName}
            rects={rects}
            allyList={allyList}
            onSetBox={onSetBox}
            onClearBox={onClearBox}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={!hasBoxes}
            onClick={clearAll}
          >
            Clear all
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground">
        Drag on the map to draw ally {allyLetter(activeAlly)}'s box; drag a box
        to move it, its handles to resize.
      </p>
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
              title={`Ally ${allyLetter(a)}${rects[String(a)] ? " (has box)" : ""}`}
            >
              {allyLetter(a)}
            </button>
          );
        })}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={!activeHasBox}
        onClick={() => onClearBox(activeAlly)}
      >
        Clear ally {allyLetter(activeAlly)}
      </Button>
    </div>
  );
}
