/**
 * A reference for the keyboard shortcuts scattered across the builder as
 * three tooltips and nothing else. The list is generated from `SHORTCUTS`
 * rather than typed out here by hand, so a new shortcut cannot land in a
 * handler without this sheet knowing about it.
 */

import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { useEffect, useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type CameraMove,
  type NavigationControl,
  type NavigationPreset,
  navigationControls,
} from "../../cameraNavigation";
import { useNavigationPreset } from "../../cameraNavigationStore";
import {
  applyOverrides,
  captureKey,
  findConflict,
  isRebindable,
} from "../../shortcutOverrides";
import {
  getShortcutOverrides,
  setShortcutOverrides,
  useShortcutOverrides,
} from "../../shortcutOverridesStore";
import {
  comboLabel,
  isMac,
  SHORTCUTS,
  type ShortcutGroup,
} from "../../shortcuts";

const GROUP_ORDER: ShortcutGroup[] = ["Transform", "View", "Edit", "Help"];

function groupLabel(group: ShortcutGroup): string {
  if (group === "Transform") return t`Transform`;
  if (group === "View") return t`View`;
  if (group === "Edit") return t`Edit`;
  return t`Help`;
}

function moveLabel(move: CameraMove): string {
  if (move === "orbit") return t`Orbit`;
  if (move === "pan") return t`Pan`;
  return t`Zoom`;
}

function buttonLabel(button: NavigationControl["button"]): string {
  if (button === "left") return t`Left drag`;
  if (button === "middle") return t`Middle drag`;
  if (button === "right") return t`Right drag`;
  return t`Wheel`;
}

function keyLabel(key: "ctrl" | "shift" | "alt"): string {
  if (key === "ctrl") return "Ctrl";
  if (key === "shift") return "Shift";
  return "Alt";
}

/** What to press for a mouse control, e.g. "Shift + Middle drag". */
export function navigationLabel(control: NavigationControl): string {
  return [...control.keys.map(keyLabel), buttonLabel(control.button)].join(
    " + ",
  );
}

function presetLabel(preset: NavigationPreset): string {
  if (preset === "blender") return "Blender";
  if (preset === "3dsmax") return "3ds Max";
  return t`Coilbox`;
}

const PRESETS: NavigationPreset[] = ["coilbox", "blender", "3dsmax"];

export function ShortcutSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mac = isMac();
  const [preset, setPreset] = useNavigationPreset();
  const overrides = useShortcutOverrides();
  const shortcuts = applyOverrides(SHORTCUTS, overrides);
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCapturingId(null);
      setRefusal(null);
    }
  }, [open]);

  useEffect(() => {
    if (capturingId === null) return;
    const id = capturingId;
    function onKeyDown(event: KeyboardEvent) {
      // Keep the key from reaching the dialog and the editor's own handlers.
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCapturingId(null);
        setRefusal(null);
        return;
      }
      const captured = captureKey(event);
      if (captured.kind === "modifier") {
        setRefusal(t`Press a key together with the modifier`);
        return;
      }
      const clash = findConflict(
        applyOverrides(SHORTCUTS, getShortcutOverrides()),
        id,
        captured.combo,
      );
      if (clash) {
        const used = comboLabel(captured.combo, mac);
        const name = clash.description;
        setRefusal(t`${used} is already used to: ${name}`);
        return;
      }
      setShortcutOverrides({ ...getShortcutOverrides(), [id]: captured.combo });
      setCapturingId(null);
      setRefusal(null);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturingId, mac]);

  function resetOne(id: string) {
    const { [id]: _removed, ...rest } = getShortcutOverrides();
    setShortcutOverrides(rest);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" closeLabel={t`Close`}>
        <DialogHeader>
          <DialogTitle>
            <Trans>Keyboard shortcuts</Trans>
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {GROUP_ORDER.map((group) => (
            <div key={group}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {groupLabel(group)}
              </h3>
              <ul className="mt-1 flex flex-col gap-1">
                {shortcuts
                  .filter((shortcut) => shortcut.group === group)
                  .map((shortcut) => {
                    const description = shortcut.description;
                    const capturing = capturingId === shortcut.id;
                    return (
                      <li key={shortcut.id}>
                        <div className="flex items-center justify-between gap-4 text-sm">
                          <span>{description}</span>
                          <span className="flex shrink-0 items-center gap-1">
                            {capturing ? (
                              <span className="text-xs text-muted-foreground">
                                <Trans>Press the new keys</Trans>
                              </span>
                            ) : (
                              shortcut.combos.map((combo) => (
                                <kbd
                                  key={`${combo.key}-${combo.mod}-${combo.shift}`}
                                  className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs"
                                >
                                  {comboLabel(combo, mac)}
                                </kbd>
                              ))
                            )}
                            {isRebindable(shortcut) ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  aria-label={
                                    capturing
                                      ? t`Cancel changing ${description}`
                                      : t`Change ${description}`
                                  }
                                  onClick={() => {
                                    setRefusal(null);
                                    setCapturingId(
                                      capturing ? null : shortcut.id,
                                    );
                                  }}
                                >
                                  {capturing ? t`Cancel` : t`Change`}
                                </Button>
                                {Object.hasOwn(overrides, shortcut.id) && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    aria-label={t`Reset ${description}`}
                                    onClick={() => resetOne(shortcut.id)}
                                  >
                                    <Trans>Reset</Trans>
                                  </Button>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                <Trans>Fixed</Trans>
                              </span>
                            )}
                          </span>
                        </div>
                        {capturing && refusal && (
                          <p role="alert" className="text-xs text-destructive">
                            {refusal}
                          </p>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={Object.keys(overrides).length === 0}
              onClick={() => {
                setCapturingId(null);
                setRefusal(null);
                setShortcutOverrides({});
              }}
            >
              <Trans>Reset all shortcuts</Trans>
            </Button>
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Trans>Camera</Trans>
            </h3>
            <div className="mt-1 flex items-center justify-between gap-4 text-sm">
              <span>
                <Trans>Camera navigation</Trans>
              </span>
              <OptionSelect
                className="w-40"
                size="sm"
                ariaLabel={t`Camera navigation`}
                value={preset}
                onValueChange={(value) => {
                  const next = PRESETS.find((p) => p === value);
                  if (next) setPreset(next);
                }}
                options={PRESETS.map((p) => ({
                  value: p,
                  label: presetLabel(p),
                }))}
              />
            </div>
            <ul className="mt-2 flex flex-col gap-1">
              {navigationControls(preset).map((control) => (
                <li
                  key={navigationLabel(control)}
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <span>{moveLabel(control.move)}</span>
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {navigationLabel(control)}
                  </kbd>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
