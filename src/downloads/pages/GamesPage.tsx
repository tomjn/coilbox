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
import { OptionSelect } from "@/components/OptionSelect";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { useGithubGameRepos } from "@/content/branding";
import { fetchHubGames, type HubGameDownload } from "@/hub/api";
import { useHubUrl } from "@/hub/config";
import { hubGameDownloadRequest } from "@/hub/games/download";
import {
  dlGithubReleaseArchives,
  dlInstalledContent,
  dlSpringfilesList,
} from "../bindings";
import { useContentRootPaths, useWriteRoot } from "../config";
import {
  identityOf,
  useDownloadComplete,
  useDownloadQueue,
} from "../DownloadQueueProvider";
import { GAME_REPOS, mergeGameRepos, repoForKey } from "../gameRepos";
import { QueueProgress } from "./components/ProgressBar";
import { EmptyState, errMessage } from "./components/states";
import { HIDE_INSTALLED_KEY } from "./hideInstalled";

/** The coilbox hub games route (issue #2951), alongside springfiles and the
 * curated GitHub repos in the source select below. */
const HUB_SOURCE = "hub";

type SortKey = "name-asc" | "name-desc" | "size-desc" | "size-asc";

const SORT_OPTIONS = [
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "size-desc", label: "Largest" },
  { value: "size-asc", label: "Smallest" },
];

/** "springfiles" for the built-in catalog, or a `GameRepo.key` from the unified
 * registry (issue #512, resolved at render time so it can't be a literal union). */
type Source = string;

/** Normalised game row rendered by the list, regardless of source. Every
 * springfiles/GitHub-repo source resolves to a direct archive download into
 * `<root>/games/`. A hub row is different (issue #2951): the hub gives a game
 * and its ordered download sources, not one file, so it carries `downloads`
 * instead of `url`/`size` and is resolved at click time by
 * `hubGameDownloadRequest`. */
interface GameItem {
  /** Unique identity + React key: springname for springfiles, filename for
   * GitHub, shortname for the hub. */
  id: string;
  name: string;
  /** On-disk archive name, lowercased for installed-detection matching. Blank
   * for a hub row: which file it becomes depends on which of its several
   * sources ends up used, so there is nothing to match against ahead of a
   * download. */
  filename: string;
  /** Missing for a hub row - the hub names sources, not a file, and this is
   * left unset rather than faked as 0. */
  size?: number;
  /** Direct download URL (springfiles mirror or GitHub asset). Missing means
   * not downloadable. */
  url?: string;
  /** Hub rows only: the ordered sources to try (best first). */
  downloads?: HubGameDownload[];
}

/**
 * Games: download games from springfiles, the coilbox hub or a curated GitHub
 * release repo into the configured content root. Rapid games live under
 * Browse Rapid (which also carries AIs and other rapid content), so this
 * screen covers non-rapid sources - plain mod archives fetched by a direct
 * mirror download into `<root>/games/`, or the hub's own ordered download
 * sources for a game (issue #2951). Requires a configured write root since
 * there's no default destination.
 */
