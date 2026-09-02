/**
 * "Save a pack of layouts" (issue #1474): several of your own layouts into one
 * file.
 *
 * Coilbox could read a file of thirty layouts and could not write one, so
 * somebody who had built a set could not hand it over as a set and could not
 * put their own library back into the game they play. The choosing is what was
 * missing: `mergeIntoGameFile` has taken a list since the day it was written.
 *
 * Which is the point worth not losing. This adds no second way to write a
 * blueprints file. Every write goes through `../../gameFile.ts`, which refuses
 * while a game is running, copies the file before it changes it, never writes
 * over a file it could not read and carries entries it does not understand
 * through untouched. Writing four layouts is one merge with four in it rather
 * than four writes, so every one of those holds for the whole set: four layouts
 * make one copy of the file and either all four land or none of them do.
 *
 * The two destinations differ only in where the dialog opens and what the
 * sentence afterwards calls the file. A game's own `blueprints.json` is what
 * makes a set usable in game, and a file anywhere else is what gets posted.
 * Neither is a different code path, because a person is free to pick the game's
 * file from either button and the care has to hold either way. That is why the
 * running game is checked against the path that came back from the dialog rather
 * than against the button that opened it (issue #1488).
 */

import { save } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import { useUnitsyncEngineConfig } from "@/content/config";
import { engineConfigDir, underConfigDir } from "@/content/enginePaths";
import { ErrorBanner } from "@/content/pages/components/states";
import { usePreferredTarget } from "@/play/config";
import { usePlay } from "@/play/PlayProvider";
import { barFormat } from "../../bar";
import { appFileIO } from "../../fileIO";
import { mergeIntoGameFile } from "../../gameFile";
import { libraryLayout } from "../../library";
import { packStrips, packWriteSummary } from "../../pack";
import { useBlueprintLibrary } from "../../store";
import { LeavingPack } from "./LeavingPack";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function WritePackForm({
  onWritten,
}: {
  /** What the write did, once the file is on disk. */
  onWritten: (said: string) => void;
}) {
  const [taking, setTaking] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { records } = useBlueprintLibrary();
  const { running } = usePlay();
  const { target } = usePreferredTarget();
  // Where this engine writes, which is where the game keeps its blueprints, so
  // the common case is one click (issue #1435). The dialog still lets somebody
  // go somewhere else: several engines or several content roots means several
  // of these files.
  const { data: engineConfig } = useUnitsyncEngineConfig(
    target?.enginePath,
    target?.dataDir,
  );
  const configDir =
    engineConfigDir(engineConfig?.configPath) ?? target?.dataDir;
  const gameFile = configDir
    ? underConfigDir(configDir, barFormat.file)
    : undefined;

  const ticked = useMemo(
    () => records.filter((record) => taking.has(record.id)),
    [records, taking],
  );
  const strips = useMemo(() => packStrips(ticked), [ticked]);

  const toggle = (id: string) => {
    setTaking((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  /**
   * Write the ticked layouts into the file the person picks.
   *
   * One merge holding all of them, so the copy is made once and a name already
   * in the file is replaced where it stands rather than appended a second time.
   */
  const write = async (to: { title: string; defaultPath: string }) => {
    if (ticked.length === 0) return;
    setError(null);
    try {
      const dest = await save({
        title: to.title,
        defaultPath: to.defaultPath,
        filters: [{ name: "Blueprints", extensions: ["json"] }],
      });
      if (!dest) return;
      setBusy(true);
      const done = await mergeIntoGameFile({
        io: appFileIO,
        format: barFormat,
        path: dest,
        layouts: ticked.map(libraryLayout),
        gameRunning: running,
        // Which is what makes a running game stop the write into a game's own
        // file and not the one being posted (issue #1488). The dialog is free
        // to come back with a path in there whichever button opened it, so this
        // is the check rather than the buttons being off.
        configDir,
      });
      onWritten(packWriteSummary(dest, done));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      {error && (
        <div className="px-4 pt-4">
          <ErrorBanner message={`Not written: ${error}`} />
        </div>
      )}

      <LeavingPack
        records={records}
        taking={taking}
        strips={strips}
        gameFile={gameFile}
        gameRunning={running}
        keepsProvenance={ticked.some((record) => record.source)}
        busy={busy}
        onToggle={toggle}
        onAll={() => setTaking(new Set(records.map((record) => record.id)))}
        onClear={() => setTaking(new Set())}
        onWriteToGame={() =>
          void write({
            title: `Write into ${barFormat.label}'s ${barFormat.file}`,
            defaultPath: gameFile ?? "blueprints.json",
          })
        }
        onWriteToFile={() =>
          void write({
            title: "Save a file of blueprints",
            defaultPath: "blueprints.json",
          })
        }
      />
    </div>
  );
}
