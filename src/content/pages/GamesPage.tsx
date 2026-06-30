import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useScanTargetSelection, useUnitsyncScan } from "../config";
import { isSdd } from "../format";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { FilterBar } from "./components/FilterBar";
import { SddBadge } from "./components/SddBadge";
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
        <ul className="flex flex-col gap-2">
          {sorted.map((g) => (
            <li key={`${g.primaryArchive.name}:${g.name}`}>
              <Link
                to={`/content/games/${encodeURIComponent(g.name)}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:border-border hover:bg-accent/40"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate font-medium">{g.name}</p>
                    {isSdd(g.primaryArchive) && <SddBadge />}
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {g.primaryArchive.name}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {g.info.version && (
                    <p className="text-xs text-muted-foreground">
                      v{g.info.version}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {g.dependencyArchives.length} dep
                    {g.dependencyArchives.length === 1 ? "" : "s"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
