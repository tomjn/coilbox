/**
 * The player's widgets as the battle room needs them (issue #1292), read when
 * the room opens and again after a game exits, since the game rewrites its
 * config file then.
 */

import { useEffect, useRef, useState } from "react";
import type { GameItem } from "@/content/bindings";
import { usePlay } from "@/play/PlayProvider";
import { loadRoomWidgets, type RoomWidgets } from "./roomWidgets";

export function useRoomWidgets(
  enginePath: string | undefined,
  dataDir: string | undefined,
  game: GameItem | undefined,
): RoomWidgets | null {
  const { running } = usePlay();
  // What was read is kept with who it was read for, so a change of game or
  // engine shows nothing until the new read lands rather than the old game's.
  const [found, setFound] = useState<{
    key: string;
    widgets: RoomWidgets | null;
  } | null>(null);
  const [exits, setExits] = useState(0);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) setExits((n) => n + 1);
    wasRunning.current = running;
  }, [running]);

  const key = `${enginePath}::${dataDir}::${game?.primaryArchive.name}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `exits` only triggers a new read, and `key` stands for the game's identity.
  useEffect(() => {
    if (!enginePath || !dataDir || !game) {
      setFound(null);
      return;
    }
    let cancelled = false;
    loadRoomWidgets({ enginePath, dataDir, game }).then(
      (widgets) => {
        if (!cancelled) setFound({ key, widgets });
      },
      (e) => {
        console.warn("could not read the widgets for this room", e);
        if (!cancelled) setFound({ key, widgets: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, exits]);

  return found?.key === key ? found.widgets : null;
}
