/**
 * Runs `loadEffectBitmaps` for a project's game, kept fresh as the project or
 * the engine target changes and disposed as it is replaced or left behind.
 */

import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { useUnitsyncScan } from "@/content/config";
import { usePreferredTarget } from "@/play/config";
import { type EffectBitmaps, loadEffectBitmaps } from "../../effectBitmaps";
import type { LegoProject } from "../../model";
import { installedGameFor, unitGame } from "../../unitGame";

const LOADING: EffectBitmaps = { atlas: null, note: null };

/** `project` is nullable so this can sit above the page's loading guard,
 *  alongside its other hooks, rather than being called conditionally. A null
 *  project reads the same as one with no game. */
export function useEffectBitmaps(project: LegoProject | null): EffectBitmaps {
  const { t } = useLingui();
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  // The unit's own game (#3257), read from the installed build of it. A game
  // that is not installed is still tried, so the note says it could not be read.
  const own = project ? unitGame(project) : null;
  const archive =
    installedGameFor(own, scan.data?.games ?? [])?.primaryArchive.name ??
    own?.archive;
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;

  const [loaded, setLoaded] = useState<EffectBitmaps | null>(null);
  const atlasRef = useRef<EffectBitmaps["atlas"]>(null);

  useEffect(() => {
    if (!archive || !enginePath || !dataDir) {
      setLoaded(null);
      return;
    }
    setLoaded(null);
    let live = true;
    loadEffectBitmaps({ enginePath, dataDir }, archive)
      .then((next) => {
        if (!live) {
          next.atlas?.texture.dispose();
          return;
        }
        setLoaded(next);
      })
      .catch((error: unknown) => {
        if (!live) return;
        const message = error instanceof Error ? error.message : String(error);
        setLoaded({
          atlas: null,
          note: t`Could not read the game's bitmaps, so effects are drawn as a plain round sprite: ${message}`,
        });
      });
    return () => {
      live = false;
    };
  }, [archive, enginePath, dataDir, t]);

  // The atlas a new one replaces is disposed here, and so is whatever the
  // last one was when this component goes away.
  useEffect(() => {
    const previous = atlasRef.current;
    const next = loaded?.atlas ?? null;
    atlasRef.current = next;
    if (previous && previous !== next) previous.texture.dispose();
  }, [loaded]);

  useEffect(() => {
    return () => {
      atlasRef.current?.texture.dispose();
    };
  }, []);

  if (!archive) {
    return {
      atlas: null,
      note: t`This unit has no game, so its effects are drawn as a plain round sprite.`,
    };
  }
  if (!enginePath || !dataDir) {
    return {
      atlas: null,
      note: t`There is no engine set up to read the game's bitmaps, so effects are drawn as a plain round sprite.`,
    };
  }
  return loaded ?? LOADING;
}
