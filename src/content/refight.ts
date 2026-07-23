import { useMemo } from "react";
import { usePreferredTarget, useSkirmishAis } from "@/play/config";
import type { DemoInfo } from "./bindings";
import { useUnitsyncGameInfo, useUnitsyncScan } from "./config";

/**
 * Resolve what a "refight this setup" (#368) needs from the currently
 * preferred engine/data root: whether the replay's game and map are actually
 * installed, and — once they are — that game's sides and AI list, so
 * `demoInfoToSkirmishDraft` can validate factions and offer an AI picker.
 * Shared by `RefightPanel` (replay detail) and the presets drawer's "New
 * preset from replay…" picker so both resolve a replay the same way.
 *
 * Uses the skirmish launcher's own preferred target (not the Replays screen's
 * viewing target) since a refight is a fresh skirmish launch, not a replay
 * watch — mirroring `SkirmishPage`.
 */
export function useRefightSetup(info: DemoInfo | null | undefined) {
  const { target } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;

  const scan = useUnitsyncScan(enginePath, dataDir);
  const games = scan.data?.games ?? [];
  const maps = scan.data?.maps ?? [];

  // Best-effort exact-name match, same caveat as the replay page's own
  // `GameDownload`/map-preview affordances: the demo's `gameType` is a display
  // string, not a guaranteed archive key.
  const installedGame = useMemo(
    () => (info ? games.find((g) => g.name === info.gameType) : undefined),
    [games, info],
  );
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
    installedGame,
    installedMap,
    missingGame: !!info && !scan.loading && !installedGame,
    missingMap: !!info && !scan.loading && !installedMap,
    sides: gameInfo.info?.sides ?? [],
    ais,
  };
}
