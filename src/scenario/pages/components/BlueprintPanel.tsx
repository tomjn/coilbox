/**
 * The layouts this scenario holds, and the ways out of it (issues #1312,
 * #1327).
 *
 * A layout is worth having outside the mission it was drawn in, and the easiest
 * way to make one is to build a base in game and save it with the game's own
 * widget. This panel is the door between the two: a file that widget wrote comes
 * in as bases on the map, and a base drawn here goes back out for the same
 * widget to place.
 *
 * There are two ways out now, and they are the same trip. "Send to a game"
 * writes into that game's own blueprint file, which the game's widget reads.
 * "Save to your library" keeps it in coilbox, where it can be edited, shared and
 * dropped into another mission. Both take the geometry and leave everything a
 * mission put on top of it, which is what the warning under a layout counts.
 *
 * The way back in is the Layouts mode on the map, not a button here: a layout
 * arriving needs somewhere to stand, so it is placed by a click rather than
 * dropped at a fixed point. Taking one out of a game's file goes the same way
 * (issue #1434). It lands in the scenario unplaced, which is what the contents
 * list already has a pin for, rather than at the map's north-west corner.
 *
 * Three things this panel is careful about, all of them the point of the issue:
 *
 * - An import is a conversion, so it says what it changed. A layout the file
 *   saved on its side is turned, a building the engine would not build where the
 *   file put it is moved onto the build grid, and both are counted on screen
 *   before anything is added to the document.
 * - A game's file holds every game's layouts, because its path has no game in
 *   it, so each one is checked against the units this scenario's game has and
 *   what will not place is said before the document changes rather than after.
 * - An export is lossy in one direction only, and the fields it strips are on
 *   screen next to the button that strips them.
 * - Writing into a game's file copies it first and refuses while a game is
 *   running. That lives in `gameFile.ts` and is enforced there as well as here,
 *   so it holds whether or not this panel remembered to ask.
 */

