import { useState } from "react";
import { ChallengeCodeInput } from "../../../challenge/ChallengeCodeInput";
import { identify } from "../../../container/container";
import { ResolveContentGate } from "../../../content/pages/components/ResolveContentDrawer";
import { notify } from "../../../notify/notify";
import type { PlayTarget } from "../../../play/config";
import { useSkirmishPresets } from "../../../play/presets";
import { packDecodeErrorMessage } from "../../envelope";
import {
  decodeSetupPack,
  namesForPackPresets,
  requirementsForPack,
  type SetupPackManifest,
} from "../../manifest";

/**
 * "Import a setup pack" (issue #415): paste a pack code, resolve its engine,
 * game and maps through issue #387's `ResolveContentGate` (nothing is applied
 * until every download clears, so a partial failure can't half-apply the
 * pack), then save any bundled presets, renaming on a name collision rather
 * than overwriting an existing preset.
 */
export function ImportPackForm({
  target,
  initialCode,
}: {
  target: PlayTarget | null;
  /** A confirmed `coilbox://` import code to prefill and run once (issue #388). */
  initialCode?: string;
}) {
  const { presets, savePreset } = useSkirmishPresets();
  const [pending, setPending] = useState<SetupPackManifest | null>(null);

  const importCode = async (code: string) => {
    const result = decodeSetupPack(code);
    if (!result.ok) {
      // Identify the paste so a mystery code gets a specific message: a
      // newer-version warning, or "that's a campaign, not a setup pack",
      // instead of a generic "corrupted" (issue #479).
      const id = identify(code);
      if (id.warnings.length > 0) throw new Error(id.warnings[0]);
      if (id.kind !== "unknown" && id.kind !== "setup-pack") {
        throw new Error(`That code is a coilbox ${id.kind}, not a setup pack.`);
      }
      throw new Error(packDecodeErrorMessage(result.error));
    }
    setPending(result.settings);
  };

  const applyPack = () => {
    if (!pending) return;
    const bundled = pending.presets ?? [];
    if (bundled.length > 0) {
      const names = namesForPackPresets(presets, bundled);
      bundled.forEach((preset, i) => {
        const { name: _name, ...draft } = preset;
        savePreset(names[i], draft);
      });
      notify({
        title: "Setup pack imported",
        body: `${bundled.length} preset${bundled.length === 1 ? "" : "s"} added. Load ${bundled.length === 1 ? "it" : "one"} from Singleplayer → Presets.`,
        level: "success",
      });
    } else {
      notify({
        title: "Setup pack imported",
        body: "The engine, game and maps are ready.",
        level: "success",
      });
    }
    setPending(null);
  };

  return (
    <>
      <ChallengeCodeInput
        helpText="Paste a setup pack code shared by another player to install its engine, game and maps, and add any presets it includes."
        placeholder="Paste a setup pack code…"
        submitLabel="Import setup pack"
        busyLabel="Checking…"
        initialCode={initialCode}
        onImport={importCode}
      />
      {pending && (
        <ResolveContentGate
          title="Set up this pack"
          requirements={requirementsForPack(pending)}
          target={target ?? undefined}
          onContinue={applyPack}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
