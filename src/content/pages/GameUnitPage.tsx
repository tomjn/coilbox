import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  useScanTargetSelection,
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitBuildpics,
  useUnitsyncUnitDataset,
} from "../config";
import { encyclopediaSections, unitLabel } from "../unitEncyclopedia";
import { unitIconSrc } from "../unitIcon";
import { DetailError, DetailLoading, NotFound } from "./components/states";
import { UnitModelPanel } from "./components/UnitModelPanel";
import { UnitStatsTable } from "./components/UnitStatsTable";

/**
 * One unit's own page: its model first, then its identity (name, def key,
 * faction and buildpic). Task 4 adds the stats, build relationships, morph
 * stages and terrain limits below this, and this page is the shell those
 * attach to. Reads the same scan/game-info/unit-dataset hooks `GameUnitsPage`
 * reads, so the dataset this page's unit is found in is the one already
 * cached by the grid a reader came from.
 */
export default function GameUnitPage() {
  const { name, unit: unitParam } = useParams();
  const decoded = name ? decodeURIComponent(name) : "";
  const id = unitParam ? decodeURIComponent(unitParam).toLowerCase() : "";
  const navigate = useNavigate();

  const { selected } = useScanTargetSelection();
  const { data, loading, error, run } = useUnitsyncScan(
    selected?.enginePath,
    selected?.rootPath,
  );
  const game = data?.games.find((g) => g.name === decoded);
  const { info: gameInfo, loading: gameInfoLoading } = useUnitsyncGameInfo(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );
  const { dataset, status: datasetStatus } = useUnitsyncUnitDataset(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );

  const unit = dataset?.units.find((u) => u.name.toLowerCase() === id);

  // Computed unconditionally, ahead of every early return below, so
  // `useUnitsyncUnitBuildpics` is called on every render in the same order,
  // the same reasoning `GameUnitsPage` documents for its own call.
  //
  // Fetches with `id` (the lowercased route param), not `unit.name` (the
  // dataset's original-case string): the worker keys its result map with
  // exactly the string it was handed, and the read below looks it up by
  // `id`. A game whose def key isn't already all lowercase would fetch under
  // one key and read under another, matching nothing. `GameUnitsPage` avoids
  // this the same way, fetching and reading with its already-lowercased
  // `cell.id` throughout.
  const buildpics = useUnitsyncUnitBuildpics(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
    unit ? [id] : [],
  );

  if (error && !data)
    return (
      <DetailError
        backTo="/content/games"
        message={error}
        onRetry={() => run(true)}
      />
    );
  if (!data || loading) return <DetailLoading backTo="/content/games" />;
  if (!game) return <NotFound backTo="/content/games" label="game" />;

  const unitsBackTo = `/content/games/${encodeURIComponent(game.name)}/units`;

  if (datasetStatus === "error")
    return (
      <div className="flex flex-col gap-3 p-4">
        <Link
          to={unitsBackTo}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          {game.name} units
        </Link>
        <Alert variant="destructive">
          <AlertTitle>Could not read this game&apos;s units</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1 font-mono text-xs">
              {(dataset?.errors ?? []).map((e) => (
                <li key={e} className="break-words">
                  {e}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      </div>
    );

  // Same gate `GameUnitsPage` uses, and for the same reason. The dataset is
  // the slow read, `"idle"`/`"loading"` both still block, and `"unsyncable"`
  // falls through since its `dataset.units` is already populated.
  if (
    datasetStatus === "idle" ||
    datasetStatus === "loading" ||
    gameInfoLoading ||
    !gameInfo ||
    !selected
  )
    return <DetailLoading backTo={unitsBackTo} />;

  if (!unit)
    return (
      <div className="flex flex-col gap-4 p-4">
        <Link
          to={unitsBackTo}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Back
        </Link>
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            That unit is not in this game.
          </p>
        </div>
      </div>
    );

  // Which faction's tech forest reaches this unit, reusing the grid's own
  // grouping rather than a second walk of the build graph. A match on the
  // unit's own id or on one of its folded morph stages, the same as a search
  // hit in the grid.
  const roots = (gameInfo.sides ?? []).flatMap((s) =>
    s.startUnit ? [{ id: s.startUnit, label: s.name }] : [],
  );
  const sections = encyclopediaSections(dataset?.units ?? [], roots, "");
  const faction = sections.find((s) =>
    s.cells.some((c) => c.id === id || c.stages.includes(id)),
  )?.label;

  const display = buildpics?.units[id];
  const src = unitIconSrc(display);

  // Keyed lowercase on both sides, matching every other id lookup on this
  // page: a def key is only ever compared case-insensitively.
  const byId = new Map(
    (dataset?.units ?? []).map((u) => [u.name.toLowerCase(), u]),
  );
  const label = (targetId: string) => unitLabel(byId.get(targetId), targetId);
  const unitPath = (targetId: string) =>
    `/content/games/${encodeURIComponent(game.name)}/units/${encodeURIComponent(targetId)}`;

  // What this unit builds: its own `buildOptions`, resolved against the
  // dataset so a stripped or unrecognised target is silently dropped rather
  // than linking somewhere.
  const builds = [
    ...new Set((unit.buildOptions ?? []).map((t) => t.toLowerCase())),
  ].filter((t) => byId.has(t));

  // What builds this unit: the reverse of `buildOptions`, built once as a
  // single map over every unit rather than filtering the whole dataset again
  // for each render.
  const builtByMap = new Map<string, string[]>();
  for (const u of dataset?.units ?? []) {
    for (const target of u.buildOptions ?? []) {
      const key = target.toLowerCase();
      const builders = builtByMap.get(key);
      if (builders) builders.push(u.name.toLowerCase());
      else builtByMap.set(key, [u.name.toLowerCase()]);
    }
  }
  const builtBy = builtByMap.get(id) ?? [];

  const morphs = unit.morphTargets ?? [];

  const hasTerrain =
    (unit.footprintX !== undefined && unit.footprintZ !== undefined) ||
    unit.maxSlope !== undefined ||
    unit.floatOnWater !== undefined ||
    unit.minWaterDepth !== undefined ||
    unit.maxWaterDepth !== undefined;

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link
        to={unitsBackTo}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" /> Back
      </Link>

      <UnitModelPanel
        enginePath={selected.enginePath}
        dataDir={selected.rootPath}
        gameArchive={game.primaryArchive.name}
        unitId={id}
        unit={unit}
        onClose={() => navigate(unitsBackTo)}
        hideTitle
      />

      <div>
        <h1 className="text-xl font-semibold">{unitLabel(unit, id)}</h1>
        <p className="font-mono text-xs text-muted-foreground">{id}</p>
        {faction && <p className="text-xs text-muted-foreground">{faction}</p>}
      </div>

      {src ? (
        <img src={src} alt="" className="size-16 rounded object-contain" />
      ) : (
        <span aria-hidden className="size-16 shrink-0 rounded bg-muted" />
      )}

      <UnitStatsTable unit={unit} />

      {builds.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">What it builds</h2>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {builds.map((targetId) => (
              <li key={targetId}>
                <Link to={unitPath(targetId)} className="hover:underline">
                  {label(targetId)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {builtBy.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">What builds it</h2>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {builtBy.map((builderId) => (
              <li key={builderId}>
                <Link to={unitPath(builderId)} className="hover:underline">
                  {label(builderId)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {morphs.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Turns into</h2>
          <ul className="flex flex-col gap-2">
            {morphs.map((morph) => {
              const targetId = morph.into.toLowerCase();
              const conditions = Object.entries(morph).filter(
                ([key]) => key !== "into",
              );
              return (
                <li
                  key={morph.into}
                  className="flex flex-col gap-1 rounded-lg border border-border/50 bg-card p-2 text-sm"
                >
                  <Link
                    to={unitPath(targetId)}
                    className="font-medium hover:underline"
                  >
                    {label(targetId)}
                  </Link>
                  {conditions.length > 0 && (
                    <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {conditions.map(([key, value]) => (
                        <div key={key} className="contents">
                          <dt>{key}</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {hasTerrain && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Where it stands</h2>
          <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 rounded-lg border border-border/50 bg-card p-3 text-sm">
            {unit.footprintX !== undefined && unit.footprintZ !== undefined && (
              <div className="contents">
                <dt className="text-muted-foreground">Footprint</dt>
                <dd>
                  {unit.footprintX} by {unit.footprintZ} squares
                </dd>
              </div>
            )}
            {unit.maxSlope !== undefined && (
              <div className="contents">
                <dt className="text-muted-foreground">Maximum slope</dt>
                <dd>{unit.maxSlope}°</dd>
              </div>
            )}
            {unit.floatOnWater !== undefined && (
              <div className="contents">
                <dt className="text-muted-foreground">Floats</dt>
                <dd>{unit.floatOnWater ? "Yes" : "No"}</dd>
              </div>
            )}
            {(unit.minWaterDepth !== undefined ||
              unit.maxWaterDepth !== undefined) && (
              <div className="contents">
                <dt className="text-muted-foreground">Water depth</dt>
                <dd>
                  {unit.minWaterDepth ?? "any"} to {unit.maxWaterDepth ?? "any"}{" "}
                  elmos
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}
    </div>
  );
}
