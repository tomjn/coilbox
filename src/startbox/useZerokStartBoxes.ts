import { useEffect, useState } from "react";
import {
  contentStartBoxes,
  type GameItem,
  type RoomAllyTeam,
  type StartBoxConfig,
} from "@/content/bindings";
import { shareInFlight } from "@/content/inFlight";
import type { WorldExtent } from "./polygon";
import { readsZerokStartBoxes } from "./zerok";

/** Answers for this session, keyed by everything the file may read. */
const cache = new Map<string, StartBoxConfig | null>();
const pending = new Map<string, Promise<StartBoxConfig | null>>();

/**
 * The start boxes Zero-K will use on `mapName`, or null when the game is not
 * Zero-K, neither file exists or the file failed (issue #4194). `room`
 * is part of the key because a file may answer differently for who is in it.
 */
export function useZerokStartBoxes({
  enginePath,
  dataDir,
  game,
  mapName,
  extent,
  room,
}: {
  enginePath: string | undefined;
  dataDir: string | undefined;
  game: GameItem | null | undefined;
  mapName: string | undefined;
  extent: WorldExtent | null;
  room: RoomAllyTeam[];
}): { config: StartBoxConfig | null; loading: boolean } {
  const gameArchive = readsZerokStartBoxes(game)
    ? game?.primaryArchive.name
    : undefined;
  // The sizes as numbers, so a new extent object of the same size is the same
  // request.
  const sizeX = extent?.x;
  const sizeZ = extent?.z;
  // The shape as text, so a new array of the same room is the same request.
  const roomKey = JSON.stringify(room);
  const key =
    enginePath && dataDir && gameArchive && mapName && sizeX && sizeZ
      ? [dataDir, enginePath, gameArchive, mapName, sizeX, sizeZ, roomKey].join(
          "::",
        )
      : undefined;
  const [answer, setAnswer] = useState<{
    key: string;
    config: StartBoxConfig | null;
  } | null>(null);

  useEffect(() => {
    if (!key || !enginePath || !dataDir || !gameArchive || !mapName) return;
    if (!sizeX || !sizeZ) return;
    if (cache.has(key)) {
      setAnswer({ key, config: cache.get(key) ?? null });
      return;
    }
    let cancelled = false;
    shareInFlight(pending, key, () =>
      contentStartBoxes({
        enginePath,
        dataDir,
        gameArchive,
        mapName,
        mapSizeX: sizeX,
        mapSizeZ: sizeZ,
        allyTeams: JSON.parse(roomKey) as RoomAllyTeam[],
      }).then((res) => res.config),
    )
      .then((config) => {
        cache.set(key, config);
        if (!cancelled) setAnswer({ key, config });
      })
      .catch(() => {
        // The command logs its own failures and answers null for them, so a
        // rejection is the call itself failing. No boxes is the answer then.
        if (!cancelled) setAnswer({ key, config: null });
      });
    return () => {
      cancelled = true;
    };
  }, [key, enginePath, dataDir, gameArchive, mapName, sizeX, sizeZ, roomKey]);

  const current = !!key && answer?.key === key;
  return {
    config: current ? (answer?.config ?? null) : null,
    loading: !!key && !current,
  };
}
