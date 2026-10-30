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
  const [found, setFound] = useState<RoomWidgets | null>(null);
  const [exits, setExits] = useState(0);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) setExits((n) => n + 1);
    wasRunning.current = running;
  }, [running]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `exits` only triggers a new read.
  useEffect(() => {
    if (!enginePath || !dataDir || !game) {
      setFound(null);
      return;
    }
    let cancelled = false;
    loadRoomWidgets({ enginePath, dataDir, game }).then(
      (widgets) => {
        if (!cancelled) setFound(widgets);
      },
      (e) => {
        console.warn("could not read the widgets for this room", e);
        if (!cancelled) setFound(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, game, exits]);

  return found;
}
