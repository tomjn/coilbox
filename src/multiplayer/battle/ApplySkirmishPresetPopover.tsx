import { Button } from "@picoframe/frame";
import { Check } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUnitsyncMapInfo } from "@/content/config";
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
  onApply,
}: {
  presets: SkirmishPreset[];
  enginePath?: string;
  dataDir?: string;
  disabled?: boolean;
  onApply: (preset: SkirmishPreset, maphash: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SkirmishPreset | null>(null);
  const mapInfo = useUnitsyncMapInfo(enginePath, dataDir, selected?.mapName);
  const maphash = hexToI32(mapInfo.info?.checksum);
  const ready = !!selected && mapInfo.status === "ready";

  const apply = () => {
    if (!selected || !ready) return;
    onApply(selected, maphash);
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
          <p className="text-muted-foreground">
            Applies {selected.mapName}, its options, start boxes and bots.
            Seated players are left alone.
          </p>
        )}
        <Button
          size="sm"
          className="w-full"
          disabled={!selected || !ready}
          onClick={apply}
        >
          {selected && mapInfo.status === "loading"
            ? "Reading map…"
            : "Apply to this room"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
