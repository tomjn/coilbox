import { Input } from "@picoframe/frame";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { UnitDisplay } from "../bindings";
import {
  useScanTargetSelection,
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitBuildpics,
  useUnitsyncUnitDataset,
} from "../config";
import { encyclopediaSections, type UnitCell } from "../unitEncyclopedia";
import { unitIconSrc } from "../unitIcon";
import { DetailError, DetailLoading, NotFound } from "./components/states";

/**
 * How many cells the grid draws before it stops, in the shape `UnitPicker.tsx`'s
 * `SEARCH_CAP` uses for the same job (a searchable, faction-grouped list): the
 * number reuses that existing cap rather than guessing a new one, so a game with
 * thousands of units stays responsive instead of rendering a build pic `<img>`
 * for every one of them at once.
 */
const RENDER_CAP = 500;

/**
 * A game's units as a grid, grouped by faction with a unit's morph stages
 * folded into one cell (issue tracked by the encyclopedia design doc). Reads the
 * same scan/game-info/unit-dataset hooks `GameDetailPage` reads, then hands the
 * dataset and the game's sides to `encyclopediaSections`, which resolves each
 * side's start unit to its morph group's base itself.
 *
 * An optional `?faction=<rootId>` narrows the grid to one faction's block, so
 * `FactionBuildList`'s "Browse units" button can link straight into a single
 * side rather than the whole game. `rootId` is a side's start unit id, the
 * same id `encyclopediaSections` keys each block's `section.id` on, so the
 * filter below just compares against that rather than re-deriving it.
 */
