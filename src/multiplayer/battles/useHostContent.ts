import { useEffect, useMemo, useState } from "react";
import {
  useUnitsyncGameInfo,
  useUnitsyncMapInfo,
  useUnitsyncScan,
} from "@/content/config";
import { withoutGeneratedGames } from "@/lib/generatedGames";
import { usePreferredTarget } from "@/play/config";
import { hexToI32 } from "../battle/config";

/**
 * The content half of any "open a battle" form: which game and map the host can
 * choose, and the two checksums a joiner needs to sync against them.
 *
 * Shared because opening a battle on a lobby server and opening one in a room this
 * client hosts ask exactly the same content questions, and an answer that differed
 * between the two would be a battle nobody could join.
 *
 * Selection lives here too, seeded to the first scanned entry, so a caller holds a
 * name and a setter rather than a scan, a memo and a defaulting effect.
 */
export function useHostContent(initialGame?: string, initialMap?: string) {
  const { target } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;

  const scan = useUnitsyncScan(enginePath, dataDir);
  // A game or map can appear in more than one archive, such as a packaged `.sdz`
  // and its decompiled `.sdd`. Collapse by name so each Select has one option
  // per name. The option value and key is the name, so duplicates would both
  // violate the unique-key rule and give the Select two indistinguishable
  // entries. Coilbox's own generated games are dropped first: nobody else could
  // join a battle hosted on a game only this machine has, and only until the next
  // test rewrites it. One the caller already named stays, so the Select is not
  // left showing a value it has no option for.
  const games = useMemo(
    () =>
      Array.from(
        new Map(
          withoutGeneratedGames(scan.data?.games ?? [], initialGame).map(
            (g) => [g.name, g],
          ),
        ).values(),
      ),
    [scan.data, initialGame],
  );
  const maps = useMemo(
    () =>
      Array.from(
        new Map((scan.data?.maps ?? []).map((m) => [m.name, m])).values(),
      ),
    [scan.data],
  );

  const [gameName, setGameName] = useState(initialGame ?? "");
  const [mapName, setMapName] = useState(initialMap ?? "");

  // Default the game/map to the first scanned entry once a scan lands.
  useEffect(() => {
    if (games.length > 0)
      setGameName((c) => (games.some((g) => g.name === c) ? c : games[0].name));
  }, [games]);
  useEffect(() => {
    if (maps.length > 0)
      setMapName((c) => (maps.some((m) => m.name === c) ? c : maps[0].name));
  }, [maps]);

  const selectedGame = games.find((g) => g.name === gameName);
  const gameInfo = useUnitsyncGameInfo(
    enginePath,
    dataDir,
    selectedGame?.primaryArchive.name,
  );
  const mapInfo = useUnitsyncMapInfo(enginePath, dataDir, mapName || undefined);
  const modhash = hexToI32(gameInfo.info?.checksum);
  const maphash = hexToI32(mapInfo.info?.checksum);
  // The hashes let joiners verify they have the same content. Without them the
  // battle would open unsyncable, so gate hosting on both resolving.
  const checksumsReady =
    gameInfo.status === "ready" && mapInfo.status === "ready";
  // A resolved-but-unhashable checksum or a worker error is a dead end, not
  // progress, so surface it with a retry instead of hanging on "Reading content".
  const gameFailed =
    gameInfo.status === "error" || gameInfo.status === "unsyncable";
  const mapFailed =
    mapInfo.status === "error" || mapInfo.status === "unsyncable";

  return {
    target,
    games,
    maps,
    scanning: scan.loading,
    /** Nothing to host with, and not merely nothing scanned yet. */
    noEngine: !target && !scan.loading,
    gameName,
    setGameName,
    mapName,
    setMapName,
    gameInfo,
    mapInfo,
    modhash,
    maphash,
    checksumsReady,
    gameFailed,
    mapFailed,
    /** Everything a battle needs before it can be opened. */
    ready: !!target && !!gameName && !!mapName && checksumsReady,
  };
}

/**
 * What to tell a host whose game or map would not hash. Pure.
 *
 * `firstError` is the worker's own first complaint, which names the missing
 * dependency where there is one.
 */
export function hashFailureMessage(
  kind: "game" | "map",
  status: string,
  firstError?: string,
): string {
  if (status === "unsyncable")
    return firstError
      ? `Couldn't hash the ${kind}: ${firstError}`
      : `Couldn't hash the ${kind}, so it may be missing a dependency or be unreadable.`;
  return firstError
    ? `Failed to read the ${kind}: ${firstError}`
    : `Failed to read the ${kind}.`;
}
