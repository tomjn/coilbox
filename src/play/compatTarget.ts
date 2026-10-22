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

import { t } from "@lingui/core/macro";
import { describeError } from "@/i18n/uiError";
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

  const gameName = game.name;
  const blocked = (message: string): CompatTarget => ({
    kind: "blocked",
    message,
  });

  try {
    const info = await primeGameInfo(
      target.enginePath,
      target.dataDir,
      game.primaryArchive.name,
    );
    if (!info.checksum) {
      return blocked(
        t`Compatibility mode is on for ${gameName}, but the game could not be read to check its mutator. Open ${gameName} under Library > Games and choose Rebuild.`,
      );
    }
    const status = await compatStatus({
      dataDir: target.dataDir,
      enginePath: target.enginePath,
      archiveName: game.primaryArchive.name,
      baseChecksum: info.checksum,
    });
    if (!status.folder)
      return blocked(
        t`Compatibility mode is on for ${gameName}, but its mutator has not been built. Open ${gameName} under Library > Games and choose Rebuild.`,
      );
    if (status.stale.length > 0) {
      const staleReasons = status.stale.map(staleReason).join("; ");
      return blocked(
        t`Compatibility mode is on for ${gameName}, but its mutator is out of date: ${staleReasons}. Open ${gameName} under Library > Games and choose Rebuild.`,
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
      const folderName = status.folder;
      return blocked(
        t`Compatibility mode is on for ${gameName}, but the engine did not find ${folderName}. Open ${gameName} under Library > Games and choose Rebuild.`,
      );
    }
    return {
      kind: "use",
      gameType: found.name,
      gameArchive: found.primaryArchive.name,
      baseName: game.name,
    };
  } catch (e) {
    const reason = describeError(e);
    return blocked(
      t`Compatibility mode is on for ${gameName}, but its mutator could not be checked (${reason}). Open ${gameName} under Library > Games and choose Rebuild.`,
    );
  }
}
