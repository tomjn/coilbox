import { useMemo, useState } from "react";
import {
  useScanTargetSelection,
  useUnitsyncGameHeaders,
  useUnitsyncScan,
} from "../config";
import { usePlayGame } from "../usePlayGame";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { FilterBar } from "./components/FilterBar";
import { GameCard } from "./components/GameCard";
import {
  Diagnostics,
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "./components/states";

type SortKey = "name-asc" | "name-desc" | "size-desc" | "size-asc";

const SORT_OPTIONS = [
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "size-desc", label: "Largest" },
  { value: "size-asc", label: "Smallest" },
];

/**
 * Lists the games (primary mods) the selected engine can see. Each row shows the
 * game's own (primary) archive and how many dependency archives it pulls in.
 * Scans run automatically on open and are cached for the session.
 */
export default function GamesPage() {
  const { targets, selected, selectedKey, setSelectedKey } =
    useScanTargetSelection();
  const { data, loading, error, run } = useUnitsyncScan(
    selected?.enginePath,
    selected?.rootPath,
  );
  const { headers, loading: headersLoading } = useUnitsyncGameHeaders(
    selected?.enginePath,
    selected?.rootPath,
  );
  const playGame = usePlayGame();

  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("name-asc");

  const games = data?.games ?? [];
  const busy = loading || (!!selected && !data && !error);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return games;
    return games.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.primaryArchive.name.toLowerCase().includes(q),
    );
  }, [games, filter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      switch (sort) {
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "size-desc":
          return (b.primaryArchive.size ?? 0) - (a.primaryArchive.size ?? 0);
        case "size-asc":
          return (a.primaryArchive.size ?? 0) - (b.primaryArchive.size ?? 0);
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return arr;
  }, [filtered, sort]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Games</h1>
        <p className="text-sm text-muted-foreground">
          Games found in your content folders, with their primary archive and
          dependencies.
        </p>
      </header>

      <BrowserToolbar
        targets={targets}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onRescan={() => run(true)}
        scanning={loading}
      />

      {!busy && games.length > 0 && (
        <FilterBar
          search={filter}
          onSearch={setFilter}
          searchPlaceholder="Filter games…"
          searchLabel="Filter games"
          sort={sort}
          onSort={(v) => setSort(v as SortKey)}
          sortOptions={SORT_OPTIONS}
          total={games.length}
          shown={sorted.length}
          noun="games"
        />
      )}

      {error && <ErrorBanner message={error} />}
      {data?.errors?.length ? <Diagnostics errors={data.errors} /> : null}

      {targets.length === 0 ? null : busy ? (
        <SkeletonList />
      ) : games.length === 0 ? (
        <EmptyState label="No games found for this engine." />
      ) : sorted.length === 0 ? (
        <EmptyState label={`No games match “${filter.trim()}”.`} />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
          {sorted.map((g) => (
            <li
              key={`${g.primaryArchive.name}:${g.name}`}
              className="[contain-intrinsic-size:8rem] [content-visibility:auto]"
            >
              <GameCard
                game={g}
                artUrl={headers.get(g.name)}
                loading={headersLoading && !headers.get(g.name)}
                onPlay={() => playGame(g.name)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
