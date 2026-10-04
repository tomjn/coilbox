import { ImportChallengeForm as SharedImportChallengeForm } from "../../../challenge/ImportChallengeForm";
import { warpathIdentity } from "../../../challenge/identity";
import { ImportHold } from "../../../challenge/importHold";
import {
  type UnitDatasetEntry,
  unitsyncGameInfo,
  unitsyncSkirmishAis,
  unitsyncUnitDataset,
} from "../../../content/bindings";
import { useUnitsyncScan } from "../../../content/config";
import { useMapEligibility } from "../../../content/mapEligibility";
import type { PlayTarget } from "../../../play/config";
import { usePreferredTarget } from "../../../play/config";
import { challengeGameRequirement } from "../../../play/gameOffer";
import {
  candidateGames,
  resolveGameByShortname,
} from "../../../play/installedGames";
import { useGameCatalog } from "../../../play/useGameCatalog";
import { getGameMatcher } from "../../../profile/profile";
import {
  decodeWarpathChallenge,
  runFromChallenge,
  substitutedMapCount,
  type WarpathChallengeSettings,
} from "../../challenge";
import type { GenBuildGraph } from "../../generate";
import { useRuns } from "../../runs";
import { setupLimitWarning } from "../../unitLimit";

/**
 * What the chosen game says about the side's start unit. `failure` is set when
 * coilbox could not read the data, which a second read may fix. A side with no
 * start unit is a property of the game and reads no unit data.
 */
async function readUnitData(
  target: PlayTarget,
  gameArchive: string,
  side: string | undefined,
): Promise<{
  startUnit?: string;
  units?: UnitDatasetEntry[];
  failure?: string;
}> {
  const args = {
    enginePath: target.enginePath,
    dataDir: target.dataDir,
    gameArchive,
  };
  try {
    const info = await unitsyncGameInfo(args);
    const startUnit = info.sides?.find((s) => s.name === side)?.startUnit;
    if (!startUnit) return {};
    const dataset = await unitsyncUnitDataset(args);
    return { startUnit, units: dataset.units };
  } catch (e) {
    return { failure: e instanceof Error ? e.message : String(e) };
  }
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
  const gameCatalog = useGameCatalog();

  const finish = async (
    settings: WarpathChallengeSettings,
    target: PlayTarget,
    accepted: boolean,
  ) => {
    const matcher = getGameMatcher();
    const games = (scan.data?.games ?? []).filter(
      (g) => !matcher || matcher(g.name),
    );
    const installedGame =
      resolveGameByShortname(settings.game, games) ??
      candidateGames(settings.game, games)[0];
    if (!installedGame) {
      if (scan.error) {
        throw new Error(
          `The content scan failed, so this challenge's game could not be looked for: ${scan.error}`,
        );
      }
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

    // The commander build graph feeds unlock rewards and the run's unit limit.
    // Without it the run has no limit and offers perks only, which the player
    // must hear about before the run exists (issue #3488).
    const read = await readUnitData(target, archive, settings.side);
    const warning = setupLimitWarning({
      gameName: installedGame.name,
      sideName: settings.side ?? "this game",
      startUnit: read.startUnit,
      status: read.failure === undefined ? "ready" : "error",
      units: read.units ?? [],
    });
    if (warning && !accepted) {
      throw read.failure === undefined
        ? new ImportHold({
            message: warning,
            note: settings.side
              ? `This challenge code fixes the side to ${settings.side}, so you cannot choose another.`
              : "This challenge code names no side, so you cannot choose one.",
            canRetry: false,
            acceptLabel: "Create run anyway",
          })
        : new ImportHold({
            message: warning,
            detail: read.failure,
            canRetry: true,
            acceptLabel: "Create run with no unit limit",
          });
    }
    let build: GenBuildGraph | undefined;
    if (read.startUnit && read.units) {
      const edges = new Map<string, string[]>();
      const names = new Map<string, string>();
      for (const u of read.units) {
        edges.set(
          u.name.toLowerCase(),
          (u.buildOptions ?? []).map((o) => o.toLowerCase()),
        );
        names.set(u.name.toLowerCase(), u.fullName ?? u.name);
      }
      build = { startUnit: read.startUnit.toLowerCase(), edges, names };
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
      identityOf={warpathIdentity}
      buildRequirement={(settings) =>
        challengeGameRequirement(settings.game, gameCatalog)
      }
      finish={finish}
      countSubstitutedMaps={substitutedMapCount}
      onImported={onImported}
    />
  );
}
