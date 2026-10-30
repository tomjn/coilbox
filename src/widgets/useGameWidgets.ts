/**
 * The widgets the picked game ships (issue #4857), read from its archives
 * once a game whose handler is recognised is picked.
 */

import { useEffect, useState } from "react";
import type { GameItem } from "@/content/bindings";
import { errorText } from "@/lib/helpers";
import { gameWidgetsOf } from "./gameHandler";
import type { GameWidget } from "./gameWidgets";
import type { GameHandler } from "./widgetList";

export interface GameWidgets {
  /** Null while reading, and when no recognised game is picked. */
  widgets: GameWidget[] | null;
  reading: boolean;
  /** Why the widgets, or some archive's widgets, could not be read. */
  errors: string[];
}

export function useGameWidgets(
  enginePath: string | undefined,
  dataDir: string | undefined,
  installed: readonly GameItem[],
  game: GameHandler | undefined,
): GameWidgets {
  const [state, setState] = useState<GameWidgets>({
    widgets: null,
    reading: false,
    errors: [],
  });
  const handler = game?.handler ?? null;
  // A grouped entry runs its newest version's handler, so its widgets are the
  // newest version's too.
  const name = game ? (game.versions?.[0] ?? game.game) : undefined;
  const item = installed.find((g) => g.name === name);

  useEffect(() => {
    if (!enginePath || !dataDir || !item || !handler) {
      setState({ widgets: null, reading: false, errors: [] });
      return;
    }
    let cancelled = false;
    setState({ widgets: null, reading: true, errors: [] });
    gameWidgetsOf(enginePath, dataDir, item, handler).then(
      ({ widgets, errors }) => {
        if (!cancelled) setState({ widgets, reading: false, errors });
      },
      (e) => {
        if (!cancelled)
          setState({ widgets: null, reading: false, errors: [errorText(e)] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, item, handler]);

  return state;
}
