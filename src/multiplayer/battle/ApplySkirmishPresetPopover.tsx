import { Button } from "@picoframe/frame";
import { Check } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUnitsyncMapInfo } from "@/content/config";
import { PresetPartsPicker } from "@/play/PresetPartsPicker";
import {
  ALL_PARTS,
  PRESET_PARTS,
  type PresetPart,
  type PresetSelection,
  partSummary,
} from "@/play/presetParts";
import type { SkirmishPreset } from "@/play/presets";
import { hexToI32 } from "./config";

/**
 * Host-only: apply a saved skirmish preset to the CURRENT battle room in
 * place (issue #373). Only presets for this battle's game are offered (an
 * option/start-pos mismatch on a different game would be meaningless),
 * mirroring how `BattlePresetsDrawer` already scopes its own presets to the
 * current game. Applying never touches another seated human: it moves the
 * host's own seat, the map, options, start boxes and bots, that's all.
 */
export function ApplySkirmishPresetPopover({
  presets,
  enginePath,
  dataDir,
  disabled,
  canEditRestrictions,
  onApply,
}: {
  presets: SkirmishPreset[];
  enginePath?: string;
  dataDir?: string;
  disabled?: boolean;
  /** Whether unit restrictions can be written here at all. They are
   *  `game/restrict/*` script tags with no autohost path, so on a bot-hosted
   *  room the row says so rather than silently doing nothing. */
  canEditRestrictions?: boolean;
  onApply: (
    preset: SkirmishPreset,
    maphash: number,
    selection: PresetSelection,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SkirmishPreset | null>(null);
  // The room only ever offers presets for the game it is already running, so
  // there is never a game to change.
  const [selection, setSelection] = useState<PresetSelection>({
    ...ALL_PARTS,
    parts: PRESET_PARTS.filter((p) => p !== "game"),
  });
  const mapInfo = useUnitsyncMapInfo(enginePath, dataDir, selected?.mapName);
  const maphash = hexToI32(mapInfo.info?.checksum);

  const disabledReasons: Partial<Record<PresetPart, string>> =
    canEditRestrictions === false
      ? { restrictions: "The host owns these. There is no autohost command." }
      : {};

  const effective: PresetSelection = {
    ...selection,
    parts: selection.parts.filter(
      (part) =>
        disabledReasons[part] === undefined &&
        selected !== null &&
        partSummary(selected, part) !== null,
    ),
  };

  const takingMap = effective.parts.includes("map");
  const warnings: Partial<Record<PresetPart, string>> =
    effective.parts.includes("startPositions") && !takingMap
      ? {
          startPositions: `These boxes were drawn for ${selected?.mapName}, not this room's map.`,
        }
      : {};

  // Only the map needs the checksum, so nothing else waits on unitsync reading
  // it. Gating everything on it meant a preset's options could not be applied
  // without owning its map, which is when taking only the options is most
  // useful.
  const ready =
    !!selected &&
    effective.parts.length > 0 &&
    (!takingMap || mapInfo.status === "ready");

  const apply = () => {
    if (!selected || !ready) return;
    onApply(selected, maphash, effective);
    setOpen(false);
    setSelected(null);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSelected(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={disabled}
        >
          Apply skirmish preset
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2 p-3 text-xs">
        {presets.length === 0 ? (
          <p className="text-muted-foreground">
            No skirmish presets saved for this game yet. Save one from
            Singleplayer.
          </p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {presets.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelected(p)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left hover:bg-accent ${
                    selected?.id === p.id
                      ? "border-primary bg-accent"
                      : "border-border/50"
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  {selected?.id === p.id && (
                    <Check className="size-3.5 shrink-0" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <>
            <p className="text-muted-foreground">
              Seated players are left alone whatever you pick.
            </p>
            <PresetPartsPicker
              preset={selected}
              selection={effective}
              onChange={setSelection}
              omit={["game"]}
              disabledReasons={disabledReasons}
              warnings={warnings}
            />
          </>
        )}
        <Button
          size="sm"
          className="w-full"
          disabled={!selected || !ready}
          onClick={apply}
        >
          {selected && takingMap && mapInfo.status === "loading"
            ? "Reading map…"
            : "Apply to this room"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