export default function GameUnitsPage() {
  const { name } = useParams();
  const decoded = name ? decodeURIComponent(name) : "";
  const [searchParams] = useSearchParams();
  const factionParam = searchParams.get("faction");
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

  const [query, setQuery] = useState("");

  // Computed unconditionally, ahead of every early return below, so
  // `useUnitsyncUnitBuildpics` is called on every render in the same order:
  // gating it behind a `datasetStatus` check would call it on some renders
  // and not others, which breaks the rules of hooks.
  //
  // `gameInfo` and `dataset` only change reference when a fetch actually
  // resolves (`config.ts`'s hooks call `setInfo`/`setDataset` once, then
  // leave the state alone), so both memos below stay referentially stable
  // across a keystroke in the search box.
  const roots = useMemo(
    () =>
      (gameInfo?.sides ?? []).flatMap((s) =>
        s.startUnit ? [{ id: s.startUnit, label: s.name }] : [],
      ),
    [gameInfo],
  );
  const sections = encyclopediaSections(dataset?.units ?? [], roots, query);
  // Computed over every faction's roots regardless of the param. Handing
  // `encyclopediaSections` just the one requested root would make it treat
  // every other faction's units as unreached, dumping them into "Other
  // units" instead of leaving them off this page entirely. Narrowing to one
  // faction's block happens after that walk, here.
  const scoped = factionParam
    ? sections.filter((s) => s.id.toLowerCase() === factionParam.toLowerCase())
    : sections;
  const total = scoped.reduce((n, s) => n + s.cells.length, 0);

  // The budget crosses section boundaries so one big faction can't starve every
  // faction after it, matching how `UnitPicker.tsx:577` caps its own list.
  let left = RENDER_CAP;
  const rows = scoped
    .map((section) => {
      const shown = section.cells.slice(0, Math.max(left, 0));
      left -= shown.length;
      return { ...section, cells: shown };
    })
    .filter((section) => section.cells.length > 0);
  const shownCount = rows.reduce((n, s) => n + s.cells.length, 0);
  const capped = total > shownCount;

  // Every cell id the unfiltered grid could ever show, not `rows`' own
  // search-filtered set. `useUnitsyncUnitBuildpics` keys its effect on a
  // sorted join of the id list it is handed (`config.ts:837`), so an id list
  // that shrinks and grows with `query` produced a new key, and so a new
  // worker call that remounts the game's archive, on every keystroke. The
  // cleanup on that effect only flips a cancelled flag, and does not cancel
  // the in-flight worker job. `UnitPicker.tsx:445` avoids exactly this by
  // memoising its own `allIds` over the whole unit list rather than the
  // filtered one, and this does the same over the query-less sections.
  const allCellIds = useMemo(() => {
    const all = encyclopediaSections(dataset?.units ?? [], roots, "");
    const allScoped = factionParam
      ? all.filter((s) => s.id.toLowerCase() === factionParam.toLowerCase())
      : all;
    return allScoped.flatMap((s) => s.cells.map((c) => c.id));
  }, [dataset, roots, factionParam]);

  const buildpics = useUnitsyncUnitBuildpics(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
    allCellIds,
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

  const backTo = `/content/games/${encodeURIComponent(game.name)}`;

  if (datasetStatus === "error")
    return (
      <div className="flex flex-col gap-3 p-4">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          {game.name}
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

  // `gameInfo` and the unit dataset are independent async reads, and the
  // dataset is the slow one: it parses every unit def in the game, measured
  // at 23.4 seconds cold on a large archive, against a cheap `gameInfo` read.
  // Gating on `gameInfoLoading` alone let the page render before the dataset
  // arrived, and this whole page's content is that dataset, so rendering
  // early meant the "No units found for this game" branch below rendered a
  // confident false statement about a game whose units had simply not
  // loaded yet. `"idle"` and `"loading"` both still block. `"unsyncable"`
  // does not, since its `dataset.units` is already populated (see the error
  // branch above for why status alone cannot be trusted to mean "nothing to
  // show"). This is not the same gate `GameDetailPage` uses: that page's
  // `FactionBuildList` never states a unit count in text, it only disables
  // build buttons, so it has no equivalent false statement to avoid.
  if (
    datasetStatus === "idle" ||
    datasetStatus === "loading" ||
    gameInfoLoading ||
    !gameInfo ||
    !selected
  )
    return <DetailLoading backTo={backTo} />;

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">
        <Link to={backTo} className="hover:underline">
          {game.name}
        </Link>
      </h1>

      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search units…"
        aria-label="Search units"
        className="h-9 max-w-sm"
      />

      {total === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query.trim()
            ? `No units match "${query.trim()}".`
            : "No units found for this game."}
        </p>
      ) : (
        rows.map((section) => (
          <section
            key={section.id || "__other"}
            className="flex flex-col gap-2"
          >
            <h2 className="text-sm font-medium">{section.label}</h2>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
              {section.cells.map((cell) => (
                <UnitCellItem
                  key={cell.id}
                  cell={cell}
                  gameName={game.name}
                  display={buildpics?.units[cell.id]}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {capped && (
        <p className="text-xs text-muted-foreground">
          Showing the first {shownCount} of {total}. Search to narrow it.
        </p>
      )}
    </div>
  );
}

/** One grid cell: a unit's build pic, its label, and how many stages fold into
 * it, linking through to the unit's own page.
 *
 * The link is built as an absolute path rather than a relative `../units/{id}`.
 * Picoframe registers every plugin route as a single flat child of one root
 * layout route, so the matched route stack here is just two entries: root,
 * then the whole `content/games/:name/units` path as one match. A single
 * `".."` pops that entire match rather than one URL segment, so a relative
 * link resolves to `/units/{id}` instead of the unit's own page. */
function UnitCellItem({
  cell,
  gameName,
  display,
}: {
  cell: UnitCell;
  gameName: string;
  display?: UnitDisplay;
}) {
  const src = unitIconSrc(display);
  return (
    <li>
      <Link
        to={`/content/games/${encodeURIComponent(gameName)}/units/${encodeURIComponent(cell.id)}`}
        className="flex flex-col items-center gap-1 rounded-lg border border-border/50 bg-card p-2 text-center transition-colors hover:border-border hover:bg-accent/50"
      >
        {src ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            className="size-12 rounded object-contain"
          />
        ) : (
          <span aria-hidden className="size-12 shrink-0 rounded bg-muted" />
        )}
        <span
          className="w-full truncate text-xs font-medium"
          title={cell.label}
        >
          {cell.label}
        </span>
        {cell.upgrades > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {cell.upgrades} upgrade{cell.upgrades === 1 ? "" : "s"}
          </span>
        )}
      </Link>
    </li>
  );
}
