import { useMemo, useState } from "react";
import { compareGameVersions } from "@/conquest/model";
import { usePreferredTarget, useSkirmishAis } from "@/play/config";
import type { DemoInfo } from "./bindings";
import { useUnitsyncGameInfo, useUnitsyncScan } from "./config";
import {
  gameMatchesShortId,
  gameNamesMatch,
  resolveReplayShortGameId,
} from "./resolveContent";

/**
 * Resolve what a "refight this setup" (#368) needs from the currently
 * preferred engine/data root: whether the replay's game and map are actually
 * installed, and once they are, that game's sides and AI list, so
 * `demoInfoToSkirmishDraft` can validate factions and offer an AI picker.
 * Shared by `RefightPanel` (replay detail) and the presets drawer's "New
 * preset from replay..." picker so both resolve a replay the same way.
 *
 * Uses the skirmish launcher's own preferred target (not the Replays screen's
 * viewing target) since a refight is a fresh skirmish launch, not a replay
 * watch, mirroring `SkirmishPage`.
 *
 * Target games are restricted to the replay's short game id (issue #503):
 * any installed version of the same game, never an unrelated one. When more
 * than one version is installed, callers can offer `gameCandidates` as a
 * picker. `installedGame` defaults to the exact recorded build when it's
 * installed, else the newest candidate.
 */
export function useRefightSetup(info: DemoInfo | null | undefined) {
  const { target } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;

  const scan = useUnitsyncScan(enginePath, dataDir);
  const games = scan.data?.games ?? [];
  const maps = scan.data?.maps ?? [];

  const shortGameId = useMemo(
    () =>
      info
        ? resolveReplayShortGameId(
            info.gameType,
            games.map((g) => ({ name: g.name, shortname: g.info.shortname })),
          )
        : undefined,
    [games, info],
  );

  const gameCandidates = useMemo(
    () =>
      shortGameId
        ? games.filter((g) =>
            gameMatchesShortId(shortGameId, {
              name: g.name,
              shortname: g.info.shortname,
            }),
          )
        : [],
    [games, shortGameId],
  );

  const [selectedGameName, setSelectedGameName] = useState("");
  // Default to the exact recorded build (tolerant of version-string form, see
  // `gameNamesMatch`) when it's installed, else the newest same-short-id
  // candidate, so a stale selection from a previous replay never sticks.
  const defaultGame = useMemo(() => {
    if (!info || gameCandidates.length === 0) return undefined;
    const exact = gameCandidates.find((g) =>
      gameNamesMatch(g.name, info.gameType),
    );
    if (exact) return exact;
    return [...gameCandidates].sort((a, b) =>
      compareGameVersions(b.info.version ?? "", a.info.version ?? ""),
    )[0];
  }, [gameCandidates, info]);

  const installedGame =
    gameCandidates.find((g) => g.name === selectedGameName) ?? defaultGame;
  const installedMap = useMemo(
    () => (info ? maps.find((m) => m.name === info.mapName) : undefined),
    [maps, info],
  );
  const gameArchive = installedGame?.primaryArchive.name;

  const gameInfo = useUnitsyncGameInfo(enginePath, dataDir, gameArchive);
  const { ais } = useSkirmishAis(enginePath, dataDir, gameArchive);

  return {
    target,
    scanLoading: scan.loading,
    shortGameId,
    gameCandidates,
    selectedGameName: installedGame?.name ?? "",
    setSelectedGameName,
    installedGame,
    installedMap,
    missingGame: !!info && !scan.loading && gameCandidates.length === 0,
    missingMap: !!info && !scan.loading && !installedMap,
    sides: gameInfo.info?.sides ?? [],
    /** The target game's declared options, so a draft made from the replay can
     * tell what the match changed from what the game itself chose (#1838). */
    options: gameInfo.info?.options ?? [],
    /** Whether that option list is still being read. A save taken before it
     * lands would keep the whole recorded block, which is the bug. */
    optionsLoading: gameInfo.loading,
    ais,
  };
}
