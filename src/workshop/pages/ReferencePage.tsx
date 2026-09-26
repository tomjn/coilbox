/**
 * The reference table and comparison view for an open project (issue #1316):
 * the same `UnitReferenceView` the content plugin's `UnitReferencePage.tsx`
 * shows for a game with no project open, but resolved through this
 * project's own overrides and its own added units, so a mutator's changed
 * numbers are what a reader compares rather than the game's stock ones.
 *
 * Read-only: nothing here writes to the project. `/workshop/:id` is still
 * where a unit's fields are changed, and this is where two or more of them
 * are read side by side. A unit's name in the table links back to that
 * editor.
 *
 * A slot the project has equipped with a library weapon (`weaponLibrary.ts`,
 * issue #2640) is resolved here too (issue #3081), the same way
 * `UnitPage.tsx`'s editor resolves one, so a unit that fires an equipped
 * weapon shows that weapon's numbers rather than its own unequipped
 * definition's.
 */
import { ArrowLeft } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Link, useParams } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import {
  useScanTargetSelection,
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitBuildpics,
  useUnitsyncUnitDataset,
} from "@/content/config";
import {
  DetailError,
  DetailLoading,
  EmptyState,
} from "@/content/pages/components/states";
import { buildTechForest } from "@/content/techForest";
import { buildOptionsOf } from "../buildMenus";
import { unitsWithClones } from "../clones";
import { useUnitDefs } from "../config";
import { resolvedDef } from "../overrides";
import { EMPTY_EDITS, useModProjects } from "../project";
import { projectPath } from "../routes";
import { textRedirect, unitDisplayName } from "../unitName";
import { unitPicLookup } from "../unitPics";
import { unitReferenceRows } from "../unitReference";
import { nameEdit } from "../unitText";
import { UnitReferenceView } from "./components/UnitReferenceView";

export default function ReferencePage() {
  const { id } = useParams();
  const { projects } = useModProjects();
  const project = projects.find((p) => p.id === id);
  const edits = project?.edits ?? EMPTY_EDITS;
  const { overrides, text } = edits;
  const ownClones = edits.clones;
  // Absent on a project saved before the library existed (issue #2640).
  const library = edits.weapons ?? {};
  const equipped = edits.equipped ?? {};

  const { selected } = useScanTargetSelection();
  const { data, loading, error, run } = useUnitsyncScan(
    selected?.enginePath,
    selected?.rootPath,
  );
  const games = data?.games ?? [];
  const gameName = project?.gameName ?? "";
  const game = games.find((g) => g.name === gameName);

  const { dataset } = useUnitsyncUnitDataset(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );
  const {
    defs,
    status: defsStatus,
    error: defsError,
    reload: reloadDefs,
  } = useUnitDefs(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );

  const named = useMemo(
    () => new Map((dataset?.units ?? []).map((u) => [u.name, u])),
    [dataset],
  );
  const gameUnits = defs?.units ?? {};
  const units = useMemo(
    () => unitsWithClones(gameUnits, ownClones),
    [gameUnits, ownClones],
  );
  const nameOf = useMemo(
    () => (key: string, def: Record<string, unknown>) => {
      const borrowed = textRedirect(def);
      return (
        nameEdit(key, def, overrides, text)?.trim() ||
        unitDisplayName(
          key,
          def,
          ownClones[key] ? undefined : named.get(key),
          borrowed === undefined ? undefined : named.get(borrowed),
        )
      );
    },
    [named, ownClones, overrides, text],
  );

  const rows = useMemo(() => {
    if (!defs) return [];
    const resolved: Record<string, Record<string, unknown>> = {};
    for (const [key, def] of Object.entries(units))
      resolved[key] = resolvedDef(def, overrides[key]);
    return unitReferenceRows(
      resolved,
      defs.weaponDefs,
      nameOf,
      library,
      equipped,
    );
  }, [units, overrides, defs, nameOf, library, equipped]);

  // Which faction reaches each unit, the same walk `UnitPage.tsx`'s own list
  // uses to tell apart two rows that share a name (issue #3110): a game's own
  // dataset, with the project's copies stood in among it, so a unit this
  // project added still resolves through whichever build graph reaches its
  // clone's source.
  const pickerUnits = useMemo(() => {
    const byName = new Map(
      (dataset?.units ?? []).map((u) => [u.name.toLowerCase(), u]),
    );
    for (const clone of Object.values(ownClones)) {
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
  }, [dataset, ownClones]);

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
      // A one-sided game answers nothing, because the same word on every row
      // tells nobody anything.
      if (sides.length < 2) return undefined;
      const root = forest.factionOf.get(key);
      if (root === undefined) return undefined;
      return (
        sides.find((s) => s.startUnit?.toLowerCase() === root)?.name ?? root
      );
    },
    [forest, sides],
  );

  // A unit's build picture (issue #3110), the same read `UnitPage.tsx`'s own
  // list draws its rows from.
  const picIds = useMemo(() => Object.keys(gameUnits), [gameUnits]);
  const buildpics = useUnitsyncUnitBuildpics(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
    picIds,
  );
  const picsPending = !buildpics && picIds.length > 0;
  const picOf = useMemo(
    () => unitPicLookup({ buildpics, clones: ownClones, units, overrides }),
    [buildpics, ownClones, units, overrides],
  );

  const backTo = project ? projectPath(project.id) : "/workshop";

  // Covers both a deleted or never-owned project id and `/workshop/new`
  // itself: a project not yet started has no edits of its own to resolve,
  // so there is nothing for this page to show that the game's own reference
  // table (`UnitReferencePage.tsx`) does not already show.
  if (!project)
    return (
      <EmptyState label="That project is not on this machine. Pick one under Unit tweaks." />
    );
  if (error && !data)
    return (
      <DetailError
        backTo="/workshop"
        message={error}
        onRetry={() => run(true)}
      />
    );
  if (!data || loading) return <DetailLoading backTo="/workshop" />;
  if (!game)
    return (
      <EmptyState
        label={`${gameName} is not installed here, so there are no units to show.`}
      />
    );
  if (defsStatus === "error")
    return (
      <DetailError
        backTo={backTo}
        message={defsError ?? "Could not read this game's units."}
        onRetry={reloadDefs}
      />
    );
  if (defsStatus === "idle" || defsStatus === "loading" || !selected)
    return <DetailLoading backTo={backTo} />;

  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader
        back={
          <Link
            to={backTo}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ArrowLeft className="size-3.5" /> {project?.name ?? "Unit tweaks"}
          </Link>
        }
        title="Unit reference"
        description={`Every unit in ${gameName}, with this project's own edits applied. Select two or more to compare them.`}
      />
      <UnitReferenceView
        rows={rows}
        renderName={(row) => (
          <Link
            to={projectPath(project.id, row.key)}
            className="hover:underline"
          >
            {row.name}
          </Link>
        )}
        picOf={picOf}
        picsPending={picsPending}
        factionOf={factionOf}
      />
    </div>
  );
}
