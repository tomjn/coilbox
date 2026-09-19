import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { identify } from "@/container/container";
import { rememberCarriedShortname } from "@/container/shortnames";
import { ResolveContentGate } from "@/content/pages/components/ResolveContentDrawer";
import {
  exactGameRequirement,
  exactMapRequirement,
} from "@/content/resolveContent";
import { playImportPreset } from "./bindings";
import type { PlayTarget } from "./config";
import type { SkirmishDraft } from "./drafts";
import { parsePresetJson } from "./presets";

/** An imported preset waiting on the content check, plus the name its file
 *  carried. */
export type PendingPreset = SkirmishDraft & { name?: string };

/**
 * Importing a shared preset file into the library.
 *
 * Both preset sheets offer this, so the file dialog, the parse and the pending
 * slot live here rather than once per screen. What happens once the content
 * check passes is the caller's: Singleplayer records the hub import that
 * produced it, a battle room just saves it.
 *
 * A parsed preset is held rather than saved outright, because a preset names a
 * game and a map this machine may not have, and offering to fetch them beats
 * saving something that cannot be launched.
 */
export function usePresetImport(onError: (message: string | null) => void) {
  const [pending, setPending] = useState<PendingPreset | null>(null);

  const importFromFile = async () => {
    onError(null);
    try {
      const src = await open({
        title: "Import preset",
        multiple: false,
        filters: [{ name: "Coilbox preset", extensions: ["json"] }],
      });
      if (typeof src !== "string") return;
      const { json } = await playImportPreset({ src });
      const parsed = parsePresetJson(json);
      if (!parsed) {
        onError("That file isn't a valid coilbox preset.");
        return;
      }
      // Take the preset's word for the shortname of the build it pins, so a
      // re-share from here carries it on (issue #1383).
      rememberCarriedShortname(identify(json).game);
      setPending(parsed);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return { pending, setPending, importFromFile };
}

/** The content check an imported preset waits behind, or nothing when none is
 *  waiting. */
export function PresetImportGate({
  pending,
  target,
  targetLoading,
  onContinue,
  onCancel,
}: {
  pending: PendingPreset | null;
  target?: PlayTarget;
  targetLoading?: boolean;
  onContinue: (preset: PendingPreset) => void;
  onCancel: () => void;
}) {
  if (!pending) return null;
  return (
    <ResolveContentGate
      title="Set up this preset"
      requirements={[
        exactGameRequirement(pending.gameName),
        exactMapRequirement(pending.mapName),
      ]}
      target={target}
      targetLoading={targetLoading}
      onContinue={() => onContinue(pending)}
      onCancel={onCancel}
    />
  );
}
