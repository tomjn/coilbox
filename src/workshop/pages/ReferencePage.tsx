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
 * Known gap, tracked as a follow-up: a slot a project has equipped with a
 * library weapon (`weaponLibrary.ts`, issue #2640) is not resolved here, so a
 * unit that fires an equipped weapon shows its own unequipped definition's
 * numbers instead. Every other project edit - overridden fields, a copied
 * unit, a weapon edited in place in the unit's own `weapondefs` - is
 * resolved, since `resolvedDef` writes an override to whichever path it
 * names, weapon fields included.
 */
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import {
  useScanTargetSelection,
  useUnitsyncScan,
  useUnitsyncUnitDataset,
} from "@/content/config";
import {
  DetailError,
  DetailLoading,
  EmptyState,
} from "@/content/pages/components/states";
import { unitsWithClones } from "../clones";
import { useUnitDefs } from "../config";
import { resolvedDef } from "../overrides";
import { EMPTY_EDITS, useModProjects } from "../project";
import { projectPath } from "../routes";
import { textRedirect, unitDisplayName } from "../unitName";
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
    return unitReferenceRows(resolved, defs.weaponDefs, nameOf);
  }, [units, overrides, defs, nameOf]);

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
      <div className="flex flex-col gap-1">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          {project?.name ?? "Unit tweaks"}
        </Link>
        <h1 className="text-lg font-semibold">Unit reference</h1>
        <p className="text-sm text-muted-foreground">
          Every unit in {gameName}, with this project's own edits applied.
          Select two or more to compare them.
        </p>
      </div>
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
      />
    </div>
  );
}
