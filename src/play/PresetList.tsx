import { Button } from "@picoframe/frame";
import { ChevronRight, Film, ImageOff, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { MapThumbData } from "@/content/config";
import type { ResultRecord } from "../records/bestResult";
import { presetRecordKey, recordSummary } from "./presetRecord";
import type { SkirmishPreset } from "./presets";

/** A short, derived summary of a preset: its map, game and opponent count. No
 * description is stored on a preset, so this is computed at render time. */
function describePreset(p: SkirmishPreset): string {
  const ai = p.participants.filter((x) => x.kind === "ai").length;
  return `${p.mapName} · ${p.gameName} · ${ai} AI opponent${ai === 1 ? "" : "s"}`;
}

/**
 * The list of saved skirmish presets, as a column of rows that open one.
 *
 * Shared by the Singleplayer sheet and the battle room's, so the two read the
 * same way: a minimap, the name, what it holds, and a chevron saying the row
 * goes somewhere. Every action that acts on one preset lives on the panel the
 * row opens, which is why the row carries nothing but the disclosure.
 */
export function PresetList({
  presets,
  thumbs,
  disabled,
  onOpen,
  empty,
  records,
  replayExists,
  onClearRecord,
}: {
  presets: SkirmishPreset[];
  thumbs: Map<string, MapThumbData>;
  disabled?: boolean;
  onOpen: (preset: SkirmishPreset) => void;
  /** What to say when there are none, which differs by surface. */
  empty: string;
  /** Best results by `presetRecordKey`. Absent where a surface shows none. */
  records?: Record<string, ResultRecord>;
  /** Whether a replay is still on disk. Without it no row links to a replay. */
  replayExists?: (filename: string) => boolean;
  /** Forget one preset's record. Absent hides the button. */
  onClearRecord?: (preset: SkirmishPreset) => void;
}) {
  if (presets.length === 0)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
    );

  return (
    <ul className="flex flex-col gap-2">
      {presets.map((p) => {
        const thumb = thumbs.get(p.mapName);
        const record = records?.[presetRecordKey(p)];
        const bestReplay = record?.best?.replayFilename;
        return (
          <li key={p.id}>
            <div className="group flex items-stretch rounded-lg border border-border/50 bg-card transition-colors hover:border-border hover:bg-accent/40">
              <button
                type="button"
                onClick={() => onOpen(p)}
                disabled={disabled}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 pr-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
                  {thumb ? (
                    <img
                      src={thumb.url}
                      alt={`Minimap of ${p.mapName}`}
                      style={{
                        // unitsync thumbnails are square, so stretch back to
                        // the map's real proportions, letterboxed by fixing
                        // the longer axis to 100%.
                        aspectRatio:
                          thumb.width && thumb.height
                            ? `${thumb.width} / ${thumb.height}`
                            : "1 / 1",
                        width:
                          !thumb.width ||
                          !thumb.height ||
                          thumb.width >= thumb.height
                            ? "100%"
                            : "auto",
                        height:
                          !thumb.width ||
                          !thumb.height ||
                          thumb.width >= thumb.height
                            ? "auto"
                            : "100%",
                      }}
                      className="object-fill"
                    />
                  ) : (
                    <ImageOff className="size-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {p.name}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {describePreset(p)}
                  </span>
                  {record && (
                    <span className="mt-0.5 block truncate text-xs text-foreground/80">
                      {recordSummary(record)}
                    </span>
                  )}
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
              {record && (
                <div className="flex shrink-0 items-center gap-1 pr-2">
                  {bestReplay && replayExists?.(bestReplay) && (
                    <Link
                      to={`/play/replays/${encodeURIComponent(bestReplay)}`}
                      aria-label={`Watch the best replay for ${p.name}`}
                      className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <Film className="size-4" />
                    </Link>
                  )}
                  {onClearRecord && (
                    <ClearRecordButton
                      preset={p}
                      record={record}
                      disabled={disabled}
                      onClear={onClearRecord}
                    />
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Clearing is one way, so it asks first, in a popover beside the button. */
function ClearRecordButton({
  preset,
  record,
  disabled,
  onClear,
}: {
  preset: SkirmishPreset;
  record: ResultRecord;
  disabled?: boolean;
  onClear: (preset: SkirmishPreset) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={`Clear the record for ${preset.name}`}
        >
          <RotateCcw className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            Clear the record for "{preset.name}"? That forgets {record.attempts}{" "}
            {record.attempts === 1 ? "attempt" : "attempts"}
            {record.best ? " and the best time" : ""}. Your replays stay.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setOpen(false);
                onClear(preset);
              }}
            >
              Clear record
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
