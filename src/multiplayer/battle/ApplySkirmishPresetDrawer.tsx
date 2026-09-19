import { Button } from "@picoframe/frame";
import { ArrowLeft, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";
import type { ConfigOption } from "@/content/bindings";
import { useUnitsyncMapInfo, useUnitsyncThumbnails } from "@/content/config";
import type { SkirmishDraft } from "@/play/drafts";
import { PresetLibraryToolbar } from "@/play/PresetLibraryToolbar";
import { PresetList } from "@/play/PresetList";
import { PresetPartsView } from "@/play/PresetPartsView";
import { PresetTweaksRow } from "@/play/PresetTweaksRow";
import { PresetTweaksView, usePresetTweaks } from "@/play/PresetTweaksView";
import type { PresetSelection } from "@/play/presetParts";
import type { SkirmishPreset } from "@/play/presets";
import { hexToI32 } from "./config";
import { DeliveryProgressPanel } from "./DeliveryProgressPanel";
import type { TweakDelivery } from "./useTweakDelivery";

/**
 * Applying parts of a saved skirmish preset to the CURRENT battle room
 * (issue #373).
 *
 * The same sheet as Singleplayer's, deliberately: a list of presets, and a
 * panel per preset with the parts to take. This was a 288px popover that showed
 * the parts in place with no way back, which read as a different feature rather
 * than the same one in another room.
 *
 * Applying never touches another seated human. It moves your own seat, the
 * map, options, start boxes and bots, and that is all.
 *
 * It is not for a room we run ourselves only. Every step has an autohost route
 * as well, so on a bot-hosted room each one goes out as a command and the bot
 * decides whether we were allowed to ask. Restricting it to self-hosted rooms
 * left the common case, somebody in a SPADS room, with no way to apply a preset
 * at all.
 *
 * Presets for other games are listed rather than filtered out. The room cannot
 * change game, so `game` is not on offer and the game-keyed parts block
 * themselves, but a preset's map, boxes and roster are worth having whatever
 * game it was saved under. Filtering on an exact game name (version and all)
 * left the list empty far more often than it saved anyone from a bad apply.
 */
export function ApplySkirmishPresetDrawer({
  open,
  onOpenChange,
  presets,
  gameName,
  enginePath,
  dataDir,
  disabled,
  canEditRestrictions,
  modOptionsSchema,
  onApplyTweaks,
  selfHost = true,
  delivery,
  onApply,
  saveLabel,
  onSave,
  onImport,
  onSaveFromReplay,
  onBrowseHub,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: SkirmishPreset[];
  /** The game this room is running, for the cross-game block. */
  gameName: string;
  enginePath?: string;
  dataDir?: string;
  disabled?: boolean;
  /** Whether unit restrictions can be written here at all. They are
   *  `game/restrict/*` script tags with no autohost path, so on a bot-hosted
   *  room the row says so rather than silently doing nothing. */
  canEditRestrictions?: boolean;
  /** The game's declared options, for deciding whether it has tweak slots. */
  modOptionsSchema: ConfigOption[];
  /** Send a packed project's slots over whatever the room's options say. */
  onApplyTweaks: (slots: Record<string, string>) => void;
  /**
   * Whether we run the game ourselves rather than a bot doing it.
   *
   * Decides two things. The map goes out as `UPDATEBATTLEINFO` with a checksum
   * when we host and as `!map <name>` when a bot does, so only the first waits
   * on unitsync to read one. And a bot-hosted apply is a paced run over real
   * seconds, so the sheet stays open to show it rather than closing on a run
   * that has barely started.
   */
  selfHost?: boolean;
  /** Progress of that paced run, for the sheet to show. Absent where there is
   *  no paced run to watch. */
  delivery?: TweakDelivery;
  onApply: (
    preset: SkirmishPreset,
    maphash: number,
    selection: PresetSelection,
  ) => void;
  /** What the save button says, e.g. "Save this battle". */
  saveLabel: string;
  onSave: (name: string) => void;
  onImport: () => void;
  onSaveFromReplay: (name: string, draft: SkirmishDraft) => void;
  onBrowseHub: () => void;
}) {
  const [viewing, setViewing] = useState<SkirmishPreset | null>(null);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  // Read here as well as in the panel, so the row says up front when there is
  // nothing behind it rather than opening onto an explanation.
  const tweaks = usePresetTweaks(gameName, modOptionsSchema, false);
  const { thumbs } = useUnitsyncThumbnails(enginePath, dataDir);
  const mapInfo = useUnitsyncMapInfo(
    enginePath,
    dataDir,
    selfHost ? viewing?.mapName : undefined,
  );
  const maphash = hexToI32(mapInfo.info?.checksum);

  const close = () => {
    setViewing(null);
    setTweaksOpen(false);
    onOpenChange(false);
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
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
              gameName={gameName}
              modOptionsSchema={modOptionsSchema}
              disabled={disabled}
              onApply={(slots) => {
                onApplyTweaks(slots);
                close();
              }}
            />
          ) : viewing ? (
            <PresetPartsView
              key={viewing.id}
              preset={viewing}
              currentGameName={gameName}
              verb="Apply"
              // The room is already on a game and cannot be moved off it.
              omit={["game"]}
              extraDisabledReasons={
                canEditRestrictions === false
                  ? {
                      restrictions:
                        "The host owns these. There is no autohost command.",
                    }
                  : {}
              }
              // Only the map needs unitsync to read a checksum, so the wait is
              // announced rather than the button just sitting dead.
              blockedLabel={
                selfHost && mapInfo.status === "loading" ? "Reading map…" : null
              }
              disabled={disabled}
              onConfirm={(selection) => {
                onApply(viewing, maphash, selection);
                // A bot-hosted apply is one `!bSet` at a time over real
                // seconds, so closing here would hide the whole of it.
                if (selfHost) close();
              }}
              progress={
                !selfHost && delivery?.progress ? (
                  <DeliveryProgressPanel
                    progress={delivery.progress}
                    retryHint="Applying again sends only the options that did not land."
                  />
                ) : null
              }
            />
          ) : (
            <>
              <PresetLibraryToolbar
                saveLabel={saveLabel}
                onSave={onSave}
                onImport={onImport}
                onSaveFromReplay={onSaveFromReplay}
                onBrowseHub={onBrowseHub}
                disabled={disabled}
              />
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <PresetTweaksRow
                  disabled={disabled}
                  unavailable={tweaks.unavailable}
                  onOpen={() => setTweaksOpen(true)}
                />
                <PresetList
                  presets={presets}
                  thumbs={thumbs}
                  disabled={disabled}
                  onOpen={setViewing}
                  empty="No skirmish presets saved yet. Save one from Singleplayer."
                />
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
