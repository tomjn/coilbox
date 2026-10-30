import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { invalidateGameInfo, primeGameInfo } from "@/content/config";
import { describeError } from "@/i18n/uiError";
import {
  type CompatMutatorReading,
  readCompatMutator,
} from "@/play/compatTarget";
import type { PlayTarget } from "@/play/config";
import {
  buildCompatOnce,
  compatBuildKey,
  useCompatBuild,
} from "../../compat/buildStore";
import {
  useCompatSettings,
  withCompatEntry,
} from "../../content/compatSettings";
import { compatGameName } from "../battle/compatBattle";
import { hexToI32 } from "../battle/config";
import { hashFailureMessage } from "./useHostContent";

interface HostableGame {
  name: string;
  primaryArchive: { name: string };
}

/** A mutator reading, plus the hash a battle on a current mutator advertises. */
type HostReading =
  | Exclude<CompatMutatorReading, { kind: "current" }>
  | {
      kind: "current";
      latest: number;
      gameType: string;
      modhash: number;
    };

async function readForHosting(
  target: Pick<PlayTarget, "enginePath" | "dataDir">,
  game: HostableGame,
): Promise<HostReading> {
  const reading = await readCompatMutator({ target, game });
  if (reading.kind !== "current") return reading;
  // A rebuild can change the checksum under the same folder name, and joiners
  // are refused on a stale one, so the hash is read fresh for every battle.
  const { enginePath, dataDir } = target;
  invalidateGameInfo(enginePath, dataDir, reading.gameArchive);
  try {
    const info = await primeGameInfo(enginePath, dataDir, reading.gameArchive);
    if (!info.checksum) {
      return {
        kind: "failed",
        reason: hashFailureMessage("game", "unsyncable", info.errors?.[0]),
      };
    }
    return {
      kind: "current",
      latest: reading.latest,
      gameType: reading.gameType,
      modhash: hexToI32(info.checksum),
    };
  } catch (e) {
    return { kind: "failed", reason: describeError(e) };
  }
}

export type HostCompatStatus =
  /** The host is not hosting on the mutator, so there is nothing to wait for. */
  | "off"
  | "checking"
  | "current"
  /** Missing, stale or not listed by the engine. Building fixes it. */
  | "needs-build"
  | "building"
  /** It could not be checked. Checking again may fix it. */
  | "failed";

export interface HostCompat {
  /** The host's switch is on for this game, so the host has a choice. */
  offered: boolean;
  /** The battle would run the mutator rather than the game itself. */
  useMutator: boolean;
  chooseMutator: (use: boolean) => void;
  status: HostCompatStatus;
  /** The name the battle would have, once the compat version is known. */
  mutatorName: string | null;
  /** Why Host is held back, in a few words. */
  problem: string | null;
  /** The mutator is there, but out of date or unlisted, so it is rebuilt. */
  rebuild: boolean;
  progress?: { done: number; total: number };
  build: () => void;
  recheck: () => void;
  /** What the battle advertises in place of the game's own name and hash. */
  battleGame: { name: string; modhash: number } | null;
  /** Nothing about compatibility mode is holding Host back. */
  ready: boolean;
}

/**
 * Whether a battle opens on the host's game or on its compat mutator (issue
 * #4712). A game whose switch is off is never looked at. With the switch on the
 * mutator is what the host gets unless they choose the game itself, with the same
 * rules for "missing or stale" as a skirmish, and Host waits until it is current.
 */
