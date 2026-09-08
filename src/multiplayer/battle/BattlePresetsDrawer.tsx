import { Button, Input } from "@picoframe/frame";
import { Bookmark, Check, Star, Trash2, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";
import type { BattlePreset } from "./battlePresets";
import { DeliveryProgressPanel } from "./DeliveryProgressPanel";
import type { TweakDelivery } from "./useTweakDelivery";

/**
 * Right-hand slide-in sheet for managing hosting-option presets for the current
 * game: save the battle's current mod/map options + start-pos type under a name,
 * reload a saved preset, delete one, or mark one as the per-game default that's
 * applied automatically the next time this game is hosted. Only the presets for
 * this game are shown (a preset's options only make sense for its own game).
 *
 * Loading one into a battle we founded is a single batched script-tag write, so
 * the sheet closes the moment it is asked. Loading one into a SPADS battle is a
 * paced run of one `!bSet` per option (issue #2761), so the sheet stays open and
 * shows that run instead, with a Stop button and the reason for whichever option
 * did not land.
 */
export function BattlePresetsDrawer({
  open,
  onOpenChange,
  gameName,
  presets,
  defaultId,
  optionCount,
  onSave,
  onLoad,
  onDelete,
  onSetDefault,
  disabled,
  isFounder,
  delivery,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gameName: string;
  presets: BattlePreset[];
  /** Id of the preset currently set as this game's default, if any. */
  defaultId?: string;
  /** How many option tags the current battle has set (for the save button hint). */
  optionCount: number;
  onSave: (name: string) => void;
  onLoad: (preset: BattlePreset) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string | null) => void;
  disabled?: boolean;
  /** Whether we founded this battle, which decides whether a load is instant or
   *  a paced run to watch (see `delivery`). */
  isFounder: boolean;
  /** Progress of the load `onLoad` starts on a SPADS battle. */
  delivery: TweakDelivery;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const locked = disabled || delivery.running;

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

  const load = (preset: BattlePreset) => {
    onLoad(preset);
    // A founder's load is one batched write with nothing to watch, so the
    // sheet closes as it always did. An autohost's is paced over real seconds
    // (issue #2761), so it stays open on the run rather than looking closed
    // on a battle that is still catching up.
    if (isFounder) onOpenChange(false);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold">
                Option presets
              </DialogPrimitive.Title>
              <p className="truncate text-xs text-muted-foreground">
                {gameName}
              </p>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          {/* A load into a SPADS battle paces one `!bSet` at a time (issue
              #2761), so it is shown here rather than left to look finished the
              moment the sheet would otherwise have closed. */}
          {delivery.progress && (
            <div className="flex flex-col gap-2 border-b border-border/60 px-5 py-3">
              <DeliveryProgressPanel
                progress={delivery.progress}
                retryHint="This battle is left holding whatever landed. Loading the preset again finishes it: it skips whatever this battle already holds, so a second run only sends what is missing."
              />
              {delivery.running && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={delivery.cancel}
                  title="Stop before the next option. Whatever has already been set stays set."
                >
                  Stop
                </Button>
              )}
            </div>
          )}

          {/* Save the battle's current options as a named preset. */}
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNaming(true)}
                disabled={locked}
                className="flex-1"
              >
                <Bookmark className="size-4" /> Save current options (
                {optionCount})
              </Button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {presets.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No presets for this game yet. Set your options, then save them
                above.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {presets.map((p) => {
                  const isDefault = p.id === defaultId;
                  const count = Object.keys(p.scriptTags).length;
                  return (
                    <li key={p.id}>
                      <div className="group flex items-stretch gap-3 rounded-lg border border-border/50 bg-card transition-colors hover:border-border hover:bg-accent/40">
                        <button
                          type="button"
                          onClick={() => load(p)}
                          disabled={locked}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-l-lg p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <div className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {p.name}
                              {isDefault && (
                                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                  · default
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {count} option{count === 1 ? "" : "s"}
                            </span>
                          </div>
                        </button>
                        <div className="flex items-center gap-1 pr-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              onSetDefault(isDefault ? null : p.id)
                            }
                            disabled={locked}
                            aria-pressed={isDefault}
                            aria-label={
                              isDefault
                                ? `Unset ${p.name} as default for ${gameName}`
                                : `Set ${p.name} as default for ${gameName}`
                            }
                            title={
                              isDefault
                                ? "Default for this game — click to unset"
                                : "Set as default for this game"
                            }
                          >
                            <Star
                              className={`size-4 ${isDefault ? "fill-current text-amber-500" : ""}`}
                            />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onDelete(p.id)}
                            disabled={locked}
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
