/**
 * One tweak project, open: find a unit, change its numbers (issues #1270, #1271
 * and #2647).
 *
 * `/workshop/:id` is the project, and the unit is in the query string. A tweak
 * is a set of edits across several units and the person making it moves between
 * them constantly, so unmounting the whole page on every pick would throw away
 * everything the page has read. `?unit=` keeps the deep link a separate detail
 * route would have given.
 *
 * `/workshop/new?game=` is the same page with no project yet, which is where a
 * unit's encyclopedia page sends somebody who has picked a unit and no project
 * (issue #2696, and `routes.ts`). The first edit starts the project and the URL
 * becomes the project's own.
 *
 * The edits live in a saved project and are written as they are made (issue
 * #1282). There is no save button: everything writes into the open project and
 * closing the app loses nothing. `project.ts` holds the five stores and the
 * list, `history.ts` holds undo and redo over them, and `/workshop` is where a
 * project is started, renamed, copied, exported and deleted.
 *
 * There is no game picker. A project is one game's (issue #2664), so the game
 * is a property of what is open rather than a control on the page, and working
 * on another game is opening another project. The picker used to switch project
 * with it, which is the same thing said in one page instead of two.
 *
 * Two reads, joined on the lowercased def key. `--unit-defs` gives the fields,
 * and the curated dataset gives the name a person reads, which is not in the
 * def for every game (see `unitName.ts`). The join is the one #1269 keyed its
 * output for.
 *
 * The units the project adds are held apart from the edits it makes, for the
 * reason `clones.ts` gives, and joined onto the game's table for everything
 * else: one browser, one field list, one way to edit a field (issue #1272).
 *
 * A builder's build menu is held apart again, for the reason `buildMenus.ts`
 * gives: it is an ordered list the game still owns, so it is recorded as what
 * the user did to it rather than as the list that came out (issue #1274).
 *
 * Switching a unit off is a fourth store and deliberately not any of the other
 * three: it is a mark against a unit rather than an edit to anything, so it
 * writes nowhere else and switching the unit back on leaves every build menu
 * placement exactly where it was (issue #2649, and `disabled.ts`).
 *
 * A fifth store holds a renamed unit for a game that keeps its names in a
 * localisation file rather than in its unitdefs, which is what Beyond All
 * Reason does. That edit patches a JSON file rather than a unit table, so it
 * cannot be an override, and a game that does keep its names in the def has no
 * fifth store at all: its rename is an ordinary override on `name` or
 * `humanName` (issue #2650, and `unitText.ts`).
 *
 * A unit built in the lego builder and exported into this game's folder is a
 * sixth thing again, and the only one that is not a store: the file is in the
 * game whether this page is open or not, so it is read off the lego projects
 * each render rather than held anywhere (issue #2651, and `legoUnits.ts`).
 * Mostly it only marks a unit the game's own read already has, since the
 * exported definition is a file the engine loads like any other. That is what
 * answers #663, and it costs nothing extra: a unit in the def table is already
 * a unit the build menu editor can place. Being a fact about the folder rather
 * than an edit, it is the one thing on this page that never reaches the saved
 * project: it is not counted as a change, it is not written, and it cannot be
 * undone. Deleting the project leaves it exactly where it was.
 *
 * All five stores are scoped to one game, and so is the project that holds
 * them. An override is a patch against one game's own unit table, so it means
 * nothing under another game that happens to share a unit's internal name, and
 * one game's edits must never reach another's (issue #2664). Opening a project
 * is opening its game, so the two cannot meet.
 */
import { Button, buttonVariants, cn } from "@picoframe/frame";
import { ArrowLeft, Pencil, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ButtonGroup } from "@/components/ui/button-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { gameIdentityForName } from "@/container/gameIdentity";
import { assetIndex } from "@/content/assetKinds";
import {
  useScanTargetSelection,
  useUnitsyncArchiveTree,
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitBuildpics,
  useUnitsyncUnitDataset,
} from "@/content/config";
import {
  DiagnosticsButton,
  EmptyState,
  SkeletonList,
} from "@/content/pages/components/states";
import { UnitIcon } from "@/content/pages/components/UnitIcon";
import { buildTechForest } from "@/content/techForest";
import { useLegoProjects } from "@/lego/projects";
import { type AssetBrowsing, deriveAssetFields } from "../assetFields";
import {
  addToBuildMenu,
  applyBuildMenu,
  buildOptionsOf,
  clearBuildMenu,
  isBuilder,
  moveInBuildMenu,
  removeFromBuildMenu,
} from "../buildMenus";
import {
  addClone,
  deriveClone,
  migrateCloneText,
  removeClone,
  unitsWithClones,
} from "../clones";
import { useCustomParams, useUnitDefs } from "../config";
import { isUnitDisabled, setUnitDisabled } from "../disabled";
import { useEditHistory } from "../history";
import { withLegoUnits } from "../legoUnits";
import {
  asksAboutMovement,
  moveClassesOf,
  moveClassProblem,
} from "../moveClasses";
import {
  clearOverride,
  clearUnit,
  resolvedDef,
  setOverride,
} from "../overrides";
import {
  defaultProjectName,
  describeEdits,
  EMPTY_EDITS,
  editCounts,
  editSlot,
  type GameEdits,
  type ModProject,
  useModProjects,
} from "../project";
import { projectPath } from "../routes";
import { textRedirect, unitDisplayName } from "../unitName";
import { unitPicLookup } from "../unitPics";
import { type FieldView, unitFieldView } from "../unitSections";
import {
  BASE_LANGUAGE,
  baseLanguage,
  clearUnitText,
  clearUnitTexts,
  languageCodes,
  nameEdit,
  setUnitText,
  type TextField,
  textHome,
  unitTextCount,
  unitTextRows,
} from "../unitText";
import { BuildMenuPanel } from "./components/BuildMenuPanel";
import { CloneUnitButton, DeleteCloneButton } from "./components/CloneActions";
import { DisableUnitSwitch } from "./components/DisableUnitSwitch";
import { ProjectDetailsDrawer } from "./components/ProjectDetailsDrawer";
import { UnitFieldGroups } from "./components/UnitFieldGroups";
import type { FieldChoices } from "./components/UnitFieldRow";
import { UnitList } from "./components/UnitList";
import { UnitTextPanel } from "./components/UnitTextPanel";

