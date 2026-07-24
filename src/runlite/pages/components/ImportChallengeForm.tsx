import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { challengeImport } from "../../../challenge/bindings";
import { ChallengeCodeInput } from "../../../challenge/ChallengeCodeInput";
import { challengeDecodeErrorMessage } from "../../../challenge/code";
import {
  unitsyncGameInfo,
  unitsyncSkirmishAis,
  unitsyncUnitDataset,
} from "../../../content/bindings";
import { useUnitsyncScan } from "../../../content/config";
import { ResolveContentGate } from "../../../content/pages/components/ResolveContentDrawer";
import type { ContentRequirement } from "../../../content/resolveContent";
import { usePreferredTarget } from "../../../play/config";
import { getGameMatcher } from "../../../profile/profile";
import {
  decodeWarpathChallenge,
  optionsFromChallenge,
  type WarpathChallengeSettings,
} from "../../challenge";
import type { GenBuildGraph } from "../../generate";
import { generateRun } from "../../generate";
import { useRuns } from "../../runs";

/** Best-effort shortname match, filtered by the distribution profile's game
 * filter — the same rule `importChallenge` used before #387. */
function shortnameGameRequirement(shortname: string): ContentRequirement {
  const want = shortname.trim().toLowerCase();
  return {
    kind: "game",
    label: shortname,
    downloadKey: shortname,
    isInstalled: (installed) => {
      const matcher = getGameMatcher();
      return installed.games.some(
        (g) =>
          (!matcher || matcher(g.name)) &&
          (g.shortname ?? g.name).trim().toLowerCase() === want,
      );
    },
  };
}

/**
 * Paste a challenge code and generate the identical warpath locally, resolved
 * against the recipient's own install (issue #376), offering to download the
 * challenge's game first if it isn't installed (issue #387). Mirrors
 * conquest's `ImportChallengeForm` in `ConquestListPage.tsx`.
 */
export function ImportChallengeForm({
  onImported,
  initialCode,
}: {
  onImported: (id: string) => void;
  /** A confirmed `coilbox://` import code to prefill and run once (issue #388). */
  initialCode?: string;
}) {
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { saveRun } = useRuns();
  const [pending, setPending] = useState<WarpathChallengeSettings | null>(null);

  const finishImport = async (settings: WarpathChallengeSettings) => {
    if (!target) throw new Error("Install an engine first.");
    const matcher = getGameMatcher();
    const games = (scan.data?.games ?? []).filter(
      (g) => !matcher || matcher(g.name),
    );
    const want = settings.game.shortname.trim().toLowerCase();
    const installedGame = games.find(
      (g) => (g.info.shortname ?? g.name).trim().toLowerCase() === want,
    );
    if (!installedGame) {
      throw new Error(
        `This challenge needs "${settings.game.shortname}", which isn't installed. Install it from Content → Games, then try again.`,
      );
    }

    const archive = installedGame.primaryArchive.name;
    const maps = (scan.data?.maps ?? []).map((m) => ({
      name: m.name,
      size: (m.width ?? 8) * (m.height ?? 8),
    }));
    const { ais } = await unitsyncSkirmishAis({
      enginePath: target.enginePath,
      dataDir: target.dataDir,
      gameArchive: archive,
    });
    const enemyAiKey = ais[0]
      ? `${ais[0].kind}:${ais[0].shortName}`
      : undefined;

    // The commander build graph is only needed for unlock rewards; without it
    // the generator falls back to perk-only rewards (same as a fresh run whose
    // game has no unit dataset) — mirrors `RunSetupForm`'s own resolution.
    let build: GenBuildGraph | undefined;
    try {
      const info = await unitsyncGameInfo({
        enginePath: target.enginePath,
        dataDir: target.dataDir,
        gameArchive: archive,
      });
      const startUnit = info.sides?.find(
        (s) => s.name === settings.side,
      )?.startUnit;
      if (startUnit) {
        const dataset = await unitsyncUnitDataset({
          enginePath: target.enginePath,
          dataDir: target.dataDir,
          gameArchive: archive,
        });
        const edges = new Map<string, string[]>();
        const names = new Map<string, string>();
        for (const u of dataset.units) {
          edges.set(
            u.name.toLowerCase(),
            (u.buildOptions ?? []).map((o) => o.toLowerCase()),
          );
          names.set(u.name.toLowerCase(), u.fullName ?? u.name);
        }
        build = { startUnit: startUnit.toLowerCase(), edges, names };
      }
    } catch {
      // Build graph is best-effort; the run still generates without it.
    }

    const id = `run-${crypto.randomUUID()}`;
    const run = generateRun(
      optionsFromChallenge(settings, { maps, build, enemyAiKey }),
    );
    await saveRun(id, { ...run, importedChallenge: true });
    onImported(id);
  };

  // Decode the code, then either finish straight away (game already
  // installed — no pointless prompt) or hand off to the resolve gate, which
  // offers the download and calls `finishImport` once it clears (#387).
  const importChallenge = async (code: string) => {
    const result = decodeWarpathChallenge(code);
    if (!result.ok) {
      throw new Error(challengeDecodeErrorMessage(result.error));
    }
    setPending(result.settings);
  };

  // Open a challenge file exported alongside the code (#476), the rest of the
  // import (decode, resolve, generate) is identical to a pasted code.
  const pickChallengeFile = async (): Promise<string | null> => {
    const src = await open({
      title: "Import challenge",
      multiple: false,
      filters: [{ name: "Coilbox challenge", extensions: ["json"] }],
    });
    if (typeof src !== "string") return null;
    const { text } = await challengeImport({ src });
    return text;
  };

  return (
    <>
      <ChallengeCodeInput
        helpText="Paste a challenge code shared by another player to generate the identical warpath on your own install."
        initialCode={initialCode}
        onImport={importChallenge}
        onPickFile={pickChallengeFile}
      />
      {pending && (
        <ResolveContentGate
          title="Set up this challenge"
          requirements={[shortnameGameRequirement(pending.game.shortname)]}
          target={target ?? undefined}
          onContinue={() => finishImport(pending).then(() => setPending(null))}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
