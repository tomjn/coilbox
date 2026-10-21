import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { LayoutGrid, X } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { allyLetter } from "@/lib/allyDisplay";
import { allyPaletteColor } from "@/lib/allyPalette";
import { GRID, type StartRect } from "./geometry";
import {
  nextSlotStart,
  PRESETS,
  type PresetKind,
  presetBoxes,
  slotWindow,
} from "./presets";
import {
  addMapLayout,
  type LayoutBoxes,
  layoutAlreadySaved,
  removeMapLayout,
  useSavedStartBoxes,
} from "./saved";

/** Neutral fill for a slot the roster is not big enough to take. */
const UNUSED_FILL = "fill-foreground/15";

/**
 * A layout as a small square, drawn from the same rects applying uses so the
 * tile is a true preview rather than an illustration of one. Each box carries
 * the colour of the ally it would go to, and a slot nobody would get is left
 * neutral.
 */
function BoxPreview({
  boxes,
}: {
  boxes: { rect: StartRect; color?: string }[];
}) {
  return (
    <svg
      viewBox={`0 0 ${GRID} ${GRID}`}
      className="size-9 rounded-sm bg-muted"
      aria-hidden="true"
    >
      {boxes.map(({ rect, color }) => (
        <rect
          // Slot positions are unique within a layout.
          key={`${rect.left},${rect.top}`}
          x={rect.left}
          y={rect.top}
          width={rect.right - rect.left}
          height={rect.bottom - rect.top}
          fill={color}
          className={color ? undefined : UNUSED_FILL}
        />
      ))}
    </svg>
  );
}

/** The tile chrome both tabs' buttons wear, so the two grids read as one thing. */
const TILE =
  "flex w-full flex-col items-center gap-1 rounded-md border border-border/50 p-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Start-box layouts (issue #334), behind a button in the "Start boxes" panel so
 * the extra controls don't crowd the space under the minimap. Two tabs, because
 * they answer different questions: "Presets" is the built-in splits, the same on
 * every map, and "This map" is what you kept for this one.
 *
 * Every tile previews what it will do in the roster's own colours, because the
 * question is always "who ends up where" and a monochrome diagram cannot answer
 * it. Two things move that answer without redrawing anything by hand. The size
 * slider sets how deep the built-in splits cut. Clicking an applied preset again
 * moves its slot window on, so "4 sides" with two allies can give north/south
 * and not only west/east. The third, Swap, lives out in the panel beside the
 * button that opens this, and reaches the tiles as `allyOrder`.
 *
 * Everything applies through the existing `onSetBox`/`onClearBox` send path
 * (ADDSTARTRECT / `!addbox`).
 */
