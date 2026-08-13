/**
 * The layouts this scenario holds, and the way in and out of a game's own
 * blueprint file (issue #1312).
 *
 * A layout is worth having outside the mission it was drawn in, and the easiest
 * way to make one is to build a base in game and save it with the game's own
 * widget. This panel is the door between the two: a file that widget wrote comes
 * in as bases on the map, and a base drawn here goes back out for the same
 * widget to place.
 *
 * It is a panel rather than a library because the library is
 * https://github.com/tomjn/coilbox/issues/1415 and does not exist yet. A layout
 * currently lives inside a scenario document and nowhere else, so a scenario is
 * where an import has to land and where an export has to come from.
 *
 * Three things this panel is careful about, all of them the point of the issue:
 *
 * - An import is a conversion, so it says what it changed. A layout the file
 *   saved on its side is turned, a building the engine would not build where the
 *   file put it is moved onto the build grid, and both are counted on screen
 *   before anything is added to the document.
 * - An export is lossy in one direction only, and the fields it strips are on
 *   screen next to the button that strips them.
 * - Writing into a game's file copies it first and refuses while a game is
 *   running. That lives in `gameFile.ts` and is enforced there as well as here,
 *   so it holds whether or not this panel remembered to ask.
 */

import { Button } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Blocks, Download, Pencil, Upload } from "lucide-react";
import { useState } from "react";
import { barFormat } from "@/blueprint/bar";
import { appFileIO } from "@/blueprint/fileIO";
import { buildGridSnap } from "@/blueprint/footprint";
import type { ImportedBlueprint, ImportReport } from "@/blueprint/format";
import { mergeIntoGameFile } from "@/blueprint/gameFile";
import type { UnitDatasetEntry } from "@/content/bindings";
import { BlueprintEditor } from "@/placement/BlueprintEditor";
import { usePlay } from "@/play/PlayProvider";
import type { Scenario } from "../../model";
import { replaceBlueprint } from "./bases";
import { takeBlueprint } from "./blueprintImport";
import { EditorPanel } from "./panels";

/** Where a layout taken out of a game's file is put down. The map's north-west
 *  corner, because the panel has no map to pick a better point on and a fixed
 *  one is at least somewhere an author can find it again. */
