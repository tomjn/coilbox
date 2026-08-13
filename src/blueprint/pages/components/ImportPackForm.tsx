/**
 * "Open a pack of layouts" (issue #1313): a file holding somebody else's whole
 * collection, read so that a person takes the ones they want out of it.
 *
 * The community gallery is closed and behind a Discord login, so what comes out
 * of it is a `blueprints.json` download and nothing else. That file is a game's
 * own blueprint file, which coilbox already reads (`../../bar.ts`), so this adds
 * no format. What it adds is everything around reading thirty at once: which
 * game to read them against, which of them are worth taking, and where the ones
 * taken came from.
 *
 * The game is picked here rather than found in the file because the file cannot
 * say. Its path has no game in it, so one file holds every layout every game
 * sharing a data directory ever saved. Picking a game is what makes a footprint
 * known, which is what draws each layout at the right size, and what makes "this
 * game has none of its units" answerable at all.
 *
 * Nothing is written until the button at the bottom, and nothing is ever written
 * to the file that was opened.
 */

import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";

import { identify } from "@/container/container";
import { useUnitsyncScan } from "@/content/config";
import { ErrorBanner } from "@/content/pages/components/states";
import { useGameUnits } from "@/content/useGameUnits";
import { usePreferredTarget } from "@/play/config";
import { barFormat } from "../../bar";
import { appFileIO } from "../../fileIO";
import { buildGridSnap, type Footprint } from "../../footprint";
import {
  footprintsFromUnits,
  packSource,
  type StoredBlueprint,
} from "../../library";
import {
  type BlueprintPack,
  packChanges,
  packPlan,
  placeableIndexes,
  readBlueprintPack,
} from "../../pack";
import { saveBlueprints, useBlueprintLibrary } from "../../store";
import { knownUnits } from "../../units";
import { ArrivingPack, type PackView } from "./ArrivingPack";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What a def stands on when the game's units have not been read. The engine
 *  floors a footprint at one square, so nothing ever stands on less. */
const ONE_SQUARE = (): Footprint => ({ x: 1, z: 1 });

export function ImportPackForm({
  onImported,
}: {
  /** The layouts kept, once they are on disk and the library has been re-read. */
  onImported: (records: StoredBlueprint[]) => void;
}) {
  const [file, setFile] = useState<{ path: string; text: string } | null>(null);
  const [game, setGame] = useState("");
  const [taking, setTaking] = useState<ReadonlySet<number>>(new Set());
  const [view, setView] = useState<PackView>({
    order: "fit",
    hideUnplaceable: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { records } = useBlueprintLibrary();
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const installed = useMemo(() => scan.data?.games ?? [], [scan.data]);
  // The first game on the machine until somebody says otherwise, so the pack is
  // read against something rather than opening on an empty list.
  const against = game || installed[0]?.name || "";
  const { units } = useGameUnits(against);

  // Without the units every building looks like one square, and snapping on
  // that would move the even-footprint ones onto the wrong half of the grid.
  // The file's own numbers are the honest answer instead.
  const snap = useMemo(
    () => (units.length > 0 ? buildGridSnap(units) : undefined),
    [units],
  );
  const known = useMemo(
    () => (units.length > 0 ? knownUnits(units) : undefined),
    [units],
  );
  const footprintOf = useMemo(
    () => footprintsFromUnits(units) ?? ONE_SQUARE,
    [units],
  );

  // Re-read rather than re-checked when the game changes, because the build
  // grid a layout snaps to is that game's footprints.
  const read = useMemo((): {
    pack?: BlueprintPack;
    failed?: string;
  } | null => {
    if (!file) return null;
    try {
      return { pack: readBlueprintPack(barFormat, file.text, snap) };
    } catch (e) {
      return { failed: message(e) };
    }
  }, [file, snap]);

  const picks = useMemo(
    () =>
      read?.pack
        ? packPlan({
            entries: read.pack.entries,
            taking,
            taken: records.map((record) => record.layout.name),
            installed,
            known,
            footprintOf,
            gameName: against,
          })
        : [],
    [read, taking, records, installed, known, footprintOf, against],
  );

  const pickFile = async () => {
    setError(null);
    try {
      const src = await open({
        title: "Open a file of layouts",
        multiple: false,
        filters: [{ name: "Blueprints", extensions: ["json"] }],
      });
      if (typeof src !== "string") return;
      const text = await appFileIO.read(src);
      if (text === null) throw new Error("There is no file there.");
      setTaking(new Set());
      setFile({ path: src, text });
    } catch (e) {
      setError(message(e));
    }
  };

  const toggle = (index: number) => {
    setTaking((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  };

  // The id is minted here rather than taken from the file, so opening the same
  // pack twice gives two copies rather than one silently replacing the other.
  const keep = async () => {
    if (!file) return;
    setError(null);
    setBusy(true);
    const at = new Date();
    try {
      const saved = await saveBlueprints(
        picks
          .filter((pick) => pick.taking)
          .map((pick) => ({
            id: crypto.randomUUID(),
            createdAt: "",
            updatedAt: "",
            layout: { ...pick.payload, name: pick.arrival.name },
            source: packSource(file.path, pick.arrival.wasCalled, at),
          })),
      );
      onImported(saved);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-muted-foreground">
          A file of layouts is what the community gallery hands you, and what a
          game writes its own saved bases into. Coilbox reads every layout in
          it, draws each one, and keeps only the ones you tick. The file itself
          is never written to.
        </p>
        <Button variant="outline" className="gap-1.5" onClick={pickFile}>
          <FolderOpen className="size-4" />
          {file ? "Open another file" : "Open a file…"}
        </Button>
      </div>

      {scan.error && (
        <div className="px-4 pb-4">
          <ErrorBanner
            message={`Your games could not be read, so nothing here has been checked against them: ${scan.error}`}
          />
        </div>
      )}

      {error && (
        <div className="px-4 pb-4">
          <ErrorBanner message={`Not saved: ${error}`} />
        </div>
      )}

      {read?.failed && (
        <div className="px-4 pb-4">
          <ErrorBanner message={read.failed} />
        </div>
      )}

      {file && read?.pack && read.pack.entries.length === 0 ? (
        <p className="border-t px-4 py-4 text-xs text-muted-foreground">
          {identify(file.text).kind === "blueprint"
            ? "That is a single coilbox blueprint rather than a file of them. Import it with the Import button instead."
            : "There are no layouts in this file that coilbox can read."}
        </p>
      ) : null}

      {file && read?.pack && read.pack.entries.length > 0 && (
        <div className="border-t">
          <ArrivingPack
            file={file.path}
            picks={picks}
            view={view}
            onView={setView}
            games={installed.map((one) => one.name)}
            game={against}
            onGame={setGame}
            unreadable={read.pack.unreadable}
            changes={packChanges(read.pack)}
            checked={known !== undefined}
            busy={busy}
            onToggle={toggle}
            onTakeAll={() => setTaking(placeableIndexes(picks))}
            onClear={() => setTaking(new Set())}
            onKeep={() => void keep()}
          />
        </div>
      )}
    </div>
  );
}
