import { Button } from "@picoframe/frame";
import { LayoutGrid } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import type { StartRect } from "../bindings";
import { GRID } from "./startBoxGeometry";
import { PRESETS, type PresetKind, presetBoxes } from "./startBoxPresets";
import { saveMapBoxes, useSavedStartBoxes } from "./startBoxSaved";

/**
 * Start-box split presets + per-map save/restore (issue #334), tucked behind a
 * button in the "Start boxes" panel so the extra controls don't crowd the
 * space under the minimap. Each preset button previews its own geometry (an
 * SVG drawn from the same `presetBoxes` call that applying uses), live-updated
 * by the size slider. Applying assigns the pattern's slots to the roster's
 * allies in order and clears any other ally's box, all through the existing
 * `onSetBox`/`onClearBox` send path (ADDSTARTRECT / `!addbox`).
 */
export function StartBoxPresetsPopover({
  mapName,
  rects,
  allyList,
  onSetBox,
  onClearBox,
}: {
  mapName: string;
  /** The battle's live rects, keyed by 0-based ally as string. */
  rects: Record<string, StartRect>;
  /** Allies in the battle (0-based), lowest first. */
  allyList: number[];
  onSetBox: (ally: number, rect: StartRect) => void;
  onClearBox: (ally: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sizePct, setSizePct] = useState(30);
  const [saved, setSaved] = useSavedStartBoxes();
  const savedForMap = saved[mapName];

  // Replace the whole layout: assign the given boxes to allies in order, then
  // clear boxes belonging to allies the layout doesn't cover.
  const applyBoxes = (boxes: Record<string, StartRect>) => {
    for (const [k, rect] of Object.entries(boxes)) onSetBox(Number(k), rect);
    for (const k of Object.keys(rects)) {
      if (!(k in boxes)) onClearBox(Number(k));
    }
  };

  const applyPreset = (kind: PresetKind) => {
    const slots = presetBoxes(kind, sizePct);
    const layout: Record<string, StartRect> = {};
    allyList.slice(0, slots.length).forEach((ally, i) => {
      layout[String(ally)] = slots[i];
    });
    applyBoxes(layout);
  };

  const hasBoxes = Object.keys(rects).length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <LayoutGrid className="size-3.5" />
          Presets
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3 p-3 text-xs">
        <div className="grid grid-cols-3 gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.kind}
              type="button"
              onClick={() => applyPreset(p.kind)}
              className="flex flex-col items-center gap-1 rounded-md border border-border/50 p-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={
                p.slots > allyList.length
                  ? `${p.label}: first ${allyList.length} of ${p.slots} boxes (add more allies for the rest)`
                  : p.label
              }
            >
              <svg
                viewBox={`0 0 ${GRID} ${GRID}`}
                className="size-9 rounded-sm bg-muted"
                aria-hidden="true"
              >
                {presetBoxes(p.kind, sizePct).map((b, i) => (
                  <rect
                    // Slot positions are unique within a preset.
                    key={`${b.left},${b.top}`}
                    x={b.left}
                    y={b.top}
                    width={b.right - b.left}
                    height={b.bottom - b.top}
                    className={
                      i < allyList.length
                        ? "fill-foreground/60"
                        : "fill-foreground/20"
                    }
                  />
                ))}
              </svg>
              <span className="text-[10px] leading-none">{p.label}</span>
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="startbox-size" className="text-muted-foreground">
              Box size
            </label>
            <span className="tabular-nums">{sizePct}%</span>
          </div>
          <Slider
            id="startbox-size"
            min={10}
            max={50}
            step={1}
            value={[sizePct]}
            onValueChange={([v]) => setSizePct(v)}
          />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!hasBoxes}
            title={`Save the current boxes for ${mapName}`}
            onClick={() => setSaved(saveMapBoxes(saved, mapName, rects))}
          >
            Save for map
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!savedForMap}
            title={
              savedForMap
                ? `Restore the boxes saved for ${mapName}`
                : "No boxes saved for this map yet"
            }
            onClick={() => savedForMap && applyBoxes(savedForMap)}
          >
            Load saved
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
