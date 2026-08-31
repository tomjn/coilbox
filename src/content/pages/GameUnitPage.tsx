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
  const buildpics = useUnitsyncUnitBuildpics(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
    unit ? [unit.name] : [],
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
    </div>
  );
}
