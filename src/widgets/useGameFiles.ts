/**
 * Every recognised game's widget config file, read whenever the widget page
 * opens or rescans and after a game exits, so a change made in a game or by
 * another launcher reaches the widget sets (issue #4844).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { appFileIO } from "@/blueprint/fileIO";
import { errorText } from "@/lib/helpers";
import { usePlay } from "@/play/PlayProvider";
import type { GameHandler, WidgetRow } from "./widgetList";
import { absorbGame, type GameFile } from "./widgetSync";

export function useGameFiles(
  writeDir: string | undefined,
  games: readonly GameHandler[] | null,
  rows: readonly WidgetRow[] | null,
) {
  const { running } = usePlay();
  /** By game name. A game whose handler is not recognised has no entry. */
  const [files, setFiles] = useState<ReadonlyMap<string, GameFile> | null>(
    null,
  );
  // Only the latest read may land, so a slow read of a folder the page has
  // moved away from cannot replace the current one.
  const latest = useRef(0);

  const read = useCallback(async () => {
    const id = ++latest.current;
    if (!writeDir || !games || !rows) {
      setFiles(null);
      return;
    }
    const found = new Map<string, GameFile>();
    for (const game of games) {
      if (!game.handler) continue;
      try {
        found.set(
          game.game,
          await absorbGame(
            appFileIO,
            writeDir,
            { ...game, handler: game.handler },
            rows,
          ),
        );
      } catch (e) {
        found.set(game.game, { kind: "error", error: errorText(e) });
      }
      if (id !== latest.current) return;
    }
    setFiles(found);
  }, [writeDir, games, rows]);

  useEffect(() => {
    void read();
  }, [read]);

  // The game rewrites its file when it exits, and may have saved it for the
  // first time.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void read();
    wasRunning.current = running;
  }, [running, read]);

  return { files, reload: read };
}
