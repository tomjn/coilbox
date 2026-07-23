import { ChallengeCodeInput } from "../../../challenge/ChallengeCodeInput";
import { challengeDecodeErrorMessage } from "../../../challenge/code";
import {
  unitsyncGameInfo,
  unitsyncSkirmishAis,
  unitsyncUnitDataset,
} from "../../../content/bindings";
import { useUnitsyncScan } from "../../../content/config";
import { usePreferredTarget } from "../../../play/config";
import { getGameMatcher } from "../../../profile/profile";
import { decodeWarpathChallenge, optionsFromChallenge } from "../../challenge";
import type { GenBuildGraph } from "../../generate";
import { generateRun } from "../../generate";
import { useRuns } from "../../runs";

/**
 * Paste a challenge code and generate the identical warpath locally, resolved
 * against the recipient's own install (issue #376). Mirrors conquest's
 * `ImportChallengeForm` in `ConquestListPage.tsx`.
 *
 * SEAM FOR #387 (resolve missing content on import): the "game not installed"
 * branch below is where a content-resolution/download flow belongs; today it
 * just reports the gap. `optionsFromChallenge` (see `../../challenge.ts`) is
 * the pure settings -> generator-options step #387's resolution result would
 * feed into unchanged.
 */
export function ImportChallengeForm({
  onImported,
}: {
  onImported: (id: string) => void;
}) {
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { saveRun } = useRuns();

  const importChallenge = async (code: string) => {
    const result = decodeWarpathChallenge(code);
    if (!result.ok) {
      throw new Error(challengeDecodeErrorMessage(result.error));
    }
    const { settings } = result;

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

  return (
    <ChallengeCodeInput
      helpText="Paste a challenge code shared by another player to generate the identical warpath on your own install."
      onImport={importChallenge}
    />
  );
}
