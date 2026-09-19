import { Button } from "@picoframe/frame";
import {
  ArrowLeft,
  Link as LinkIcon,
  Share2,
  Swords,
  Trash2,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";
import type { ConfigOption } from "@/content/bindings";
import type { MapThumbData } from "@/content/config";
import type { SkirmishDraft } from "../../drafts";
import { PresetLibraryToolbar } from "../../PresetLibraryToolbar";
import { PresetList } from "../../PresetList";
import { PresetPartsView } from "../../PresetPartsView";
import { PresetTweaksRow } from "../../PresetTweaksRow";
import { PresetTweaksView } from "../../PresetTweaksView";
import type { PresetSelection } from "../../presetParts";
import type { SkirmishPreset } from "../../presets";

/**
 * Right-hand slide-in sheet for managing singleplayer presets: browse saved
 * setups (minimap + auto-summary), save the current setup, and import a shared
 * preset. Built on the radix `Dialog` primitive styled as a side panel,
 * matching `MapPickerDrawer`.
 *
 * Clicking a preset switches the sheet to that preset's own panel rather than
 * loading it outright. Loading used to be a one-click overwrite of the whole
 * setup with no preview, and the panel is where choosing parts of it lives, so
 * the two problems have one answer. Hosting, exporting and copying a link moved
 * there too: they act on one preset, and the row had five icons competing for
 * the same few pixels with nothing to say which was which.
 */
export function PresetsDrawer({
  open,
  onOpenChange,
  presets,
  thumbs,
  currentGameName,
  modOptionsSchema,
  onApplyTweaks,
  onLoad,
  onSave,
  onDelete,
  onExportPreset,
  onCopyPresetLink,
  onImport,
  onSaveFromReplay,
  onBrowseHub,
  onHostAsBattle,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: SkirmishPreset[];
  thumbs: Map<string, MapThumbData>;
  /** The game the setup is on now, for the parts picker's cross-game check. */
  currentGameName: string;
  /** The game's declared options, for deciding whether it has tweak slots. */
  modOptionsSchema: ConfigOption[];
  /** Write a packed project's slots over whatever the options already say. */
  onApplyTweaks: (slots: Record<string, string>) => void;
  onLoad: (preset: SkirmishPreset, selection?: PresetSelection) => void;
  onSave: (name: string) => SkirmishPreset;
  onDelete: (id: string) => void;
  onExportPreset: (preset: SkirmishPreset) => void;
  /** Copy this preset as a `coilbox://import?code=` link (issue #498), an
   * addition alongside the file-export share action above, not a replacement. */
  onCopyPresetLink: (preset: SkirmishPreset) => void;
  onImport: () => void;
  /** "New preset from replay…" (#368): seed a preset from a decoded replay's
   * setup (every seated player becomes an AI opponent) without touching the
   * current Skirmish setup. */
  onSaveFromReplay: (name: string, draft: SkirmishDraft) => void;
  /** Open the hub, narrowed to presets. */
  onBrowseHub: () => void;
  /** "Host as battle" (#373): take this preset online without loading it into
   * the page first. Absent where hosting is impossible, which is what hides the
   * action on a Tachyon connection (see `docs/tachyon-protocol.md`). */
  onHostAsBattle?: (preset: SkirmishPreset) => void;
  disabled?: boolean;
}) {
  // Which preset's parts are on screen, if any. The drawer switches to them in
  // place rather than stacking a popover over itself.
  const [viewing, setViewing] = useState<SkirmishPreset | null>(null);
  // The unit tweak list, the sheet's third face alongside the list and a
  // preset's own panel.
  const [tweaksOpen, setTweaksOpen] = useState(false);

  const load = (preset: SkirmishPreset, selection?: PresetSelection) => {
    onLoad(preset, selection);
    setViewing(null);
    onOpenChange(false);
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        // Reopening lands on the list, not on whichever preset was last open.
        if (!next) {
          setViewing(null);
          setTweaksOpen(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
            {(viewing || tweaksOpen) && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setViewing(null);
                  setTweaksOpen(false);
                }}
                aria-label="Back to presets"
              >
                <ArrowLeft className="size-4" />
              </Button>
            )}
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-base font-semibold">
              {tweaksOpen ? "Unit tweaks" : (viewing?.name ?? "Presets")}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          {tweaksOpen ? (
            <PresetTweaksView
              gameName={currentGameName}
              modOptionsSchema={modOptionsSchema}
              disabled={disabled}
              onApply={(slots) => {
                onApplyTweaks(slots);
                setTweaksOpen(false);
                onOpenChange(false);
              }}
            />
          ) : viewing ? (
            <PresetPartsView
              // Fresh ticks per preset rather than the last one's.
              key={viewing.id}
              preset={viewing}
              currentGameName={currentGameName}
              verb="Load"
              disabled={disabled}
              onConfirm={(selection) => load(viewing, selection)}
              actions={
                <>
                  {/* The whole-preset actions, which moved off the list row:
                   * they act on this one preset and the row had five icons with
                   * no room to say which was which. */}
                  <div className="flex items-center gap-2">
                    {onHostAsBattle && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        disabled={disabled}
                        onClick={() => onHostAsBattle(viewing)}
                      >
                        <Swords className="size-4" /> Host as battle
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      disabled={disabled}
                      onClick={() => onExportPreset(viewing)}
                    >
                      <Share2 className="size-4" /> Export
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      disabled={disabled}
                      onClick={() => onCopyPresetLink(viewing)}
                    >
                      <LinkIcon className="size-4" /> Copy link
                    </Button>
                  </div>
                  {/* Set apart, because it is the one action here that cannot
                   * be undone. */}
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    disabled={disabled}
                    onClick={() => {
                      // Back to the list, since the preset this panel is about
                      // has just stopped existing.
                      onDelete(viewing.id);
                      setViewing(null);
                    }}
                  >
                    <Trash2 className="size-4" /> Delete preset
                  </Button>
                </>
              }
            />
          ) : (
            <>
              <PresetLibraryToolbar
                saveLabel="Save current setup"
                onSave={onSave}
                onImport={onImport}
                onSaveFromReplay={onSaveFromReplay}
                onBrowseHub={onBrowseHub}
                disabled={disabled}
              />

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <PresetTweaksRow
                  disabled={disabled}
                  onOpen={() => setTweaksOpen(true)}
                />
                <PresetList
                  presets={presets}
                  thumbs={thumbs}
                  disabled={disabled}
                  onOpen={setViewing}
                  empty="No presets yet. Save your current setup above, or import a shared one."
                />
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
