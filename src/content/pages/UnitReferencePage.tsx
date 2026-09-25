import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { useUnitDefs } from "@/workshop/config";
import { UnitReferenceView } from "@/workshop/pages/components/UnitReferenceView";
import { textRedirect, unitDisplayName } from "@/workshop/unitName";
import { unitReferenceRows } from "@/workshop/unitReference";
import {
  useScanTargetSelection,
  useUnitsyncScan,
  useUnitsyncUnitDataset,
} from "../config";
import { DetailError, DetailLoading, NotFound } from "./components/states";

/**
 * The reference table and comparison view for a game's own units (issue
 * #1316), reached from a game's units grid rather than from a workshop
 * project: this reads the game exactly as it ships, with no project
 * overrides on it. Opening the same view from an open project instead
 * (`src/workshop/pages/ReferencePage.tsx`) reads that project's own edited
 * values, so the numbers on screen always match what the reader is looking
 * at.
 *
 * Shares `useUnitDefs` and the curated unit dataset with the workshop rather
 * than reading the game a second way: `defs.units`/`defs.weaponDefs` give
 * `unitReferenceRows` everything `derivedStats.ts` needs, and the dataset
 * gives it the name a person reads, the same join `UnitPage.tsx`'s own
 * `nameOf` makes.
 */
export default function UnitReferencePage() {
  const { name } = useParams();
  const decoded = name ? decodeURIComponent(name) : "";
  const { selected } = useScanTargetSelection();
  const { data, loading, error, run } = useUnitsyncScan(
    selected?.enginePath,
    selected?.rootPath,
  );
  const game = data?.games.find((g) => g.name === decoded);
  const { dataset, status: datasetStatus } = useUnitsyncUnitDataset(
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
  const nameOf = useMemo(
    () => (key: string, def: Record<string, unknown>) => {
      const borrowed = textRedirect(def);
      return unitDisplayName(
        key,
        def,
        named.get(key),
        borrowed === undefined ? undefined : named.get(borrowed),
      );
    },
    [named],
  );

  const rows = useMemo(() => {
    if (!defs) return [];
    return unitReferenceRows(defs.units, defs.weaponDefs, nameOf);
  }, [defs, nameOf]);

  if (error && !data)
    return (
      <DetailError
        backTo="/library/games"
        message={error}
        onRetry={() => run(true)}
      />
    );
  if (!data || loading) return <DetailLoading backTo="/library/games" />;
  if (!game) return <NotFound backTo="/library/games" label="game" />;

  const backTo = `/library/games/${encodeURIComponent(game.name)}/units`;

  if (defsStatus === "error")
    return (
      <DetailError
        backTo={backTo}
        message={defsError ?? "Could not read this game's units."}
        onRetry={reloadDefs}
      />
    );
  if (
    defsStatus === "idle" ||
    defsStatus === "loading" ||
    datasetStatus === "idle" ||
    datasetStatus === "loading" ||
    !selected
  )
    return <DetailLoading backTo={backTo} />;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          {game.name}
        </Link>
        <h1 className="text-lg font-semibold">Unit reference</h1>
        <p className="text-sm text-muted-foreground">
          Every unit in {game.name}, with the numbers players argue about.
          Select two or more to compare them.
        </p>
      </div>
      <UnitReferenceView
        rows={rows}
        renderName={(row) => (
          <Link
            to={`/library/games/${encodeURIComponent(game.name)}/units/${encodeURIComponent(row.key)}`}
            className="hover:underline"
          >
            {row.name}
          </Link>
        )}
      />
    </div>
  );
}
