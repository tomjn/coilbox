/**
 * Compatibility mode in a battle room (issue #4564).
 *
 * A host who plays an old game through its compat mutator advertises the
 * mutator's own name, `<game> (compat <n>)`, the name `modinfo.lua` gives it in
 * `tauri-plugin-coilbox-compat`. A joiner who has the base game but not that
 * mutator does not need to download anything: the mutator is reproducible, so
 * coilbox builds manifest `n` itself. A joiner whose coilbox only knows older
 * manifests is told to update, and one whose coilbox is newer builds the older
 * manifest and says nothing.
 *
 * Nothing here ever looks for a `coilbox-compat-*` archive on a server. The
 * mutator is built from the base game or it does not exist.
 *
 * Pure, so the decision is tested without a scan or a plugin.
 */

import { t } from "@lingui/core/macro";
import { isCompatArchive } from "@/lib/generatedGames";

/** The name `modinfo.lua` gives a mutator built from manifest `n`. */
const COMPAT_GAME_NAME = /^(.+) \(compat (0|[1-9][0-9]*)\)$/;

/** A battle's game name, read as a compat mutator's. */
export interface CompatGameName {
  /** The base game's name, as unitsync reports it. */
  baseName: string;
  /** The compat manifest version the mutator was built from. */
  version: number;
}

/** The base game and manifest version a mutator's name carries, or null for any other name. */
export function parseCompatGameName(gameName: string): CompatGameName | null {
  const m = COMPAT_GAME_NAME.exec(gameName);
  if (!m) return null;
  return { baseName: m[1], version: Number(m[2]) };
}

/**
 * Whether a game or archive name is a compat mutator's, which is built here and
 * never downloaded from anywhere.
 */
export function isCompatContentName(name: string): boolean {
  return parseCompatGameName(name) !== null || isCompatArchive(name);
}

interface ScannedGame {
  name: string;
  primaryArchive: { name: string };
}

/** What a battle's game needs from this machine. */
export type CompatPlan =
  /** Not a compat name, or the mutator is installed. Nothing special. */
  | { kind: "none" }
  /** The base game is not installed, so that is the game to get. */
  | { kind: "base-missing"; baseName: string }
  /** The base game is installed and the mutator is not. */
  | {
      kind: "needs-mutator";
      baseName: string;
      archiveName: string;
      version: number;
    };

export function classifyCompatBattle(
  gameName: string,
  games: readonly ScannedGame[],
): CompatPlan {
  const parsed = parseCompatGameName(gameName);
  if (!parsed || games.some((g) => g.name === gameName))
    return { kind: "none" };
  const base = games.find((g) => g.name === parsed.baseName);
  if (!base) return { kind: "base-missing", baseName: parsed.baseName };
  return {
    kind: "needs-mutator",
    baseName: parsed.baseName,
    archiveName: base.primaryArchive.name,
    version: parsed.version,
  };
}

/**
 * The game this machine has to hold for a battle: the game itself, or the base
 * game when the battle names a compat mutator this machine does not have yet.
 * The missing-game check and the download both ask for this name.
 */
export function requiredGameName(
  gameName: string,
  games: readonly ScannedGame[],
): string {
  const plan = classifyCompatBattle(gameName, games);
  return plan.kind === "none" ? gameName : plan.baseName;
}

/**
 * Whether a mutator for manifest `version` is built here, or this coilbox is too
 * old to build it. `latest` is the newest manifest this coilbox carries.
 */
export function compatBuildable(
  version: number,
  latest: number,
): "build" | "update" {
  return version > latest ? "update" : "build";
}

/** Where the mutator a battle names stands on this machine. */
export type CompatBattleState =
  | { status: "idle" }
  | { status: "building"; baseName: string; version: number }
  | { status: "update"; baseName: string; version: number; latest: number }
  | { status: "failed"; baseName: string; version: number; error: string };

/** What the state stops a launch for, or null. Same shape as `launchBlock`'s. */
export function compatLaunchBlock(
  state: CompatBattleState,
): { short: string; reason: string } | null {
  switch (state.status) {
    case "idle":
      return null;
    case "building": {
      const { baseName, version } = state;
      return {
        short: t`Building`,
        reason: t`Coilbox is building the compatibility mode copy of ${baseName} (compat ${version}) that this battle uses. It can start for you once that finishes.`,
      };
    }
    case "update": {
      const { baseName, version, latest } = state;
      return {
        short: t`Update coilbox`,
        reason: t`The host is on a newer coilbox. This battle uses ${baseName} compatibility mode version ${version} and this coilbox builds up to version ${latest}. Update coilbox to play.`,
      };
    }
    case "failed": {
      const { baseName, version, error } = state;
      return {
        short: t`Build failed`,
        reason: t`Coilbox could not build ${baseName} (compat ${version}) for this battle: ${error}`,
      };
    }
  }
}