const DROP_POINT = { x: 0, z: 0 };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function BlueprintPanel({
  scenario,
  onChange,
  units,
}: {
  scenario: Scenario;
  onChange: (edit: (current: Scenario) => Scenario) => void;
  /** The game's units, which is what makes a footprint and so a build grid
   *  known. Empty until the dataset has been read. */
  units: UnitDatasetEntry[];
}) {
  const { running } = usePlay();
  const [read, setRead] = useState<{
    from: string;
    report: ImportReport;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Which layout is open in the map-free editor, if any. Held by id rather than
  // by value, so an edit lands back in the document and comes out of it again.
  const [editing, setEditing] = useState<string | null>(null);
  const openLayout = scenario.blueprints.find((b) => b.id === editing) ?? null;

  const team = scenario.setup.participants[0]?.id;

  async function onImport() {
    setError(null);
    setStatus(null);
    try {
      const src = await open({
        title: `Open ${barFormat.label}'s ${barFormat.file}`,
        multiple: false,
        filters: [{ name: "Blueprints", extensions: ["json"] }],
      });
      if (typeof src !== "string") return;
      const text = await appFileIO.read(src);
      if (text === null) {
        setError("There is no file there.");
        return;
      }
      // Without a unit dataset every building looks like one square, and
      // snapping on that would move the even-footprint ones onto the wrong half
      // of the grid. Better to leave the file's own numbers alone and say so.
      const snap = units.length > 0 ? buildGridSnap(units) : undefined;
      setRead({ from: src, report: barFormat.read(text, snap) });
    } catch (e) {
      setError(message(e));
    }
  }

  function onTake(imported: ImportedBlueprint) {
    if (!team) return;
    const ids = { base: crypto.randomUUID(), blueprint: crypto.randomUUID() };
    onChange((current) =>
      takeBlueprint(current, imported.layout, team, ids, DROP_POINT),
    );
    setStatus(
      `Added "${imported.layout.name}" at the map's north-west corner. Select one of its buildings and use Move the whole base to put it where you want it.`,
    );
  }

  async function onSend(layoutId: string, layoutName: string) {
    setError(null);
    setStatus(null);
    const layout = scenario.blueprints.find((b) => b.id === layoutId);
    if (!layout) return;
    try {
      const dest = await save({
        title: `Write into ${barFormat.label}'s ${barFormat.file}`,
        defaultPath: "blueprints.json",
        filters: [{ name: "Blueprints", extensions: ["json"] }],
      });
      if (!dest) return;
      setBusy(true);
      const done = await mergeIntoGameFile({
        io: appFileIO,
        format: barFormat,
        path: dest,
        layouts: [layout],
        gameRunning: running,
      });
      const what = done.replaced.length > 0 ? "Replaced" : "Added";
      setStatus(
        [
          `${what} "${layoutName}" in ${dest}.`,
          done.backup ? `The file it was is kept at ${done.backup}.` : null,
          done.kept > 0
            ? `${done.kept} entr${done.kept === 1 ? "y" : "ies"} coilbox cannot read ${done.kept === 1 ? "was" : "were"} left exactly as ${done.kept === 1 ? "it" : "they"} ${done.kept === 1 ? "was" : "were"}.`
            : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const layouts = scenario.blueprints;

  return (
    <EditorPanel
      title="Base blueprints"
      icon={Blocks}
      summary={
        layouts.length === 0
          ? "Take a base out of a game, or send one back"
          : `${layouts.length} layout${layouts.length === 1 ? "" : "s"}`
      }
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {barFormat.label} keeps the bases a player saves in game in{" "}
            <span className="font-mono">{barFormat.file}</span>, under whichever
            directory the engine writes to. Coilbox reads that file and writes
            back into it, keeping everything already in it.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={onImport}
          >
            <Upload className="mr-1 size-3.5" /> Open a game's file
          </Button>
        </div>

        {running && (
          <p className="rounded bg-amber-950/60 px-2 py-1.5 text-[11px] text-amber-200">
            A game is running. {barFormat.label} writes its whole blueprints
            file back when it saves or exits, so coilbox will not write into it
            until the game is closed.
          </p>
        )}

        {error && (
          <p className="rounded bg-red-950/60 px-2 py-1.5 text-[11px] text-red-200">
            {error}
          </p>
        )}
        {status && <p className="text-xs text-muted-foreground">{status}</p>}

        {read && (
          <FileContents
            from={read.from}
            report={read.report}
            canTake={!!team}
            onTake={onTake}
            onClose={() => setRead(null)}
          />
        )}

        <section className="space-y-2">
          <h3 className="text-xs font-medium">Layouts in this scenario</h3>
          {layouts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              None yet. Draw a base on the map, or open a game's file above.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {layouts.map((layout) => {
                const places = scenario.bases.filter(
                  (base) => base.blueprint === layout.id,
                );
                const stripped = barFormat.stripped(
                  places.flatMap((base) => base.buildings),
                );
                return (
                  <li
                    key={layout.id}
                    className="space-y-1 rounded border border-border/40 px-2 py-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm">
                        {layout.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {layout.buildings.length} building
                        {layout.buildings.length === 1 ? "" : "s"}
                        {layout.ordered ? " · build order" : ""}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        onClick={() =>
                          setEditing(editing === layout.id ? null : layout.id)
                        }
                      >
                        <Pencil className="mr-1 size-3.5" />
                        {editing === layout.id ? "Close" : "Edit the layout"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        disabled={busy || running}
                        onClick={() => onSend(layout.id, layout.name)}
                      >
                        <Download className="mr-1 size-3.5" /> Send to a game
                      </Button>
                    </div>

                    {openLayout?.id === layout.id && (
                      <div className="space-y-2 pt-1">
                        <p className="text-[11px] text-muted-foreground">
                          A layout is a shape rather than a place, so this draws
                          on a build grid and loads no map. Editing it here
                          edits the layout itself, so every base placed from it
                          changes. To change one base only, drag its buildings
                          on the map above.
                        </p>
                        <BlueprintEditor
                          blueprint={openLayout}
                          gameName={scenario.setup.gameName}
                          onChange={(next) => {
                            onChange((current) =>
                              replaceBlueprint(current, next),
                            );
                            if (next.buildings.length === 0) setEditing(null);
                          }}
                        />
                      </div>
                    )}
                    {stripped.length > 0 && (
                      <p className="text-[11px] text-amber-200/80">
                        Sending this strips {stripped.join(", ")}. A game's
                        blueprint is geometry, so there is nowhere for them to
                        go. They stay in this scenario.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </EditorPanel>
  );
}

/**
 * What one game file holds, and what taking a layout out of it would do to it.
 *
 * Every change the read made is counted here rather than after the fact,
 * because the point of showing this at all is that an author decides before the
 * document changes.
 */
function FileContents({
  from,
  report,
  canTake,
  onTake,
  onClose,
}: {
  from: string;
  report: ImportReport;
  /** False when the scenario has no participant to give a base to. */
  canTake: boolean;
  onTake: (imported: ImportedBlueprint) => void;
  onClose: () => void;
}) {
  return (
    <section className="space-y-2 rounded border border-border/60 bg-muted/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
          {from}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0"
          onClick={onClose}
        >
          Close
        </Button>
      </div>

      {report.blueprints.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          There are no layouts in this file coilbox can read.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {report.blueprints.map((imported, at) => (
            <li
              // A file is free to hold two layouts of the same name, and where
              // it stands in the file is the only thing telling them apart.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={`${at}-${imported.layout.name}`}
              className="space-y-1 rounded border border-border/40 bg-background px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm">
                  {imported.layout.name}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {imported.layout.buildings.length} building
                  {imported.layout.buildings.length === 1 ? "" : "s"}
                  {imported.layout.ordered ? " · build order" : ""}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={!canTake}
                  onClick={() => onTake(imported)}
                >
                  Add to this scenario
                </Button>
              </div>
              <Changes imported={imported} />
            </li>
          ))}
        </ul>
      )}

      {report.unreadable > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {report.unreadable} other entr
          {report.unreadable === 1 ? "y is" : "ies are"} in this file that
          coilbox cannot read. Writing back to it leaves{" "}
          {report.unreadable === 1 ? "it" : "them"} exactly as{" "}
          {report.unreadable === 1 ? "it is" : "they are"}.
        </p>
      )}

      {!canTake && (
        <p className="text-[11px] text-amber-200/80">
          This scenario has no participants yet, and a base on the map belongs
          to one. Add a participant in the setup above first.
        </p>
      )}
    </section>
  );
}

/** How far the file's own facing turned a layout, in words. */
const TURNS = [
  "",
  "a quarter turn",
  "half way round",
  "three quarters of a turn",
];

/** What reading one layout out of the file changed about it, in a line. */
function Changes({ imported }: { imported: ImportedBlueprint }) {
  const said: string[] = [];
  if (imported.turned > 0) {
    said.push(`turned ${TURNS[imported.turned]}, the way the game places it`);
  }
  if (imported.snapped.length > 0) {
    said.push(
      `${imported.snapped.length} building${imported.snapped.length === 1 ? "" : "s"} moved onto the build grid`,
    );
  }
  for (const dropped of imported.dropped) said.push(`${dropped} is not kept`);
  if (said.length === 0) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      Reading it {said.join(", ")}.
    </p>
  );
}