export function StartBoxPresetsPopover({
  mapName,
  rects,
  allyOrder,
  onSetBox,
  onClearBox,
}: {
  mapName: string;
  /** The live rects, keyed by 0-based ally as string. */
  rects: Record<string, StartRect>;
  /**
   * Allies in the battle (0-based), in the order a preset hands its slots out.
   * The roster's own order until Swap rotates it, so a swap survives into the
   * next preset applied rather than being undone by it.
   */
  allyOrder: number[];
  onSetBox: (ally: number, rect: StartRect) => void;
  onClearBox: (ally: number) => void;
}) {
  const { t, i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [sizePct, setSizePct] = useState(30);
  const [saved, setSaved] = useSavedStartBoxes();
  const savedForMap = saved[mapName] ?? [];

  // Which slots the last-applied preset is using, so clicking it again advances.
  const [slotStart, setSlotStart] = useState<{
    kind: PresetKind;
    start: number;
  } | null>(null);
  const startFor = (kind: PresetKind) =>
    slotStart?.kind === kind ? slotStart.start : 0;

  // Replace the whole layout: assign the given boxes to allies, then clear
  // boxes belonging to allies the layout doesn't cover.
  const applyBoxes = (boxes: LayoutBoxes) => {
    for (const [k, rect] of Object.entries(boxes)) onSetBox(Number(k), rect);
    for (const k of Object.keys(rects)) {
      if (!(k in boxes)) onClearBox(Number(k));
    }
  };

  const applyPreset = (kind: PresetKind, slotCount: number) => {
    const start = startFor(kind);
    const slots = presetBoxes(kind, sizePct);
    const layout: LayoutBoxes = {};
    slotWindow(slots.length, allyOrder.length, start).forEach((slot, i) => {
      layout[String(allyOrder[i])] = slots[slot];
    });
    applyBoxes(layout);
    setSlotStart({
      kind,
      start: nextSlotStart(slotCount, allyOrder.length, start),
    });
  };

  const applyTitle = (number: number, boxes: LayoutBoxes) => {
    const allies = Object.keys(boxes)
      .map((a) => {
        const letter = allyLetter(Number(a));
        return t`ally ${letter}`;
      })
      .join(", ");
    return t`Apply saved layout ${number}: ${allies}`;
  };
  const deleteTitle = (number: number) => t`Delete saved layout ${number}`;

  const hasBoxes = Object.keys(rects).length > 0;
  const alreadySaved = layoutAlreadySaved(saved, mapName, rects);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <LayoutGrid className="size-3.5" />
          <Trans>Box presets</Trans>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3 text-xs">
        <Tabs defaultValue="presets">
          <TabsList className="w-full">
            <TabsTrigger value="presets">
              <Trans>Presets</Trans>
            </TabsTrigger>
            <TabsTrigger value="map">
              {savedForMap.length > 0 ? (
                <Trans>This map ({savedForMap.length})</Trans>
              ) : (
                <Trans>This map</Trans>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="presets" className="mt-3 space-y-3">
            <div className="grid grid-cols-3 gap-1.5">
              {PRESETS.map((p) => {
                const slots = presetBoxes(p.kind, sizePct);
                const start = startFor(p.kind);
                const window = slotWindow(
                  slots.length,
                  allyOrder.length,
                  start,
                );
                const spare = slots.length > allyOrder.length;
                const presetLabel = i18n._(p.label);
                const shownBoxes = window.length;
                const totalBoxes = slots.length;
                const allyCount = allyOrder.length;
                return (
                  <button
                    key={p.kind}
                    type="button"
                    onClick={() => applyPreset(p.kind, slots.length)}
                    className={TILE}
                    title={
                      spare
                        ? t`${presetLabel}: ${shownBoxes} of ${totalBoxes} boxes for your ${allyCount} allies. Click again for the next set.`
                        : presetLabel
                    }
                  >
                    <BoxPreview
                      boxes={slots.map((rect, slot) => {
                        const at = window.indexOf(slot);
                        return {
                          rect,
                          color:
                            at === -1
                              ? undefined
                              : allyPaletteColor(allyOrder[at]),
                        };
                      })}
                    />
                    <span className="text-[10px] leading-none">
                      {presetLabel}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="startbox-size"
                  className="text-muted-foreground"
                >
                  <Trans>Box size</Trans>
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
          </TabsContent>

          <TabsContent value="map" className="mt-3 space-y-3">
            {savedForMap.length === 0 ? (
              <p className="text-muted-foreground">
                <Trans>
                  Nothing saved for this map yet. Draw a layout and keep it
                  here.
                </Trans>
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {savedForMap.map((layout, i) => (
                  // The tile is a plain box holding two buttons rather than a
                  // button holding one: apply is the whole tile, and delete is a
                  // separate control sitting on top of it.
                  <div key={layout.id} className="relative">
                    <button
                      type="button"
                      onClick={() => applyBoxes(layout.boxes)}
                      className={TILE}
                      title={applyTitle(i + 1, layout.boxes)}
                    >
                      <BoxPreview
                        boxes={Object.entries(layout.boxes).map(
                          ([ally, rect]) => ({
                            rect,
                            color: allyPaletteColor(Number(ally)),
                          }),
                        )}
                      />
                      <span className="text-[10px] leading-none">
                        <Trans>Saved {i + 1}</Trans>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={deleteTitle(i + 1)}
                      title={deleteTitle(i + 1)}
                      onClick={() =>
                        setSaved(removeMapLayout(saved, mapName, layout.id))
                      }
                      className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-destructive hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={!hasBoxes || alreadySaved}
              title={
                !hasBoxes
                  ? t`Draw some boxes first`
                  : alreadySaved
                    ? t`These boxes are already saved for ${mapName}`
                    : t`Save these boxes for ${mapName}`
              }
              onClick={() => setSaved(addMapLayout(saved, mapName, rects))}
            >
              {alreadySaved ? t`Already saved` : t`Save current boxes`}
            </Button>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
