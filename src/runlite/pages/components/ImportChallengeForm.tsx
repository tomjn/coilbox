import { ImportChallengeForm as SharedImportChallengeForm } from "../../../challenge/ImportChallengeForm";
import {
  unitsyncGameInfo,
  unitsyncSkirmishAis,
  unitsyncUnitDataset,
} from "../../../content/bindings";
import { useUnitsyncScan } from "../../../content/config";
import { useMapEligibility } from "../../../content/mapEligibility";
import type { ContentRequirement } from "../../../content/resolveContent";
import type { PlayTarget } from "../../../play/config";
import { usePreferredTarget } from "../../../play/config";
import { getGameMatcher } from "../../../profile/profile";
import {
  decodeWarpathChallenge,
  runFromChallenge,
  substitutedMapCount,
  type WarpathChallengeSettings,
} from "../../challenge";
import type { GenBuildGraph } from "../../generate";
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
 * challenge's game first if it isn't installed (issue #387). Wraps the shared
 * `ImportChallengeForm` (issue #2441) with warpath's own decode and finish.
 * Conquest's counterpart is `ImportChallengeForm` in `ConquestListPage.tsx`.
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
  const { eligible } = useMapEligibility();
  const { saveRun } = useRuns();

  const finish = async (
    settings: WarpathChallengeSettings,
    target: PlayTarget,
  ) => {
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
    const maps = eligible(scan.data?.maps ?? []).map((m) => ({
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

    // The commander build graph is only needed for unlock rewards, without it
    // the generator falls back to perk-only rewards (same as a fresh run whose
    // game has no unit dataset), mirroring `RunSetupForm`'s own resolution.
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
      // Build graph is best-effort. The run still generates without it.
    }

    const id = `run-${crypto.randomUUID()}`;
    const run = runFromChallenge(settings, { maps, build, enemyAiKey });
    await saveRun(id, { ...run, importedChallenge: true });
    return { id, doc: run };
  };

  return (
    <SharedImportChallengeForm
      helpText="Paste a challenge code shared by another player to generate the identical warpath on your own install."
      substitutedNoun="encounters"
      initialCode={initialCode}
      decode={decodeWarpathChallenge}
      buildRequirement={(settings) =>
        shortnameGameRequirement(settings.game.shortname)
      }
      finish={finish}
      countSubstitutedMaps={substitutedMapCount}
      onImported={onImported}
    />
  );
}
