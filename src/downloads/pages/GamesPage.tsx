import { Button, Input } from "@picoframe/frame";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Gamepad2,
  Loader2,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  dlInstalledContent,
  dlSpringfilesList,
  type SpringFile,
} from "../bindings";
import { useContentRootPaths, useWriteRootPath } from "../config";
import {
  identityOf,
  useDownloadComplete,
  useDownloadQueue,
} from "../DownloadQueueProvider";
import { OptionSelect } from "./components/OptionSelect";
import { EmptyState, errMessage } from "./components/states";

type SortKey = "name-asc" | "name-desc" | "size-desc" | "size-asc";

const SORT_OPTIONS = [
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "size-desc", label: "Largest" },
  { value: "size-asc", label: "Smallest" },
];

const gameName = (g: SpringFile) => g.name || g.springname;

/**
 * Games: download games from springfiles into the configured content root.
 * Rapid games live under Browse Rapid (which also carries AIs and other rapid
 * content), so this screen covers only the non-rapid springfiles catalog —
 * plain mod archives fetched by a direct mirror download into `<root>/games/`.
 * Requires a configured write root since there's no default destination.
 */
export default function GamesPage() {
  const writePath = useWriteRootPath();
  const { enqueue, statusFor, active } = useDownloadQueue();
  const [games, setGames] = useState<SpringFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("name-asc");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setGames(null);
    try {
      const { results } = await dlSpringfilesList({ category: "game" });
      setGames(results);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Lowercased game filenames already present in any detected content root.
  const rootPaths = useContentRootPaths();
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const refreshInstalled = useCallback(async () => {
    if (rootPaths.length === 0) {
      setInstalled(new Set());
      return;
    }
    try {
      const { games } = await dlInstalledContent({ paths: rootPaths });
      setInstalled(new Set(games));
    } catch {
      setInstalled(new Set());
    }
  }, [rootPaths]);

  useEffect(() => {
    refreshInstalled();
  }, [refreshInstalled]);

  // Re-scan installed content once the queue finishes a download so a freshly
  // fetched game flips to "Already downloaded" without a manual reload. (The
  // queue runner drops the stale unitsync scan cache itself.)
  useDownloadComplete(() => {
    refreshInstalled();
  });

  // Add a game to the app-wide download queue. The game is fetched by a direct
  // mirror download into `<root>/games/`.
  function enqueueGame(game: SpringFile) {
    if (!writePath || !game.mirrors[0]) return;
    enqueue({
      kind: "file",
      label: game.name || game.springname,
      args: {
        url: game.mirrors[0],
        destDir: `${writePath}/games`,
        filename: game.filename,
      },
    });
  }

  const filtered = useMemo(() => {
    if (!games) return null;
    const q = filter.trim().toLowerCase();
    if (!q) return games;
    return games.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.springname.toLowerCase().includes(q),
    );
  }, [games, filter]);

  const sorted = useMemo(() => {
    if (!filtered) return null;
    const arr = [...filtered];
    arr.sort((a, b) => {
      switch (sort) {
        case "name-desc":
          return gameName(b).localeCompare(gameName(a));
        case "size-desc":
          return (b.size ?? 0) - (a.size ?? 0);
        case "size-asc":
          return (a.size ?? 0) - (b.size ?? 0);
        default:
          return gameName(a).localeCompare(gameName(b));
      }
    });
    return arr;
  }, [filtered, sort]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-6 py-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold leading-none">Games</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Download games from springfiles into the configured content folder.
            For rapid games (and AIs) use Browse Rapid.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter games…"
              aria-label="Filter games"
              className="h-9 pl-7"
            />
          </div>
          <OptionSelect
            value={sort}
            onValueChange={(v) => setSort(v as SortKey)}
            className="w-36"
            options={SORT_OPTIONS}
          />
          {games && (
            <span className="text-sm text-muted-foreground">
              {filter.trim() && filtered
                ? `${filtered.length} / ${games.length}`
                : games.length}{" "}
              games
            </span>
          )}
        </div>
        {!writePath && (
          <p className="text-xs text-muted-foreground">
            Set a download folder in Downloads settings to enable game
            downloads.
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin" /> loading games…
          </p>
        )}
        {error && (
          <Alert variant="destructive" className="m-4">
            <AlertCircle size={15} />
            <AlertDescription className="text-destructive">
              {error}
            </AlertDescription>
          </Alert>
        )}
        {sorted && sorted.length === 0 && (
          <EmptyState icon={Gamepad2}>
            {filter.trim()
              ? `No games match “${filter.trim()}”.`
              : "No games found."}
          </EmptyState>
        )}
        {sorted && sorted.length > 0 && (
          <ul className="divide-y divide-border">
            {sorted.map((g) => {
              const isInstalled = installed.has(g.filename.toLowerCase());
              const name = g.name || g.springname;
              const status = g.mirrors[0]
                ? statusFor(
                    identityOf({
                      kind: "file",
                      label: name,
                      args: {
                        url: g.mirrors[0],
                        destDir: `${writePath}/games`,
                        filename: g.filename,
                      },
                    }),
                  )
                : null;
              return (
                <li
                  key={g.springname}
                  className="flex flex-col gap-2 px-6 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {g.filename}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => enqueueGame(g)}
                      disabled={
                        !writePath ||
                        !g.mirrors[0] ||
                        isInstalled ||
                        status === "queued" ||
                        status === "active" ||
                        status === "done"
                      }
                      aria-label={
                        isInstalled
                          ? `${name} already downloaded`
                          : `Download ${name}`
                      }
                    >
                      {status === "active" ? (
                        <Loader2 className="animate-spin" />
                      ) : isInstalled || status === "done" ? (
                        <CheckCircle2 className="text-emerald-500" />
                      ) : (
                        <Download />
                      )}
                      {isInstalled
                        ? "Already downloaded"
                        : status === "active"
                          ? "Downloading…"
                          : status === "queued"
                            ? "Queued"
                            : status === "done"
                              ? "Done"
                              : active
                                ? "Add to queue"
                                : "Download"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
