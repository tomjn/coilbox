import { Link } from "react-router";
import { useScanTargetSelection, useUnitsyncScan } from "../config";
import { BrowserToolbar } from "./components/BrowserToolbar";
import {
  Diagnostics,
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "./components/states";

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

  const games = data?.games ?? [];
  const busy = loading || (!!selected && !data && !error);

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

      {error && <ErrorBanner message={error} />}
      {data?.errors?.length ? <Diagnostics errors={data.errors} /> : null}

      {targets.length === 0 ? null : busy ? (
        <SkeletonList />
      ) : games.length === 0 ? (
        <EmptyState label="No games found for this engine." />
      ) : (
        <ul className="flex flex-col gap-2">
          {games.map((g) => (
            <li key={`${g.primaryArchive.name}:${g.name}`}>
              <Link
                to={`/content/games/${encodeURIComponent(g.name)}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:border-border hover:bg-accent/40"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{g.name}</p>
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
