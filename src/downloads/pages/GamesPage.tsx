import { Button, Input, useSetting } from "@picoframe/frame";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Gamepad2,
  Loader2,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import {
  dlGithubReleaseArchives,
  dlInstalledContent,
  dlSpringfilesList,
} from "../bindings";
import { useContentRootPaths, useWriteRootPath } from "../config";
import {
  identityOf,
  useDownloadComplete,
  useDownloadQueue,
} from "../DownloadQueueProvider";
import { GAME_REPOS, repoForKey } from "../gameRepos";
import { OptionSelect } from "./components/OptionSelect";
import { EmptyState, errMessage } from "./components/states";
import { HIDE_INSTALLED_KEY } from "./hideInstalled";

type SortKey = "name-asc" | "name-desc" | "size-desc" | "size-asc";

const SORT_OPTIONS = [
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "size-desc", label: "Largest" },
  { value: "size-asc", label: "Smallest" },
];

type Source = "springfiles" | (typeof GAME_REPOS)[number]["key"];

/** Normalised game row rendered by the list, regardless of source. Every source
 * resolves to a direct archive download into `<root>/games/`. */
interface GameItem {
  /** Unique identity + React key: springname for springfiles, filename for GitHub. */
  id: string;
  name: string;
  /** On-disk archive name, lowercased for installed-detection matching. */
  filename: string;
  size: number;
  /** Direct download URL (springfiles mirror or GitHub asset); missing = not downloadable. */
  url?: string;
}

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
  const [source, setSource] = useState<Source>("springfiles");
  const [games, setGames] = useState<GameItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("name-asc");
  const [hideInstalled, setHideInstalled] = useSetting<boolean>(
    HIDE_INSTALLED_KEY,
    false,
  );

  const load = useCallback(async (src: Source) => {
    setLoading(true);
    setError(null);
    setGames(null);
    try {
      const repo = src === "springfiles" ? undefined : repoForKey(src);
      if (repo) {
        const { archives } = await dlGithubReleaseArchives({ repo });
        setGames(
          archives.map((a) => ({
            id: a.filename,
            name: a.filename.replace(/\.(sd7|sdz)$/i, ""),
            filename: a.filename,
            size: a.size,
            url: a.url,
          })),
        );
      } else {
        const { results } = await dlSpringfilesList({ category: "game" });
        setGames(
          results.map((g) => ({
            id: g.springname,
            name: g.name || g.springname,
            filename: g.filename,
            size: g.size,
            url: g.mirrors[0],
          })),
        );
      }
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(source);
  }, [source, load]);

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

  // Add a game to the app-wide download queue. Every source resolves to a direct
  // archive download into `<root>/games/`.
  function enqueueGame(game: GameItem) {
    if (!writePath || !game.url) return;
    enqueue({
      kind: "file",
      label: game.name,
      args: {
        url: game.url,
        destDir: `${writePath}/games`,
        filename: game.filename,
      },
    });
  }

  const filtered = useMemo(() => {
    if (!games) return null;
    const q = filter.trim().toLowerCase();
    if (!q) return games;
    return games.filter((g) => g.name.toLowerCase().includes(q));
  }, [games, filter]);

  const sorted = useMemo(() => {
    if (!filtered) return null;
    const arr = hideInstalled
      ? filtered.filter((g) => !installed.has(g.filename.toLowerCase()))
      : [...filtered];
    arr.sort((a, b) => {
      switch (sort) {
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "size-desc":
          return (b.size ?? 0) - (a.size ?? 0);
        case "size-asc":
          return (a.size ?? 0) - (b.size ?? 0);
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return arr;
  }, [filtered, sort, hideInstalled, installed]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-6 py-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold leading-none">Games</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Download games from springfiles or a curated GitHub release repo
            into the configured content folder. For rapid games (and AIs) use
            Browse Rapid.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OptionSelect
            value={source}
            onValueChange={(v) => setSource(v as Source)}
            className="w-48"
            options={[
              { value: "springfiles", label: "springfiles" },
              ...GAME_REPOS.map((g) => ({ value: g.key, label: g.label })),
            ]}
          />
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
          <label
            htmlFor="games-hide-installed"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Switch
              id="games-hide-installed"
              checked={hideInstalled}
              onCheckedChange={setHideInstalled}
            />
            Hide downloaded
          </label>
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
            Set a download folder in{" "}
            <Link
              className="underline underline-offset-4"
              to="/settings/downloads"
            >
              Downloads settings
            </Link>{" "}
            to enable game downloads.
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
              const status = g.url
                ? statusFor(
                    identityOf({
                      kind: "file",
                      label: g.name,
                      args: {
                        url: g.url,
                        destDir: `${writePath}/games`,
                        filename: g.filename,
                      },
                    }),
                  )
                : null;
              return (
                <li key={g.id} className="flex flex-col gap-2 px-6 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{g.name}</p>
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
                        !g.url ||
                        isInstalled ||
                        status === "queued" ||
                        status === "active" ||
                        status === "done"
                      }
                      aria-label={
                        isInstalled
                          ? `${g.name} already downloaded`
                          : `Download ${g.name}`
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