export function useHostCompat(
  target: Pick<PlayTarget, "enginePath" | "dataDir"> | null,
  game: HostableGame | undefined,
): HostCompat {
  const [settings, setSettings] = useCompatSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;
  const archive = game?.primaryArchive.name;
  const gameName = game?.name;
  const offered = !!archive && !!settings[archive]?.enabled;

  // Held per game, so choosing the game itself does not carry over to another.
  const [baseChosenFor, setBaseChosenFor] = useState<string | null>(null);
  const useMutator = offered && baseChosenFor !== archive;

  const [attempt, setAttempt] = useState(0);
  const key = useMutator
    ? `${dataDir}::${enginePath}::${archive}#${attempt}`
    : null;
  const [reading, setReading] = useState<{
    key: string;
    value: HostReading;
  } | null>(null);
  const shown = reading && reading.key === key ? reading.value : null;
  const latest = shown && "latest" in shown ? shown.latest : null;

  const [buildError, setBuildError] = useState<string | null>(null);
  const running = useCompatBuild(
    archive && latest !== null
      ? compatBuildKey(dataDir, archive, latest)
      : null,
  );
  const building = !!running;
  // biome-ignore lint/correctness/useExhaustiveDependencies: archive is the trigger, a failure belongs to one game
  useEffect(() => setBuildError(null), [archive]);

  useEffect(() => {
    if (!key || !enginePath || !dataDir || !archive || !gameName) return;
    let cancelled = false;
    void readForHosting(
      { enginePath, dataDir },
      { name: gameName, primaryArchive: { name: archive } },
    ).then((value) => {
      if (!cancelled) setReading({ key, value });
    });
    return () => {
      cancelled = true;
    };
  }, [key, enginePath, dataDir, archive, gameName]);

  // A build that ends, wherever it was started, changes the answer. That includes
  // one started before this form was opened again.
  const wasBuilding = useRef(false);
  useEffect(() => {
    if (wasBuilding.current && !building) setAttempt((n) => n + 1);
    wasBuilding.current = building;
  }, [building]);

  const recheck = useCallback(() => {
    setBuildError(null);
    setAttempt((n) => n + 1);
  }, []);

  const build = () => {
    if (!enginePath || !dataDir || !archive || !gameName || !shown) return;
    if (!("baseChecksum" in shown)) return;
    const { latest: version, baseChecksum } = shown;
    setBuildError(null);
    buildCompatOnce({
      dataDir,
      enginePath,
      archiveName: archive,
      gameName,
      baseChecksum,
      manifestVersion: version,
    }).then(
      () =>
        setSettings(
          withCompatEntry(settingsRef.current, archive, {
            enabled: true,
            version,
          }),
        ),
      (e) => setBuildError(describeError(e)),
    );
  };

  const mutatorName =
    shown?.kind === "current"
      ? shown.gameType
      : latest !== null && gameName
        ? compatGameName(gameName, latest)
        : null;

  const describe = (): { status: HostCompatStatus; problem: string | null } => {
    if (!useMutator) return { status: "off", problem: null };
    if (building) return { status: "building", problem: null };
    if (!shown) return { status: "checking", problem: null };
    switch (shown.kind) {
      case "current":
        return { status: "current", problem: null };
      case "missing":
        return { status: "needs-build", problem: buildError ?? t`Not built` };
      case "stale": {
        const { reasons } = shown;
        return {
          status: "needs-build",
          problem: buildError ?? t`Out of date: ${reasons}`,
        };
      }
      case "unscanned": {
        const { folder } = shown;
        return {
          status: "needs-build",
          problem: buildError ?? t`The engine did not find ${folder}`,
        };
      }
      case "unreadable":
        return { status: "failed", problem: t`The game could not be read` };
      case "failed":
        return { status: "failed", problem: shown.reason };
    }
  };
  const { status, problem } = describe();

  return {
    offered,
    useMutator,
    chooseMutator: (use) => setBaseChosenFor(use ? null : (archive ?? null)),
    status,
    mutatorName,
    problem,
    rebuild: shown?.kind === "stale" || shown?.kind === "unscanned",
    progress: running?.progress && {
      done: running.progress.done,
      total: running.progress.total,
    },
    build,
    recheck,
    battleGame:
      status === "current" && shown?.kind === "current"
        ? { name: shown.gameType, modhash: shown.modhash }
        : null,
    ready: status === "off" || status === "current",
  };
}
