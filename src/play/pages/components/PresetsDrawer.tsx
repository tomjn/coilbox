import { Button, Input } from "@picoframe/frame";
import { Check, ImageOff, Save, Share2, Trash2, Upload, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";
import type { MapThumbData } from "@/content/config";
import type { SkirmishDraft } from "../../drafts";
import type { SkirmishPreset } from "../../presets";
import { NewPresetFromReplayButton } from "./NewPresetFromReplayButton";

/** A short, derived summary of a preset — its map, game and opponent count. No
 * description is stored on a preset, so this is computed at render time. */
function describePreset(p: SkirmishPreset): string {
  const ai = p.participants.filter((x) => x.kind === "ai").length;
  return `${p.mapName} · ${p.gameName} · ${ai} AI opponent${ai === 1 ? "" : "s"}`;
}

/**
 * Right-hand slide-in sheet for managing singleplayer presets: browse saved
 * setups (minimap + auto-summary), load one by clicking it, delete or share
 * (export to file) individual presets, save the current setup, and import a
 * shared preset. Built on the radix `Dialog` primitive styled as a side panel,
 * matching `MapPickerDrawer`.
 */
export function PresetsDrawer({
  open,
  onOpenChange,
  presets,
  thumbs,
  onLoad,
  onSave,
  onDelete,
  onExportPreset,
  onImport,
  onSaveFromReplay,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: SkirmishPreset[];
  thumbs: Map<string, MapThumbData>;
  onLoad: (preset: SkirmishPreset) => void;
  onSave: (name: string) => SkirmishPreset;
  onDelete: (id: string) => void;
  onExportPreset: (preset: SkirmishPreset) => void;
  onImport: () => void;
  /** "New preset from replay…" (#368): seed a preset from a decoded replay's
   * setup (every seated player becomes an AI opponent) without touching the
   * current Skirmish setup. */
  onSaveFromReplay: (name: string, draft: SkirmishDraft) => void;
  disabled?: boolean;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const commitSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName("");
    setNaming(false);
  };
  const cancelSave = () => {
    setName("");
    setNaming(false);
  };

  const load = (preset: SkirmishPreset) => {
    onLoad(preset);
    onOpenChange(false);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              Presets
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          {/* Save the current setup / import a shared one. */}
          <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3">
            {naming ? (
              <>
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitSave();
                    if (e.key === "Escape") cancelSave();
                  }}
                  placeholder="Preset name"
                  className="h-8 flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={commitSave}
                  disabled={!name.trim()}
                  aria-label="Save preset"
                >
                  <Check className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={cancelSave}
                  aria-label="Cancel"
                >
                  <X className="size-4" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setNaming(true)}
                  disabled={disabled}
                  className="flex-1"
                >
                  <Save className="size-4" /> Save current setup
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onImport}
                  disabled={disabled}
                >
                  <Upload className="size-4" /> Import
                </Button>
              </>
            )}
          </div>

          {/* Seed a preset from a decoded replay's setup, the other end of the
           * refight pipeline from the replay detail page's "Refight this setup". */}
          <div className="flex items-center border-b border-border/60 px-5 py-3">
            <NewPresetFromReplayButton
              onSave={onSaveFromReplay}
              disabled={disabled}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {presets.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No presets yet. Save your current setup above, or import a
                shared one.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {presets.map((p) => {
                  const thumb = thumbs.get(p.mapName);
                  return (
                    <li key={p.id}>
                      <div className="group flex items-stretch gap-3 rounded-lg border border-border/50 bg-card transition-colors hover:border-border hover:bg-accent/40">
                        <button
                          type="button"
                          onClick={() => load(p)}
                          disabled={disabled}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-l-lg p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
                            {thumb ? (
                              <img
                                src={thumb.dataUrl}
                                alt={`Minimap of ${p.mapName}`}
                                style={{
                                  // unitsync thumbnails are square; stretch back
                                  // to the map's real proportions, letterboxed by
                                  // fixing the longer axis to 100%.
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
                          <div className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {p.name}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {describePreset(p)}
                            </span>
                          </div>
                        </button>
                        <div className="flex items-center gap-1 pr-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onExportPreset(p)}
                            disabled={disabled}
                            aria-label={`Share preset ${p.name}`}
                          >
                            <Share2 className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onDelete(p.id)}
                            disabled={disabled}
                            aria-label={`Delete preset ${p.name}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
