/**
 * Which game a launch names when compatibility mode is on (issue #4562).
 *
 * The player picks the game they know. If that game's switch is on and its
 * mutator is built and current, the launch names the mutator instead. A game
 * whose switch is off is never looked at: no plugin call, no scan, no mutator.
 * A mutator that is missing or stale blocks the launch with a message naming
 * the Rebuild action. It is never skipped, because launching the old game on a
 * current engine without its fixes is the failure compatibility mode exists to
 * prevent.
 */
import { compatStatus } from "../compat/bindings";
import { staleReason } from "../compat/staleReason";
import type { CompatSettings } from "../content/compatSettings";
import { primeGameInfo, primeScan } from "../content/config";
import type { PlayTarget } from "./config";

/** The mod option that tells the mutator's prelude which game it wraps. */
export const COMPAT_BASE_OPTION = "coilbox_compat_base";

export type CompatTarget =
  /** The switch is off, or the game has no entry. Launch the game itself. */
  | { kind: "off" }
  /**
   * Launch `gameType`, the mutator's unitsync name, in place of `baseName`.
   * `gameArchive` is the mutator's archive, for a launch that stacks its own
   * mutator on it.
   */
  | { kind: "use"; gameType: string; gameArchive: string; baseName: string }
  /** Do not launch. `message` says why and where to fix it. */
  | { kind: "blocked"; message: string };

interface Launchable {
  name: string;
  primaryArchive: { name: string };
}

/**
 * Resolve the game a launch should name. `game` is the game the player picked.
 * `settings` is `content.compat`.
 */
export async function resolveCompatTarget(opts: {
  target: Pick<PlayTarget, "enginePath" | "dataDir">;
  game: Launchable;
  settings: CompatSettings;
}): Promise<CompatTarget> {
  const { target, game, settings } = opts;
  if (!settings[game.primaryArchive.name]?.enabled) return { kind: "off" };

  const rebuild = `Open ${game.name} under Library > Games and choose Rebuild.`;
  const blocked = (why: string): CompatTarget => ({
    kind: "blocked",
    message: `Compatibility mode is on for ${game.name}, but ${why} ${rebuild}`,
  });

  try {
    const info = await primeGameInfo(
      target.enginePath,
      target.dataDir,
      game.primaryArchive.name,
    );
    if (!info.checksum) {
      return blocked("the game could not be read to check its mutator.");
    }
    const status = await compatStatus({
      dataDir: target.dataDir,
      enginePath: target.enginePath,
      archiveName: game.primaryArchive.name,
      baseChecksum: info.checksum,
    });
    if (!status.folder) return blocked("its mutator has not been built.");
    if (status.stale.length > 0) {
      return blocked(
        `its mutator is out of date: ${status.stale.map(staleReason).join("; ")}.`,
      );
    }
    const folder = status.folder.toLowerCase();
    const named = (games: Launchable[]) =>
      games.find((g) => g.primaryArchive.name.toLowerCase() === folder);
    // A mutator built since the last scan is not in the cached list yet.
    const found =
      named((await primeScan(target.enginePath, target.dataDir)).games) ??
      named((await primeScan(target.enginePath, target.dataDir, true)).games);
    if (!found) {
      return blocked(`the engine did not find ${status.folder}.`);
    }
    return {
      kind: "use",
      gameType: found.name,
      gameArchive: found.primaryArchive.name,
      baseName: game.name,
    };
  } catch (e) {
    return blocked(
      `its mutator could not be checked (${e instanceof Error ? e.message : String(e)}).`,
    );
  }
}