/** A stable empty, so a page with no game does not re-derive on every render. */
const NO_UNITS: Record<string, Record<string, unknown>> = {};

export default function UnitPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { selected } = useScanTargetSelection();
  const scan = useUnitsyncScan(selected?.enginePath, selected?.rootPath);

  // The saved projects, which is where every edit on this page lands. Five
  // stores that each used to key themselves by game and prune an emptied entry
  // are now five slots inside one project, so the keying and the pruning happen
  // once here rather than five times in this file (see `project.ts`).
  const {
    projects,
    createProject,
    applyEdits,
    setEdits,
    recordAuthoredChecksum,
    updateProjectDetails,
  } = useModProjects();
  const history = useEditHistory();
  /** Whether the details drawer is up to rename the open project (issue #2711). */
  const [renaming, setRenaming] = useState(false);

  // Which project is open. The route says so, except on `/workshop/new`, where
  // there is no project yet and the game comes from the link that sent us here.
  // `new` is a value of the same param rather than a route of its own, so the
  // first edit changes the URL without remounting the page and taking the
  // game's whole unit table down with it. No project's id can collide with it:
  // they are uuids.
  const { id: routeId } = useParams();
  const project = projects.find((p) => p.id === routeId);
  /** Whether the route names a project that is not in the list any more. */
  const missing = routeId !== "new" && !project;

  const games = scan.data?.games ?? [];
  const gameName = project?.gameName ?? params.get("game") ?? "";
  const game = games.find((g) => g.name === gameName);
  const unitKey = params.get("unit") ?? "";

  const { defs, status, error, reload } = useUnitDefs(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );

  // The names, from the read that already answers for a game whose defs carry
  // none. Cheap next to the def table and cached for the session by its own
  // hook, and the list renders off the def table meanwhile rather than waiting.
  const { dataset } = useUnitsyncUnitDataset(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );
  const named = useMemo(
    () => new Map((dataset?.units ?? []).map((u) => [u.name, u])),
    [dataset],
  );

  // What each custom parameter means, which is only ever "whatever this game's
  // Lua does with it". Runs alongside the defs rather than after them: nothing
  // on the page waits for it, and a row whose scan has not landed simply has no
  // note yet. Keyed by the game's own archive name inside the hook, so it
  // switches with `game` the same way `defs` does.
  const { consumers } = useCustomParams(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );

  const projectId = project?.id ?? "";
  const edits = project?.edits ?? EMPTY_EDITS;
  // `clones` is deliberately not taken here. The project owns the units copied
  // on this page, and the name `clones` belongs to that set plus the units the
  // lego builder put in the game folder, which the project must never hold.
  const { overrides, menus, text, disabled } = edits;
  const ownClones = edits.clones;

  /**
   * Record one change, as one undo step.
   *
   * Every edit on the page goes through here, so an action that touches four
   * stores at once (deleting a copied unit) is still one press of undo, and an
   * edit that turned out to change nothing costs no step at all: all five
   * stores return what they were given when there is nothing to record,
   * `editSlot` passes that through, and `applyEdits` writes nothing and reports
   * nothing to record.
   */
  const commit = (update: (current: GameEdits) => GameEdits) => {
    // Nothing to write into yet. The change is tried against an empty project
    // first, so blurring a field nobody touched does not leave a project behind.
    if (!project && update(EMPTY_EDITS) === EMPTY_EDITS) return;
    const target =
      project ??
      startProject(defaultProjectName(gameName, projects), EMPTY_EDITS);
    const changed = applyEdits(target.id, update);
    if (changed) history.push(target.id, changed.before);
  };

  /**
   * Make a project for this game and open it, which is what the first edit on
   * `/workshop/new` does. The URL becomes the project's own, replacing rather
   * than pushing so that going back leaves the workshop rather than landing on
   * a `/workshop/new` that would start a second empty project.
   */
  const startProject = (name: string, edits: GameEdits): ModProject => {
    const started = createProject({
      name,
      gameName,
      game: gameIdentityForName(gameName, games) ?? undefined,
      authoredChecksum: defs?.checksum,
      edits,
    });
    pathRef.current = started.id;
    navigate(projectPath(started.id, unitKey), { replace: true });
    return started;
  };

  /** Change exactly one of the five stores, which is most of what the page does. */
  const editing =
    <K extends keyof GameEdits>(slot: K) =>
    (update: (current: GameEdits[K]) => GameEdits[K]) =>
      commit((current) => editSlot(current, slot, update));
  const updateOverrides = editing("overrides");
  const updateMenus = editing("menus");
  const updateText = editing("text");
  const updateDisabled = editing("disabled");

  const [view, setView] = useState<FieldView>("relevant");

  const gameUnits = defs?.units ?? NO_UNITS;

  // Every unit built in the lego builder and exported into this game's folder
  // (issue #2651). Derived rather than seeded into the state above, for the
  // reason `legoUnits.ts` gives: a lego unit is a file already sitting in the
  // game, so it is a fact to read each time rather than an edit somebody made
  // on this page and could lose. Mostly it only attributes a unit the game's
  // own read already has, since the exported file is a file in the game.
  const { projects: legoProjects } = useLegoProjects();
  const built = useMemo(
    () =>
      withLegoUnits(
        ownClones,
        legoProjects,
        game?.primaryArchive.path,
        gameUnits,
      ),
    [ownClones, legoProjects, game, gameUnits],
  );
  const clones = built.clones;

  // The curated dataset describes the game's units, so it is not asked about
  // one of ours: a copy that stands in for `armcom` would otherwise be handed
  // the game's name for `armcom` and show it instead of the one it was given.
  //
  // A name the user has typed wins over all of it, so every list, heading,
  // roster and picker on this page calls the unit what its owner calls it
  // (issue #2650). It travels with the project, so an export carries the name
  // and so does a copy of the project.
  const nameOf = useCallback(
    (key: string, def: Record<string, unknown> | undefined) => {
      // The unit this def borrows its name from, where it borrows one
      // (issue #2686). A copy is asked the same question as the unit it was
      // copied from, because the redirect travels with the def.
      const borrowed = textRedirect(def);
      return (
        nameEdit(key, def, overrides, text)?.trim() ||
        unitDisplayName(
          key,
          def,
          clones[key] ? undefined : named.get(key),
          borrowed === undefined ? undefined : named.get(borrowed),
        )
      );
    },
    [named, clones, overrides, text],
  );

  const units = useMemo(
    () => unitsWithClones(gameUnits, clones),
    [gameUnits, clones],
  );

  // The archive behind the game, so a field that names a file in it can offer
  // the file rather than ask for a path (issue #2648). The listing is the one
  // the archive browser already uses and is cached per archive for the session,
  // so a second visit to the page costs nothing. Nothing on the page waits for
  // it: until it lands, the fields are plain text boxes.
  const { tree } = useUnitsyncArchiveTree(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );
  const index = useMemo(() => assetIndex(tree?.files ?? []), [tree]);
  // Read off the game's own table rather than off `units`, so adding a copy of
  // a unit does not send the whole game's definitions round again. A copy is a
  // copy of a game unit, so it has nothing to add about which fields are paths.
  const derivedAssets = useMemo(
    () => deriveAssetFields(gameUnits, index),
    [gameUnits, index],
  );
  const assets: AssetBrowsing | undefined =
    game && selected
      ? {
          index,
          derived: derivedAssets,
          archive: game.primaryArchive.name,
          archiveLabel: game.name,
          enginePath: selected.enginePath,
          dataDir: selected.rootPath,
        }
      : undefined;
  const unit = units[unitKey];
  const clone = clones[unitKey];
  /** The lego project this unit came out of, when it came out of one. */
  const builtBy = built.builtBy[unitKey];
  // The unit as the page has it, edits and all. The movement fields need it
  // because they are about each other, and both are usually the two somebody
  // has just changed.
  const edited = useMemo(
    () => resolvedDef(unit, overrides[unitKey]),
    [unit, overrides, unitKey],
  );
  const fields = useMemo(
    () =>
      unitFieldView(
        unit,
        overrides,
        unitKey,
        view,
        asksAboutMovement(edited) ? ["movementClass"] : [],
      ),
    [unit, overrides, unitKey, view, edited],
  );

  // What this game's units actually move on, so the class is picked out of a
  // list rather than spelled from memory against a file nobody has open (issue
  // #2651). Off the game's own table, never the one with our units in it: a
  // built unit has nothing to say about which classes exist.
  const moveClasses = useMemo(() => moveClassesOf(gameUnits), [gameUnits]);
  const choices = useMemo((): Record<string, FieldChoices> | undefined => {
    if (moveClasses.length === 0) return undefined;
    return {
      movementclass: {
        placeholder: "Does not move",
        unknownLabel: () => `No unit in ${gameName} moves on this`,
        options: moveClasses.map((c) => ({
          value: c.name,
          label: c.name,
          description: `${c.units} unit${c.units === 1 ? "" : "s"}`,
        })),
      },
    };
  }, [moveClasses, gameName]);
  const warnings = useMemo(() => {
    const problem = moveClassProblem(edited);
    return problem ? { movementclass: problem } : undefined;
  }, [edited]);

  // What the game's own localisation files call its units, which for a game
  // like BAR is the only place a name or a description exists at all. One entry
  // per translation the game ships (issue #2672).
  const texts = useMemo(() => defs?.languageText ?? {}, [defs]);
  // Asked of the game's own units, never the table with our copies in it, for
  // the reason `textHome` gives. A copy is always its own definition's problem.
  const gameTextHome = useMemo(
    () => textHome(gameUnits, texts),
    [gameUnits, texts],
  );
  // The game's answer, for a unit we added as much as for one it shipped. A
  // copy used to be told its name was in its own definition, which is where the
  // engine reads one but not where Beyond All Reason does (issue #2673).
  const home = gameTextHome;
  // The languages on offer and the one on screen. Held here rather than in the
  // panel so that moving to another unit keeps the language you were working
  // in: translating a game is done a language at a time, not a unit at a time.
  const languages = useMemo(() => languageCodes(texts), [texts]);
  const [language, setLanguage] = useState(BASE_LANGUAGE);
  // A game with no translations, or one that has dropped the locale you were
  // in, answers in the base language rather than in a code it does not ship.
  const shownLanguage = languages.includes(language)
    ? language
    : baseLanguage(texts);
  const textRows = useMemo(
    () =>
      unitTextRows({
        unitKey,
        def: unit,
        home,
        texts,
        language: shownLanguage,
        overrides,
        edits: text,
      }),
    [unitKey, unit, home, texts, shownLanguage, overrides, text],
  );

  // A copy made before #2673 put its name in its own definition, which in a
  // game like Beyond All Reason is a key nothing reads. Saved projects hold
  // copies like that and nothing on this page looks wrong, because this page
  // reads the definition, so the move happens on the first render that knows
  // which home the game uses rather than waiting for the user to notice a name
  // that is only wrong in the game. `migrateCloneText` answers `null` once
  // there is nothing left to move, which is every render after the first, so
  // the effect settles rather than writing again.
  const pendingCloneText = useMemo(
    () => migrateCloneText(ownClones, text, home, texts),
    [ownClones, text, home, texts],
  );
  const migrateRef = useRef<() => void>(() => {});
  migrateRef.current = () => {
    commit((current) => {
      const moved = migrateCloneText(current.clones, current.text, home, texts);
      if (!moved) return current;
      const next = editSlot(current, "clones", () => moved.clones);
      return editSlot(next, "text", () => moved.text);
    });
  };
  useEffect(() => {
    if (pendingCloneText) migrateRef.current();
  }, [pendingCloneText]);

  /** Rename the unit, or rewrite its tooltip, wherever this game keeps them. */
  const commitText = (field: TextField, value: string) => {
    const row = textRows[field];
    // A def that hands its lookup to another unit has no keys of its own to
    // write, so the panel offers no box and nothing can arrive here.
    if (row.redirect !== undefined) return;
    if (row.path === undefined) {
      updateText((t) =>
        setUnitText(t, unitKey, shownLanguage, field, value, row.inherited),
      );
      return;
    }
    const path = row.path;
    // Emptying a box the game never filled is not an edit, it is the box going
    // back to how it was found. Every other case is `setOverride`'s to decide.
    if (value === "" && !row.present) {
      updateOverrides((o) => clearOverride(o, unitKey, path));
      return;
    }
    updateOverrides((o) =>
      setOverride(o, unitKey, path, value, row.inheritedValue),
    );
  };

  const resetText = (field: TextField) => {
    const path = textRows[field].path;
    if (path === undefined)
      updateText((t) => clearUnitText(t, unitKey, shownLanguage, field));
    else updateOverrides((o) => clearOverride(o, unitKey, path));
  };

  // What the build menu picker offers: the game's own dataset, with the
  // project's units in among it rather than in a list of their own, which is
  // what makes a copied unit addable at all (issue #1272 into #1274). A copy
  // standing in for a game unit takes that unit's entry, the same way it takes
  // its place in the def table.
  const pickerUnits = useMemo(() => {
    const byName = new Map(
      (dataset?.units ?? []).map((u) => [u.name.toLowerCase(), u]),
    );
    for (const clone of Object.values(clones)) {
      const borrowed = textRedirect(clone.def);
      byName.set(clone.key, {
        name: clone.key,
        fullName: unitDisplayName(
          clone.key,
          clone.def,
          undefined,
          borrowed === undefined ? undefined : byName.get(borrowed),
        ),
        buildOptions: buildOptionsOf(clone.def),
      });
    }
    return [...byName.values()];
  }, [dataset, clones]);

  // Every unit's build picture, in one read for the whole game (issue #2692).
  // Both lists on the page draw from it, and so does the build menu's add
  // picker, which used to mount the game's archives and decode the lot a second
  // time on its own the moment it was opened.
  //
  // Over the game's own units and never the table with our copies in it. The
  // read is cached on the id set it was asked for, so a list that grew by one
  // every time somebody copied a unit would send all 564 round again for the
  // sake of one name unitsync has never heard of.
  const picIds = useMemo(() => Object.keys(gameUnits), [gameUnits]);
  const buildpics = useUnitsyncUnitBuildpics(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
    picIds,
  );
  // No pictures yet is not the same as no pictures: until the read lands a row
  // says nothing either way, rather than claiming the game ships none.
  const picsPending = !buildpics && picIds.length > 0;
  const picOf = useMemo(
    () => unitPicLookup({ buildpics, clones, units, overrides }),
    [buildpics, clones, units, overrides],
  );

  // Which side reaches each unit, which is the game's own answer and the only
  // thing that tells Beyond All Reason's four "Advanced Aircraft Plant" rows
  // apart. One walk for the page: the left-hand list names the side on the row,
  // and a builder's roster uses the same answer to mark a unit from another one.
  const { info: gameInfo } = useUnitsyncGameInfo(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );
  const sides = useMemo(
    () => (gameInfo?.sides ?? []).filter((s) => !!s.startUnit),
    [gameInfo],
  );
  const forest = useMemo(
    () =>
      buildTechForest(
        pickerUnits,
        sides.map((s) => s.startUnit as string),
      ),
    [pickerUnits, sides],
  );
  const factionOf = useCallback(
    (key: string): string | undefined => {
      // A one-sided game answers nothing, because the same word on all 379 rows
      // tells nobody anything. Neither does a unit no side's build graph
      // reaches, which includes every unit copied or built here: the game has
      // no opinion about a unit it has never seen, and the row's own "added" or
      // "built" mark already says whose it is.
      if (sides.length < 2) return undefined;
      const root = forest.factionOf.get(key);
      if (root === undefined) return undefined;
      return (
        sides.find((s) => s.startUnit?.toLowerCase() === root)?.name ?? root
      );
    },
    [forest, sides],
  );

  const inheritedMenu = useMemo(() => buildOptionsOf(unit), [unit]);
  const menuOps = menus[unitKey];
  const currentMenu = useMemo(
    () => applyBuildMenu(inheritedMenu, menuOps ?? []),
    [inheritedMenu, menuOps],
  );

  /**
   * Which project the URL is for, ahead of the render that will say so.
   *
   * Copying a unit starts a project and then selects the copy, both in one
   * handler. The second write reads the location the handler started at, so
   * without this it would put the URL back on `/workshop/new` and lose the
   * project the first write had just made.
   */
  const pathRef = useRef(routeId);
  pathRef.current = routeId;

  // Replaces rather than pushes, so backing out of the page does not walk
  // through every unit that was looked at on the way.
  const select = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params);
    // Once a project is open the game comes from the project, so carrying the
    // one the link arrived with would leave a parameter nothing reads.
    if (pathRef.current !== "new") merged.delete("game");
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    navigate(`/workshop/${pathRef.current}?${merged}`, { replace: true });
  };

  /**
   * Record what the game checksums to for a project that has no answer yet,
   * which is one started from the list against a game nobody had read (issue
   * #2696). Once only, and never over an answer the project already has: see
   * `recordAuthoredChecksum`.
   *
   * Held in a ref so the effect fires on the read landing rather than on every
   * render the project list changes in, which while editing is all of them.
   */
  const checksumRef = useRef<(checksum: string) => void>(() => {});
  checksumRef.current = (checksum: string) => {
    if (project && project.authoredChecksum === undefined)
      recordAuthoredChecksum(project.id, checksum);
  };
  useEffect(() => {
    if (defs?.checksum) checksumRef.current(defs.checksum);
  }, [defs?.checksum]);

  // The override set and the text set both count as changes, because to the
  // person who made them they are the same thing: an edit to a unit. Only where
  // it lands differs.
  const counts = editCounts(edits);
  const unitEdits =
    Object.keys(overrides[unitKey] ?? {}).length + unitTextCount(text, unitKey);
  // Only the ones copied here. A unit the lego builder exported is already a
  // file in the game folder, so counting it as a project edit would have the
  // project claim work the user never did, and go stale against the file the
  // moment it is edited by hand. `editCounts` reads the project's own stores,
  // so it never sees one.
  //
  // Counted apart from the stale ones beside them (issue #2680). A name a
  // rename left behind is a unit in the game and belongs in this line, but
  // calling it built would say the user meant to put it there.
  const origins = Object.values(built.builtBy);
  const builtCount = origins.filter((origin) => !origin.stale).length;
  const staleCount = origins.length - builtCount;
  const unitDisabled = isUnitDisabled(disabled, unitKey);
  const anythingChanged =
    counts.fields > 0 ||
    counts.added > 0 ||
    counts.menuOps > 0 ||
    counts.off > 0;
  const anythingToShow = anythingChanged || origins.length > 0;

  /**
   * Copy the selected unit, as the project has it, under a new name.
   *
   * Two stores in one commit, because in a game like Beyond All Reason the
   * copy's name is not part of its definition: `deriveClone` hands back the
   * definition and, separately, the words that belong in the localisation file
   * instead. One commit so undo takes the copy and its name away together.
   */
  const createClone = (key: string, displayName: string, replaces: boolean) => {
    if (!unit) return;
    const { clone: made, text: words } = deriveClone({
      key,
      source: unitKey,
      sourceDef: unit,
      patch: overrides[unitKey],
      displayName,
      replacesGameUnit: replaces,
      home,
      texts,
    });
    commit((current) => {
      const next = editSlot(current, "clones", (c) => addClone(c, made));
      if (Object.keys(words).length === 0) return next;
      return editSlot(next, "text", (t) => ({ ...t, [key]: words }));
    });
    select({ unit: key });
  };

  /**
   * Take one of ours back out, edits and all: nothing else refers to it.
   *
   * Four stores in one commit, so one press of undo brings the unit back with
   * everything that was on it. Four separate commits would have put the copy
   * back stripped of its own edits, which is the failure per-store undo stacks
   * would have made unavoidable (see `history.ts`).
   */
  const deleteClone = () => {
    commit((current) => {
      let next = editSlot(current, "clones", (c) => removeClone(c, unitKey));
      next = editSlot(next, "overrides", (o) => clearUnit(o, unitKey));
      next = editSlot(next, "text", (t) => clearUnitTexts(t, unitKey));
      // The mark goes with it. A unit that no longer exists cannot be switched
      // off, and an entry naming one is the empty-entry trap the other three
      // stores prune for.
      return editSlot(next, "disabled", (d) =>
        setUnitDisabled(d, unitKey, false),
      );
    });
    select({ unit: "" });
  };

  /** Put the open project back one step, or forward one. */
  const undo = () => {
    if (!project) return;
    const previous = history.undo(project.id, edits);
    if (previous) setEdits(project.id, previous);
  };
  const redo = () => {
    if (!project) return;
    const next = history.redo(project.id, edits);
    if (next) setEdits(project.id, next);
  };

  // The usual keys, and only outside a text box: a browser undoes typing in an
  // input on its own, and taking that over would make a half-typed number
  // impossible to correct without losing an unrelated edit.
  const shortcut = useRef({ undo, redo });
  shortcut.current = { undo, redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      if (e.shiftKey) shortcut.current.redo();
      else shortcut.current.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Whether the game has moved on since the project was started (issue #1281). */
  const gameMoved =
    project?.authoredChecksum !== undefined &&
    defs?.checksum !== undefined &&
    project.authoredChecksum !== defs.checksum;

  // `h-full` against the frame's own scroll container, so from `lg` up the two
  // panes each take the height that is left and scroll themselves rather than
  // the whole page scrolling as one. Below `lg` they stack and the frame
  // scrolls, which is why the height is not claimed there.
  return (
    <div className="flex flex-col gap-4 p-4 lg:h-full lg:min-h-0">
      <PageHeader
        // The way back to the list, as the small link every other detail page
        // in the app draws above its title. It was a Projects button down in
        // the body, which is the one place nothing else in coilbox puts one
        // (issue #2708).
        back={
          <Link
            to="/workshop"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ArrowLeft className="size-3.5" /> Projects
          </Link>
        }
        title={project ? project.name : "Unit tweaks"}
        // One paragraph, which includes which game is being edited and where
        // the edits go. There is no save button, so it says so rather than
        // leaving somebody to wonder.
        //
        // It used to end by saying a unit can be copied and put on a builder's
        // menu. That is two lines of the window, kept for the life of the page,
        // describing the Copy unit button a few pixels away. What is left is
        // the part that is not on screen anywhere: a project records only what
        // you changed.
        description={`${
          project
            ? `Change a unit's numbers in ${project.gameName}, saved as you work.`
            : gameName
              ? `Change a unit's numbers in ${gameName}. The first change starts a project.`
              : "Change a unit's numbers. No project is open."
        } Only the fields you change are recorded, so the rest still follow the game when it updates.`}
        actions={
          <>
            {/* What is in the project, beside the buttons that step through it:
              a status rather than an action, and the thing undo acts on. First
              in a row pinned to the right, so its width changing as edits are
              made or undone moves nothing to the right of it (issue #2710). */}
            {anythingToShow && (
              <span className="text-xs text-muted-foreground">
                {[
                  anythingChanged && describeEdits(edits),
                  builtCount > 0 &&
                    `${builtCount} built unit${builtCount === 1 ? "" : "s"}`,
                  staleCount > 0 && `${staleCount} left behind by a rename`,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            )}
            {/* One control with two directions rather than two buttons that
              happen to sit together. */}
            <ButtonGroup>
              <Button
                variant="outline"
                size="sm"
                disabled={!history.canUndo(projectId)}
                onClick={undo}
                aria-label="Undo"
                title="Undo the last change"
              >
                <Undo2 className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!history.canRedo(projectId)}
                onClick={redo}
                aria-label="Redo"
                title="Redo the change you undid"
              >
                <Redo2 className="size-3.5" />
              </Button>
            </ButtonGroup>
            {/* What unitsync said while reading this game's defs. It used to be
              a panel below everything else, which on a page that claims the
              window height and scrolls its two panes inside it meant a strip of
              the bottom edge gone for the session (issue #2667). Only once a
              game is picked: with none there is no read to report on. */}
            {game && status !== "error" && (
              <DiagnosticsButton
                errors={defs?.unitErrors ?? []}
                checking={status !== "ready"}
                title={`Diagnostics for ${game.name}`}
                description="What unitsync said while reading this game's unit definitions."
              />
            )}
            {/* Renaming the project you are working in (issue #2711). You find
              out a name is wrong while you are under it, and until this the
              only way to change it was to go back to the list and find the
              card again.

              Last in the row, because the two controls before it act on the
              edits and this acts on the document that holds them, which is the
              same split the scenario editor's header makes. A button rather
              than an editable heading: the heading is the one thing on the row
              whose width already changes, and turning it into a field on a
              press is exactly the layout shift #2710 went and removed. */}
            {project && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRenaming(true)}
                title="Rename this project, or change what it says it is for"
              >
                <Pencil className="mr-1 size-3.5" />
                Rename
              </Button>
            )}
          </>
        }
      />

      {/* The list's own form, not a second one: the fields, the defaults and
        the one call that writes both are `ProjectDetailsDrawer`'s, so a rename
        here and a rename from a card cannot drift apart. */}
      {project && (
        <ProjectDetailsDrawer
          open={renaming}
          onOpenChange={setRenaming}
          project={project}
          games={games}
          scanning={scan.loading}
          existing={projects}
          onSubmit={(details) => {
            updateProjectDetails(project.id, details);
            setRenaming(false);
          }}
        />
      )}

      {/* The game's archives no longer checksum to what they did when this
        project was started, so something under the edits has moved. Said and
        nothing more: which edits it actually broke, and what to do about them,
        is issue #1281's job and needs the whole game read to answer. */}
      {gameMoved && (
        <Alert>
          <AlertDescription>
            {game?.name} has changed since this project was started. The edits
            still apply, but anything they name may have moved.
          </AlertDescription>
        </Alert>
      )}

      {built.conflicts.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>
            {built.conflicts.length} built unit
            {built.conflicts.length === 1 ? " is" : "s are"} not shown
          </AlertTitle>
          <AlertDescription>
            {built.conflicts.join(", ")} exported into {game?.name} under a name
            another unit here already uses. Rename the unit in the builder and
            export again, or take the other one out.
          </AlertDescription>
        </Alert>
      )}

      {scan.error && !scan.data && (
        <Alert variant="destructive">
          <AlertDescription className="break-words">
            {scan.error}
          </AlertDescription>
        </Alert>
      )}

      {missing ? (
        // A link to a project that has been deleted, or one from a machine that
        // never had it. Nothing is started in its place: the edits it named are
        // gone, and an empty project under the same link would say they were not.
        <EmptyState label="That project is not on this machine. Pick one under Unit tweaks." />
      ) : !game ? (
        <EmptyState
          label={
            scan.loading
              ? "Scanning for installed games…"
              : games.length === 0
                ? "No games are installed. Add one from the Library."
                : gameName
                  ? // An imported project naming a game this machine has not
                    // got. Its edits are safe, there is just nothing to apply
                    // them against until the game is installed.
                    `${gameName} is not installed here, so there are no units to show. The project's edits are kept.`
                  : "Start a project under Unit tweaks to edit a game's units."
          }
        />
      ) : status === "error" ? (
        <Alert
          variant="destructive"
          className="flex items-center justify-between gap-3"
        >
          <span className="break-words">
            {error ?? "This game's unit definitions could not be read."}
          </span>
          <Button variant="outline" size="sm" onClick={reload}>
            Retry
          </Button>
        </Alert>
      ) : status !== "ready" || !defs ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Reading every unit definition in {game.name}. This mounts the game's
            archives and can take a while the first time.
          </p>
          <SkeletonList />
        </div>
      ) : (
        <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <UnitList
            units={units}
            selected={unitKey}
            overrides={overrides}
            text={text}
            clones={clones}
            builtBy={built.builtBy}
            menus={menus}
            disabled={disabled}
            nameOf={nameOf}
            picOf={picOf}
            picsPending={picsPending}
            factionOf={factionOf}
            onSelect={(key) => select({ unit: key })}
          />

          {!unit ? (
            <EmptyState label="Pick a unit to see its fields." />
          ) : (
            <div className="flex min-w-0 flex-col gap-3 lg:min-h-0">
              {/* Who the unit is on the left, everything that acts on it on the
                right, and what is worth saying about it underneath.

                One row for the controls or, once they no longer fit beside the
                name, one row under it: `shrink-0` keeps them together so they
                drop as a block rather than half of them wrapping, and their own
                `flex-wrap` is the last resort at a width where a single line
                would run off the edge. Which of those happens depends on the
                window and on the unit's name, never on the state of a control.

                Nothing that changes when a control is pressed is inside this
                row (issue #2710). The note a disabled unit gets used to sit
                under the unit's key, in the left half, where it widened that
                half and wrapped the controls beside it onto their own line, so
                the switch that had just been pressed was somewhere else. It is
                below the whole row now. So is the field count, which the
                Relevant/All toggle changes the width of: it is a fact about the
                list below rather than a control, and beside the toggle it moved
                the toggle. The three controls that come and go are first, so a
                copy taking the details link away and putting the delete button
                there moves nothing that was pressed. */}
              <div className="flex flex-col gap-2 lg:shrink-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    {/* The same picture the row in the list beside it draws, off
                      the same whole-game read (issue #2692). The two halves of
                      the screen used to disagree: every row had a picture and
                      the heading for the row you had picked had none. Bigger
                      than the list's own, and bigger than it was, because it
                      stands against a name, a key and a row of controls. */}
                    <UnitIcon
                      display={picOf(unitKey)}
                      pending={picsPending}
                      size="xl"
                    />
                    <div className="flex flex-col">
                      <h2 className="text-base font-semibold">
                        {nameOf(unitKey, unit)}
                      </h2>
                      <span className="font-mono text-xs text-muted-foreground">
                        {unitKey}
                      </span>
                    </div>
                  </div>

                  <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
                    {/* A copy the project added has no entry of its own in the
                        game's real unit dataset, so there is nothing for this
                        to open there (issue #2652). Every game unit, including
                        one a clone replaces, still has one. */}
                    {!clone && (
                      <Link
                        to={`/library/games/${encodeURIComponent(game.name)}/units/${encodeURIComponent(unitKey)}`}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                        )}
                      >
                        View unit details
                      </Link>
                    )}
                    {/* Only a unit copied here. Taking a built one out would
                      have to delete a file in the game folder, which is the
                      builder's export to undo and not this page's. */}
                    {clone && !clone.origin && (
                      <DeleteCloneButton
                        name={nameOf(unitKey, unit)}
                        edits={unitEdits}
                        onDelete={deleteClone}
                      />
                    )}
                    {unitEdits > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        // One commit over both stores, so undoing a reset brings
                        // back every edit it cleared rather than half of them.
                        onClick={() =>
                          commit((current) =>
                            editSlot(
                              editSlot(current, "overrides", (o) =>
                                clearUnit(o, unitKey),
                              ),
                              "text",
                              (t) => clearUnitTexts(t, unitKey),
                            ),
                          )
                        }
                      >
                        <RotateCcw className="size-3.5" />
                        Reset {unitEdits} change{unitEdits === 1 ? "" : "s"}
                      </Button>
                    )}
                    <DisableUnitSwitch
                      unitKey={unitKey}
                      unitName={nameOf(unitKey, unit)}
                      disabled={unitDisabled}
                      onChange={(off) =>
                        updateDisabled((d) => setUnitDisabled(d, unitKey, off))
                      }
                    />
                    <CloneUnitButton
                      sourceKey={unitKey}
                      sourceName={nameOf(unitKey, unit)}
                      gameUnits={gameUnits}
                      clones={clones}
                      nameOf={nameOf}
                      onCreate={createClone}
                    />
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      size="sm"
                      value={view}
                      onValueChange={(v) => v && setView(v as FieldView)}
                      aria-label="Which fields to show"
                    >
                      <ToggleGroupItem value="relevant">
                        Relevant
                      </ToggleGroupItem>
                      <ToggleGroupItem value="all">All</ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </div>

                {/* How much of the unit the list below is showing. Under the
                  row and against its right edge, so it reads with the toggle it
                  belongs to without being able to move it. */}
                <span className="self-end text-xs text-muted-foreground">
                  {view === "relevant"
                    ? `${fields.shown} shown, ${fields.hidden} hidden`
                    : `${fields.shown} shown`}
                </span>

                {/* What is true of this unit: where it came from, and whether
                  it is switched off. The width cap is for reading length now,
                  not for holding a row together. */}
                {builtBy ? (
                  builtBy.stale ? (
                    <p className="max-w-prose text-xs text-destructive">
                      Left behind when {builtBy.projectName} was renamed. Its
                      files are still in {game.name}, so the game has this unit
                      and the renamed one. The unit builder's export drawer
                      clears them.
                    </p>
                  ) : (
                    <p className="max-w-prose text-xs text-muted-foreground">
                      Built in the unit builder as {builtBy.projectName} and
                      exported into {game.name}
                      {clone
                        ? ". Not in this game's definitions yet, so this is what the export wrote."
                        : ""}
                    </p>
                  )
                ) : (
                  clone && (
                    <p className="max-w-prose text-xs text-muted-foreground">
                      {clone.replacesGameUnit
                        ? `Yours, copied from ${clone.source}, in place of the game's own`
                        : `Yours, copied from ${clone.source}`}
                    </p>
                  )
                )}
                {unitDisabled && (
                  <p className="max-w-prose text-xs text-muted-foreground">
                    Disabled: it comes off every build menu when this is
                    compiled. The definition is kept, so switching it back on
                    restores it.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
                <UnitTextPanel
                  rows={textRows}
                  home={home}
                  isClone={clone !== undefined}
                  languages={languages}
                  language={shownLanguage}
                  onLanguage={setLanguage}
                  onChange={commitText}
                  onReset={resetText}
                />
                {isBuilder(unit) && (
                  <BuildMenuPanel
                    builderKey={unitKey}
                    builderName={nameOf(unitKey, unit)}
                    inherited={inheritedMenu}
                    menu={currentMenu}
                    edited={(menuOps?.length ?? 0) > 0}
                    units={pickerUnits}
                    clones={clones}
                    disabled={disabled}
                    nameOf={(key) => nameOf(key, units[key])}
                    picOf={picOf}
                    picsPending={picsPending}
                    buildpics={buildpics}
                    factionOf={factionOf}
                    gameName={game.name}
                    gameArchive={game.primaryArchive.name}
                    enginePath={selected?.enginePath}
                    dataDir={selected?.rootPath}
                    onAdd={(target) =>
                      updateMenus((m) =>
                        addToBuildMenu(m, unitKey, target, inheritedMenu),
                      )
                    }
                    onRemove={(target) =>
                      updateMenus((m) =>
                        removeFromBuildMenu(m, unitKey, target, inheritedMenu),
                      )
                    }
                    onMove={(target, delta) =>
                      updateMenus((m) =>
                        moveInBuildMenu(
                          m,
                          unitKey,
                          target,
                          delta,
                          inheritedMenu,
                        ),
                      )
                    }
                    onReset={() =>
                      updateMenus((m) => clearBuildMenu(m, unitKey))
                    }
                  />
                )}
                <UnitFieldGroups
                  view={fields}
                  consumers={consumers}
                  assets={assets}
                  choices={choices}
                  warnings={warnings}
                  inheritedLabel={
                    clone
                      ? clone.origin
                        ? "Exported value"
                        : "Copied value"
                      : builtBy
                        ? "Value in the game"
                        : undefined
                  }
                  onChange={(row, value) =>
                    updateOverrides((o) =>
                      setOverride(o, unitKey, row.path, value, row.inherited),
                    )
                  }
                  onReset={(row) =>
                    updateOverrides((o) => clearOverride(o, unitKey, row.path))
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