export default function GamesPage() {
  const { path: writePath, loading: writeRootLoading } = useWriteRoot();
  // Only once the read has landed and said there is none. Before that `writePath`
  // is undefined whatever the user has configured (issue #1104).
  const noWriteRoot = !writeRootLoading && !writePath;
  const { enqueue, itemFor, failureFor, active } = useDownloadQueue();
  // Unified GitHub game-repo registry (issue #512): the catalog is authoritative
  // once loaded, GAME_REPOS is the fallback seed shown immediately. Memoized so
  // `load`'s identity (and the effect that calls it) doesn't churn every render.
  const catalogRepos = useGithubGameRepos();
  const repos = useMemo(
    () => mergeGameRepos(catalogRepos, GAME_REPOS),
    [catalogRepos],
  );
  const hubUrl = useHubUrl();
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

  const load = useCallback(
    async (src: Source) => {
      setLoading(true);
      setError(null);
      setGames(null);
      try {
        if (src === HUB_SOURCE) {
          const result = await fetchHubGames(hubUrl);
          if (!result.ok) {
            setError(result.reason);
            return;
          }
          setGames(
            result.value.map((g) => ({
              id: g.shortname,
              name: g.title,
              filename: "",
              downloads: g.downloads,
            })),
          );
          return;
        }
        const repo = src === "springfiles" ? undefined : repoForKey(repos, src);
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
    },
    [repos, hubUrl],
  );

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

  // A hub row has no fixed identity until one of its sources resolves (issue
  // #2951): unlike every other source here, resolving it may itself involve a
  // network call (a github source's release list). These track that in-flight
  // resolution and its outcome per row, by game id, so the bulk queue read
  // below (`itemFor`/`failureFor`) can pick the row up once it has an
  // identity, the same way it already does for every other source.
  const [hubResolving, setHubResolving] = useState<Set<string>>(new Set());
  const [hubIdentities, setHubIdentities] = useState<Record<string, string>>(
    {},
  );
  const [hubErrors, setHubErrors] = useState<Record<string, string>>({});

  // Add a game to the app-wide download queue. Springfiles and GitHub-repo
  // rows resolve to a direct archive download into `<root>/games/`. A hub row
  // carries no single URL - its ordered `downloads` are tried in turn by
  // `hubGameDownloadRequest`, skipping a source that comes up empty, and the
  // first usable one is what gets queued.
  async function enqueueGame(game: GameItem) {
    if (!writePath) return;
    if (game.downloads) {
      setHubResolving((prev) => new Set(prev).add(game.id));
      setHubErrors((prev) => {
        if (!(game.id in prev)) return prev;
        const next = { ...prev };
        delete next[game.id];
        return next;
      });
      try {
        const request = await hubGameDownloadRequest(
          game.downloads,
          `${writePath}/games`,
          game.name,
        );
        setHubIdentities((prev) => ({
          ...prev,
          [game.id]: identityOf(request),
        }));
        enqueue(request);
      } catch (e) {
        setHubErrors((prev) => ({ ...prev, [game.id]: errMessage(e) }));
      } finally {
        setHubResolving((prev) => {
          const next = new Set(prev);
          next.delete(game.id);
          return next;
        });
      }
      return;
    }
    if (!game.url) return;
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
            Download games from springfiles, the coilbox hub or a curated GitHub
            release repo into the configured content folder. For rapid games
            (and AIs) use Browse Rapid.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OptionSelect
            value={source}
            onValueChange={(v) => setSource(v as Source)}
            className="w-48"
            options={[
              { value: "springfiles", label: "springfiles" },
              { value: HUB_SOURCE, label: "coilbox hub" },
              ...repos.map((g) => ({ value: g.key, label: g.label })),
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
        {noWriteRoot && (
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
              // A hub row has no identity until `enqueueGame` resolves one of
              // its `downloads` (issue #2951). Every other source's identity
              // is known up front from its single URL.
              const identity = g.downloads
                ? (hubIdentities[g.id] ?? null)
                : g.url
                  ? identityOf({
                      kind: "file",
                      label: g.name,
                      args: {
                        url: g.url,
                        destDir: `${writePath}/games`,
                        filename: g.filename,
                      },
                    })
                  : null;
              const item = identity ? itemFor(identity) : null;
              const status = item?.status ?? null;
              const isResolving = hubResolving.has(g.id);
              // Read here rather than per row through `useQueuedDownload`: the
              // springfiles catalogue is hundreds of rows, and the queue is
              // already being read once for the whole page (issue #1863).
              const failure =
                hubErrors[g.id] ?? (identity ? failureFor(identity) : null);
              return (
                <li key={g.id} className="flex flex-col gap-2 px-6 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{g.name}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {g.downloads
                          ? `via ${g.downloads.map((d) => d.kind).join(" → ")}`
                          : g.filename}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => enqueueGame(g)}
                      disabled={
                        !writePath ||
                        (!g.url && !g.downloads) ||
                        isInstalled ||
                        isResolving ||
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
                      {isResolving || status === "active" ? (
                        <Loader2 className="animate-spin" />
                      ) : isInstalled || status === "done" ? (
                        <CheckCircle2 className="text-emerald-500" />
                      ) : (
                        <Download />
                      )}
                      {isInstalled
                        ? "Already downloaded"
                        : isResolving
                          ? "Resolving…"
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
                  <QueueProgress item={item} />
                  {failure && (
                    <p className="break-words text-xs text-destructive">
                      {failure}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