import { Button } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Blocks, Download, Library, Pencil, Upload } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { barFormat } from "@/blueprint/bar";
import { appFileIO } from "@/blueprint/fileIO";
import { buildGridSnap } from "@/blueprint/footprint";
import type { ImportedBlueprint, ImportReport } from "@/blueprint/format";
import { mergeIntoGameFile } from "@/blueprint/gameFile";
import {
  footprintsFromUnits,
  scenarioSource,
  uniqueLayoutName,
} from "@/blueprint/library";
import {
  blueprintRoute,
  saveBlueprint,
  useBlueprintLibrary,
} from "@/blueprint/store";
import { blueprintPayload } from "@/blueprint/transfer";
import { knownUnits, unknownUnitsWarning } from "@/blueprint/units";
import type { UnitDatasetEntry } from "@/content/bindings";
import { useUnitsyncEngineConfig, useUnitsyncScan } from "@/content/config";
import { engineConfigDir, underConfigDir } from "@/content/enginePaths";
import { BlueprintEditor } from "@/placement/BlueprintEditor";
import { usePreferredTarget } from "@/play/config";
import { usePlay } from "@/play/PlayProvider";
import type { Scenario } from "../../model";
import { replaceBlueprint } from "./bases";
import { carryBlueprint } from "./blueprintImport";
import { EditorPanel } from "./panels";

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
  // What the last save landed as, so the panel can offer the way to it rather
  // than only saying it happened.
  const [kept, setKept] = useState<{ id: string; name: string } | null>(null);
  const { records } = useBlueprintLibrary();
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  // Where this engine writes, which is where the game keeps its blueprints
  // (issue #1435). Both dialogs open there, so the common case is one click,
  // and both still let the player go somewhere else: several engines or
  // several content roots means several of these files.
  const { data: engineConfig } = useUnitsyncEngineConfig(
    target?.enginePath,
    target?.dataDir,
  );
  const configDir =
    engineConfigDir(engineConfig?.configPath) ?? target?.dataDir;
  const gameFile = configDir
    ? underConfigDir(configDir, barFormat.file)
    : undefined;
  // Which layout is open in the map-free editor, if any. Held by id rather than
  // by value, so an edit lands back in the document and comes out of it again.
  const [editing, setEditing] = useState<string | null>(null);
  const openLayout = scenario.blueprints.find((b) => b.id === editing) ?? null;

  // Nothing here needs a participant any more, because nothing here places a
  // base. The Layouts mode asks whose the base is at the click that places it.
  const anyone = scenario.setup.participants.length > 0;

  async function onImport() {
    setError(null);
    setStatus(null);
    try {
      const src = await open({
        title: `Open ${barFormat.label}'s ${barFormat.file}`,
        multiple: false,
        // The file itself, which the dialog reads as its directory plus its
        // name, so a game that has never saved a blueprint still opens in the
        // right place with the right name filled in.
        defaultPath: gameFile,
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
      // The same dataset is what says whether this game has the units a layout
      // names at all, so both go in together or neither does.
      const snap = units.length > 0 ? buildGridSnap(units) : undefined;
      const known = units.length > 0 ? knownUnits(units) : undefined;
      setRead({ from: src, report: barFormat.read(text, snap, known) });
    } catch (e) {
      setError(message(e));
    }
  }

  /**
   * Take one layout out of the file, and put it nowhere (issue #1434).
   *
   * The scenario carries it and nothing on the map is drawn from it, which is
   * the state the contents list calls "not placed". It used to land at the
   * map's north-west corner, half off the map, because this panel has no map in
   * it to pick a point on. Where a base stands is the whole point of a base, so
   * the author places it with a click rather than finding it in a corner and
   * moving it.
   *
   * It does not arm the map either, which was asked for and decided against
   * (issue #1538). Three things leave a layout unplaced: a base deleted from
   * the map, a layout a shared scenario carries, and this one. They share one
   * route back onto the map, the pin under Contents, and a second route from
   * here would make the layout that came out of a file the special one for no
   * reason an author could state. A file also holds however many layouts it
   * holds and this panel stays open across them, so arming on each add would
   * change the map's mode under somebody still reading the file and keep only
   * the last one armed.
   */
  function onTake(imported: ImportedBlueprint) {
    onChange((current) =>
      carryBlueprint(current, imported.layout, crypto.randomUUID()),
    );
    setStatus(
      `"${imported.layout.name}" is in this scenario and is not placed yet. Put it on the map with Blueprints on the mode strip, or with the pin beside it under Contents.`,
    );
  }

  /**
   * Keep one of this scenario's layouts in the library (issue #1327).
   *
   * The geometry and nothing else. What a mission put on top of it, the team,
   * the origin, the trigger addressable ids and the factory queues, belongs to
   * a placement rather than to a shape, so none of it travels and all of it
   * stays in this scenario. The warning under the layout counts what that is.
   *
   * The footprints come from the game's units, which is what lets the library
   * card and the hub draw the layout at the right size, and are the one thing
   * that cannot be worked out later on a machine without the game.
   *
   * A def this game has not got is recorded without one rather than as one
   * build square (issue #1463). One square is what a reader draws an unstated
   * def as, so nothing is lost by saying nothing, and what is gained is that
   * the layout stops claiming a size for a unit nobody here could measure.
   *
   * The copy records which scenario it was lifted out of (issue #1473). A note
   * about this copy, on the library record rather than in the layout, so it
   * never travels when the layout is shared on.
   */
  async function onKeep(layoutId: string) {
    setError(null);
    setStatus(null);
    setKept(null);
    const layout = scenario.blueprints.find((b) => b.id === layoutId);
    if (!layout) return;
    try {
      setBusy(true);
      const name = uniqueLayoutName(
        layout.name,
        records.map((record) => record.layout.name),
      );
      const footprintOf = footprintsFromUnits(units);
      const saved = await saveBlueprint({
        id: crypto.randomUUID(),
        createdAt: "",
        updatedAt: "",
        layout: blueprintPayload(
          { ...layout, name },
          {
            footprintOf,
            gameName: scenario.setup.gameName,
            installed: scan.data?.games ?? [],
          },
        ),
        source: scenarioSource(
          { id: scenario.id, name: scenario.name },
          name === layout.name ? undefined : layout.name,
        ),
      });
      const unstated = footprintOf
        ? [...new Set(layout.buildings.map((b) => b.def))].filter(
            (def) => !footprintOf(def),
          )
        : [];
      setKept({ id: saved.id, name });
      setStatus(
        [
          `"${name}" is in your library.`,
          name === layout.name
            ? null
            : `A blueprint there was already called "${layout.name}".`,
          units.length === 0
            ? "This game's units have not been read, so nothing is recorded about how much ground its buildings stand on, and its picture draws each of them as one build square until it is saved again."
            : null,
          unstated.length > 0
            ? `This game has no ${unstated.join(", ")}, so nothing is recorded about how much ground ${unstated.length === 1 ? "it stands" : "they stand"} on and the picture draws ${unstated.length === 1 ? "it" : "them"} as one build square.`
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

  async function onSend(layoutId: string, layoutName: string) {
    setError(null);
    setStatus(null);
    const layout = scenario.blueprints.find((b) => b.id === layoutId);
    if (!layout) return;
    try {
      const dest = await save({
        title: `Write into ${barFormat.label}'s ${barFormat.file}`,
        defaultPath: gameFile ?? "blueprints.json",
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
      title="Blueprints in this scenario"
      icon={Blocks}
      summary={
        layouts.length === 0
          ? "Take a base out of a game, or send one back"
          : `${layouts.length} blueprint${layouts.length === 1 ? "" : "s"}`
      }
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          {/* Where the file lives, and nothing about how a game stores its
              blueprints. That paragraph named Beyond All Reason on every
              scenario, whatever game it was for, to explain a format an author
              never has to think about. */}
          <div className="space-y-1">
            {gameFile && (
              <p className="break-all text-[11px] text-muted-foreground">
                Both buttons open on{" "}
                <span className="font-mono">{gameFile}</span>, where{" "}
                {target?.engineVersion ?? "your engine"} writes. Pick another
                file if you keep your games somewhere else. A player who has
                never saved a base in game has no file there yet, and sending
                one writes it.
              </p>
            )}
          </div>
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
        {status && (
          <p className="text-xs text-muted-foreground">
            {status}
            {kept && (
              <>
                {" "}
                <Link
                  to={blueprintRoute(kept.id)}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Open it
                </Link>
                .
              </>
            )}
          </p>
        )}

        {read && (
          <FileContents
            from={read.from}
            report={read.report}
            anyone={anyone}
            onTake={onTake}
            onClose={() => setRead(null)}
          />
        )}

        {/* No heading of its own: the panel is called this now. */}
        <section className="space-y-2">
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
                        {/* A layout stays in the scenario after the last base
                            placed from it goes (#1424), so this list holds
                            layouts nothing on the map is drawn from. */}
                        {places.length === 0 ? " · not placed" : ""}
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
                        {editing === layout.id ? "Close" : "Edit the blueprint"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        disabled={busy || layout.buildings.length === 0}
                        onClick={() => void onKeep(layout.id)}
                      >
                        <Library className="mr-1 size-3.5" /> Save to your
                        library
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
                          A blueprint is a shape rather than a place, so this
                          draws on a build grid and loads no map. Editing it
                          here edits the blueprint itself, so every base placed
                          from it changes. To change one base only, drag its
                          buildings on the map above.
                        </p>
                        <BlueprintEditor
                          blueprint={openLayout}
                          gameName={scenario.setup.gameName}
                          // The page's history already covers these edits, and
                          // its buttons are on the map above. A second one here
                          // would take two steps back on one press (#1442).
                          history="caller"
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
                      // The same list either way out. A blueprint is geometry
                      // in coilbox's own library as much as in a game's file,
                      // so what a game cannot hold the library cannot either.
                      <p className="text-[11px] text-amber-200/80">
                        Sending or saving this strips {stripped.join(", ")}. A
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
  anyone,
  onTake,
  onClose,
}: {
  from: string;
  report: ImportReport;
  /** Whether the scenario has a participant yet. A layout arrives whether or
   *  not it has one, and placing it is what needs somebody to own the base. */
  anyone: boolean;
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
          There are no blueprints in this file coilbox can read.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {report.blueprints.map((imported, at) => {
            const buildings = imported.layout.buildings.length;
            // Every building of it, which is what another game's layout looks
            // like from here. Worth reading differently from a layout with one
            // unit missing, which is still most of a base.
            const foreign =
              imported.unknown.length > 0 &&
              imported.unknown.length >= buildings;
            const missing = unknownUnitsWarning(imported.unknown, buildings);
            return (
              <li
                // A file is free to hold two layouts of the same name, and
                // where it stands in the file is the only thing telling them
                // apart.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={`${at}-${imported.layout.name}`}
                className="space-y-1 rounded border border-border/40 bg-background px-2 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm">
                    {imported.layout.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {buildings} building
                    {buildings === 1 ? "" : "s"}
                    {imported.layout.ordered ? " · build order" : ""}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => onTake(imported)}
                  >
                    {foreign ? "Add it anyway" : "Add to this scenario"}
                  </Button>
                </div>
                {missing && (
                  <p
                    className={
                      foreign
                        ? "rounded bg-amber-950/60 px-2 py-1.5 text-[11px] text-amber-200"
                        : "text-[11px] text-amber-200/80"
                    }
                  >
                    {missing}
                  </p>
                )}
                <Changes imported={imported} />
              </li>
            );
          })}
        </ul>
      )}

      {!report.checked && report.blueprints.length > 0 && (
        <p className="text-[11px] text-amber-200/80">
          Coilbox has not read this game's units yet, so nothing here has been
          checked against them. This file holds every blueprint every game
          sharing a data directory has saved, and another game's looks exactly
          like this one's until the names are checked.
        </p>
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

      {!anyone && report.blueprints.length > 0 && (
        <p className="text-[11px] text-amber-200/80">
          This scenario has no participants yet. A blueprint can still be added,
          and putting one on the map cannot be done until there is somebody for
          the base to belong to. Add a participant in the setup above.
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
