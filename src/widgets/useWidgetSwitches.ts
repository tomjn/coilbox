/**
 * The on or off state of each widget in one game's config file, and switching
 * it (issue #1289).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { appFileIO } from "@/blueprint/fileIO";
import { errorText } from "@/lib/helpers";
import { usePlay } from "@/play/PlayProvider";
import { findConfig, readOrder, switchWidget } from "./widgetConfig";
import type { GameHandler } from "./widgetList";

export type SwitchesState =
  /** Not a game coilbox can write for, or still reading. */
  | { kind: "none" }
  /** The game has not saved a config file yet. */
  | { kind: "missing" }
  | { kind: "ready"; path: string; order: ReadonlyMap<string, number> };

export function useWidgetSwitches(
  writeDir: string | undefined,
  game: GameHandler | undefined,
) {
  const { running } = usePlay();
  const config = game?.handler?.config;
  const shortName = game?.shortName;
  const [state, setState] = useState<SwitchesState>({ kind: "none" });
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const latest = useRef(0);

  const read = useCallback(async () => {
    const id = ++latest.current;
    setState({ kind: "none" });
    setError(null);
    if (!writeDir || !config || !shortName) return;
    try {
      const found = await findConfig(appFileIO, writeDir, config, shortName);
      if (id !== latest.current) return;
      setState(
        found
          ? {
              kind: "ready",
              path: found.path,
              order: readOrder(found.text, config.shape),
            }
          : { kind: "missing" },
      );
    } catch (e) {
      if (id === latest.current) setError(errorText(e));
    }
  }, [writeDir, config, shortName]);

  useEffect(() => {
    void read();
  }, [read]);

  const toggle = useCallback(
    async (name: string, on: boolean) => {
      if (!writeDir || !config || !shortName) return;
      const id = latest.current;
      setWriting(name);
      setError(null);
      try {
        const out = await switchWidget({
          io: appFileIO,
          writeDir,
          config,
          shortName,
          name,
          on,
          gameRunning: running,
        });
        if (id === latest.current) {
          setState({ kind: "ready", path: out.path, order: out.order });
        }
      } catch (e) {
        if (id === latest.current) setError(errorText(e));
      } finally {
        setWriting(null);
      }
    },
    [writeDir, config, shortName, running],
  );

  return { state, error, running, writing, toggle, reload: read };
}
