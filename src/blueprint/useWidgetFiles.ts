/**
 * Keep the in game widget's files in step while the library is on screen
 * (issue #1419).
 *
 * Out: every change to the library is written to the content root the
 * preferred engine reads, so the next match lists every layout. In: on
 * arrival and whenever a game stops, what the widget saved in its spool is
 * collected into the library and the spool is emptied.
 *
 * Mounted by the library page and the detail page, which between them cover
 * every place a layout changes. Nothing here installs the widget: a player who
 * has not asked for it gets a file they will never read, which costs nothing.
 */

import { useEffect, useRef } from "react";

import { useUnitsyncEngineConfig } from "@/content/config";
import { engineConfigDir } from "@/content/enginePaths";
import { notify } from "@/notify/notify";
import { usePreferredTarget } from "@/play/config";
import { usePlay } from "@/play/PlayProvider";
import { appFileIO } from "./fileIO";
import { saveBlueprints, useBlueprintLibrary } from "./store";
import { collectSpool, exportWidgetLibrary } from "./widgetSync";

export function useWidgetFiles() {
  const { records, loading } = useBlueprintLibrary();
  const { target } = usePreferredTarget();
  const { running } = usePlay();
  const { data: engineConfig } = useUnitsyncEngineConfig(
    target?.enginePath,
    target?.dataDir,
  );
  const dataDir = target?.dataDir;
  const engineDir =
    engineConfigDir(engineConfig?.configPath) ?? target?.enginePath;
  const engineName = target?.engineVersion;

  // Out. Skipped while the library is still loading, so an empty list on the
  // way in never overwrites a full file.
  useEffect(() => {
    if (loading || !dataDir) return;
    exportWidgetLibrary(appFileIO, dataDir, records).catch((e) => {
      console.warn("could not write the widget's library file", e);
    });
  }, [records, loading, dataDir]);

  // In. Once per engine dir per time a game is not running, so a game ending
  // collects what was saved in it, and nothing is read twice.
  const collectedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loading || running || !engineDir) {
      if (running) collectedFor.current = null;
      return;
    }
    if (collectedFor.current === engineDir) return;
    collectedFor.current = engineDir;
    collectSpool({
      io: appFileIO,
      engineDir,
      engineName,
      gameRunning: false,
      save: async (found) => {
        await saveBlueprints(found);
      },
    })
      .then(({ collected, skipped }) => {
        if (collected > 0) {
          void notify({
            title:
              collected === 1
                ? "A blueprint saved in game is in your library."
                : `${collected} blueprints saved in game are in your library.`,
            level: "success",
          });
        }
        if (skipped > 0) {
          void notify({
            title: `${skipped} ${skipped === 1 ? "entry" : "entries"} in the widget's spool could not be read and ${skipped === 1 ? "was" : "were"} dropped.`,
            level: "warning",
          });
        }
      })
      .catch((e) => {
        void notify({
          title: `Could not collect what the widget saved: ${e instanceof Error ? e.message : String(e)}`,
          level: "error",
        });
      });
  }, [loading, running, engineDir, engineName]);
}
