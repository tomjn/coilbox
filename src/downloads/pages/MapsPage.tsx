import { Button, Input, useDrawer, useSetting } from "@picoframe/frame";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  Map as MapIcon,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { useImportParam } from "../../deeplink/useImportParam";
import { nextDrawerKey } from "../../general/drawerKey";
import { useRecordHubImport } from "../../hub/imports";
import { presetRoute } from "../../play/presets";
import {
  type BarMap,
  dlBarMaps,
  dlGithubReleaseArchives,
  dlHakoraMaps,
  dlInstalledContent,
  dlSpringfilesList,
  type ReleaseArchive,
  type SpringFile,
} from "../bindings";
import { useContentRootPaths, useWriteRoot } from "../config";
import {
  type EnqueueInput,
  identityOf,
  useDownloadComplete,
  useDownloadQueue,
} from "../DownloadQueueProvider";
import { CachedThumb } from "./components/CachedThumb";
import { MapPacksBanner } from "./components/MapPacksBanner";
import { OptionSelect } from "./components/OptionSelect";
import { EmptyState, errMessage } from "./components/states";
import { HIDE_INSTALLED_KEY } from "./hideInstalled";

/** pr-downloader HTTP search endpoint for BAR map files. */
const BAR_SEARCH_URL = "https://files-cdn.beyondallreason.dev/find";

type Source = "bar" | "springfiles" | "hakora" | "bar-maps-gh" | "tap-maps";

/** Curated GitHub map repos (from skylobby's shipped source list), fetched via
 * their release assets. */
const MAP_REPOS: Record<string, string> = {
  "bar-maps-gh": "beyond-all-reason/Maps",
  "tap-maps": "FluidPlay/TAP-maps",
};

/** Normalised row rendered by the grid, regardless of source. */
interface MapItem {
  /** Download identifier passed to `--download-map` (springname); the filename
   * for hakora, which has no springname. Also the React key, so it must be unique. */
  springName: string;
  title: string;
  subtitle?: string;
  thumb?: string;
  /** On-disk archive name, lowercased for installed-detection matching. */
  filename: string;
  /** Direct download URL (hakora only). Its presence selects the direct-fetch
   * path (`dlDownloadFile`) over the pr-downloader sidecar (`dlDownloadMap`). */
  url?: string;
  author?: string;
  /** Map dimensions; sorted by area (width × height). */
  width?: number;
  height?: number;
}

type SortKey =
  | "name-asc"
  | "name-desc"
  | "author-asc"
  | "author-desc"
  | "area-desc"
  | "area-asc";

const SORT_OPTIONS = [
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "author-asc", label: "Author A–Z" },
  { value: "author-desc", label: "Author Z–A" },
  { value: "area-desc", label: "Largest map" },
  { value: "area-asc", label: "Smallest map" },
];

const area = (m: MapItem) => (m.width ?? 0) * (m.height ?? 0);

/** How many cards to render per page — the springfiles catalog has thousands. */
const PAGE = 200;

function barSubtitle(m: BarMap): string {
  const parts: string[] = [];
  if (m.author) parts.push(`by ${m.author}`);
  if (m.mapWidth && m.mapHeight) parts.push(`${m.mapWidth}×${m.mapHeight}`);
  if (m.playerCountMax)
    parts.push(`${m.playerCountMin ?? 2}–${m.playerCountMax}p`);
  return parts.join(" · ");
}

function archiveSubtitle(a: ReleaseArchive): string {
  const parts: string[] = [];
  if (a.size) parts.push(`${(a.size / 1_048_576).toFixed(1)} MB`);
  if (a.tag) parts.push(a.tag);
  return parts.join(" · ");
}

function springSubtitle(f: SpringFile): string {
  const parts: string[] = [];
  if (f.metadata.author) parts.push(`by ${f.metadata.author}`);
  if (f.metadata.width && f.metadata.height)
    parts.push(`${f.metadata.width}×${f.metadata.height}`);
  if (f.size) parts.push(`${(f.size / 1_048_576).toFixed(1)} MB`);
  return parts.join(" · ");
}

export default function MapsPage() {
  const { path: writePath, loading: writeRootLoading } = useWriteRoot();
  // Only once the read has landed and said there is none. Before that `writePath`
  // is undefined whatever the user has configured (issue #1104).
  const noWriteRoot = !writeRootLoading && !writePath;
  const { enqueue, statusFor, active } = useDownloadQueue();
  const [source, setSource] = useState<Source>("bar");
  const [items, setItems] = useState<MapItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("name-asc");
  const [limit, setLimit] = useState(PAGE);
  const [hideInstalled, setHideInstalled] = useSetting<boolean>(
    HIDE_INSTALLED_KEY,
    false,
  );

  // A confirmed `coilbox://import` deep link for a setup pack (issue #388)
  // lands here with the pack code in the query string, since `downloads.maps`
  // is the one content screen no distribution profile can hide: it is not in
  // `HIDEABLE_NAV_IDS`, so a profile cannot take it away, unlike the hub
  // screen, which redirects home when the hub is off.
  const { code: importCode, hubItemId } = useImportParam();
  const recordHubImport = useRecordHubImport();
  const drawer = useDrawer();

  const openPackImport = async (initialCode?: string) => {
    const { ImportPackForm } = await import(
      "../../packs/pages/components/ImportPackForm"
    );
    drawer.open({
      title: "Import a setup pack",
      width: "26rem",
      content: (
        // A fresh form every time, because the last one may still be mounted and
        // would keep the code it already ran (issue #1395).
        <ImportPackForm
          key={nextDrawerKey()}
          initialCode={initialCode}
          onImported={(presetIds, content) =>
            recordHubImport(
              hubItemId,
              presetIds,
              presetIds[0] ? presetRoute(presetIds[0]) : "/downloads/maps",
              content,
            )
          }
        />
      ),
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when the deep-link code arrives, not on every drawer identity change
  useEffect(() => {
    if (importCode) void openPackImport(importCode);
  }, [importCode]);

  const load = useCallback(async (src: Source) => {
    setLoading(true);
    setError(null);
    setItems(null);
    try {
      if (src === "bar") {
        const { maps } = await dlBarMaps(undefined);
        setItems(
          maps.map((m) => ({
            springName: m.springName,
            title: m.displayName || m.springName,
            subtitle: barSubtitle(m),
            thumb: m.images?.preview,
            filename: m.filename,
            author: m.author,
            width: m.mapWidth,
            height: m.mapHeight,
          })),
        );
      } else if (src === "hakora") {
        const { maps } = await dlHakoraMaps(undefined);
        setItems(
          maps.map((m) => ({
            springName: m.filename, // no springname on the mirror; filename is unique
            title: m.filename.replace(/\.(sd7|sdz)$/i, ""),
            subtitle: m.size || undefined,
            filename: m.filename,
            url: m.url, // marks the direct-fetch path
          })),
        );
      } else if (src in MAP_REPOS) {
        const { archives } = await dlGithubReleaseArchives({
          repo: MAP_REPOS[src],
        });
        setItems(
          archives.map((a) => ({
            springName: a.filename, // no springname; filename is unique
            title: a.filename.replace(/\.(sd7|sdz)$/i, ""),
            subtitle: archiveSubtitle(a),
            filename: a.filename,
            url: a.url, // marks the direct-fetch path
          })),
        );
      } else {
        const { results } = await dlSpringfilesList({ category: "map" });
        setItems(
          results.map((f) => ({
            springName: f.springname,
            title: f.name || f.springname,
            subtitle: springSubtitle(f),
            thumb: f.mapimages[0],
            filename: f.filename,
            author: f.metadata.author,
            width: f.metadata.width,
            height: f.metadata.height,
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

  // Lowercased map filenames already present in any detected content root.
  const rootPaths = useContentRootPaths();
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const refreshInstalled = useCallback(async () => {
    if (rootPaths.length === 0) {
      setInstalled(new Set());
      return;
    }
    try {
      const { maps } = await dlInstalledContent({ paths: rootPaths });
      setInstalled(new Set(maps));
    } catch {
      setInstalled(new Set());
    }
  }, [rootPaths]);

  useEffect(() => {
    refreshInstalled();
  }, [refreshInstalled]);

  // Re-scan installed content once the queue finishes a download so a freshly
  // fetched map flips to "Already downloaded" without a manual reload. (The queue
  // runner drops the stale unitsync scan cache itself.)
  useDownloadComplete(() => {
    refreshInstalled();
  });

  // The queue request for a map. hakora rows carry a direct `url` and are fetched
  // into `<root>/maps` (no default destination, so a write root is required);
  // everything else goes through pr-downloader by springname. Returns null when a
  // direct fetch has no destination.
  const mapInput = useCallback(
    (item: MapItem): EnqueueInput | null => {
      if (item.url) {
        if (!writePath) return null;
        return {
          kind: "file",
          label: item.title,
          args: {
            url: item.url,
            destDir: `${writePath}/maps`,
            filename: item.filename,
          },
        };
      }
      return {
        kind: "map",
        label: item.title,
        args: {
          springName: item.springName,
          searchUrl: source === "bar" ? BAR_SEARCH_URL : undefined,
          writePath,
        },
      };
    },
    [writePath, source],
  );

  const filtered = useMemo(() => {
    if (!items) return null;
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        it.springName.toLowerCase().includes(q) ||
        (it.subtitle?.toLowerCase().includes(q) ?? false),
    );
  }, [items, filter]);

  const sorted = useMemo(() => {
    if (!filtered) return null;
    const arr = hideInstalled
      ? filtered.filter((it) => !installed.has(it.filename.toLowerCase()))
      : [...filtered];
    arr.sort((a, b) => {
      switch (sort) {
        case "name-desc":
          return b.title.localeCompare(a.title);
        case "author-asc":
          return (a.author ?? "").localeCompare(b.author ?? "");
        case "author-desc":
          return (b.author ?? "").localeCompare(a.author ?? "");
        case "area-desc":
          return area(b) - area(a);
        case "area-asc":
          return area(a) - area(b);
        default:
          return a.title.localeCompare(b.title);
      }
    });
    return arr;
  }, [filtered, sort, hideInstalled, installed]);

  // Render incrementally — mounting the whole springfiles catalog is slow.
  // Paging resets to the first page in the source/filter/sort change handlers.
  const visible = useMemo(
    () => (sorted ? sorted.slice(0, limit) : null),
    [sorted, limit],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-6 py-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold leading-none">Maps</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Browse and download maps from Beyond All Reason, springfiles, the
            hakora mirror, or curated GitHub map repos into the configured
            content folder.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OptionSelect
            value={source}
            onValueChange={(v) => {
              setSource(v as Source);
              setLimit(PAGE);
            }}
            className="w-48"
            options={[
              { value: "bar", label: "Beyond All Reason" },
              { value: "springfiles", label: "springfiles" },
              { value: "hakora", label: "hakora" },
              { value: "bar-maps-gh", label: "BAR Maps (GitHub)" },
              { value: "tap-maps", label: "TAP Maps (GitHub)" },
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
              onChange={(e) => {
                setFilter(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Filter maps…"
              aria-label="Filter maps"
              className="h-9 pl-7"
            />
          </div>
          <OptionSelect
            value={sort}
            onValueChange={(v) => {
              setSort(v as SortKey);
              setLimit(PAGE);
            }}
            className="w-36"
            options={SORT_OPTIONS}
          />
          <label
            htmlFor="maps-hide-installed"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Switch
              id="maps-hide-installed"
              checked={hideInstalled}
              onCheckedChange={(v) => {
                setHideInstalled(v);
                setLimit(PAGE);
              }}
            />
            Hide downloaded
          </label>
          {items && (
            <span className="text-sm text-muted-foreground">
              {filter.trim() && filtered
                ? `${filtered.length} / ${items.length}`
                : items.length}{" "}
              maps
            </span>
          )}
        </div>
        {noWriteRoot && (
          <p className="text-xs text-muted-foreground">
            No download folder set — pick one in{" "}
            <Link
              className="underline underline-offset-4"
              to="/settings/downloads"
            >
              Downloads settings
            </Link>{" "}
            so maps land where the engine can find them.
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <MapPacksBanner
          writePath={writePath}
          installed={installed}
          items={items ?? []}
        />
        {loading && (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin" /> loading maps…
          </p>
        )}
        {error && (
          <Alert variant="destructive" className="m-2">
            <AlertCircle size={15} />
            <AlertDescription className="text-destructive">
              {error}
            </AlertDescription>
          </Alert>
        )}
        {sorted && sorted.length === 0 && (
          <EmptyState icon={MapIcon}>
            {filter.trim()
              ? `No maps match “${filter.trim()}”.`
              : "No maps found."}
          </EmptyState>
        )}
        {sorted && sorted.length > 0 && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {visible?.map((it) => {
              const isInstalled = installed.has(it.filename.toLowerCase());
              const input = mapInput(it);
              const status = input ? statusFor(identityOf(input)) : null;
              return (
                <li
                  key={it.springName}
                  className="flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/20 hover:bg-accent/30 [content-visibility:auto] [contain-intrinsic-size:14rem]"
                >
                  {/* Image is absolutely positioned so it stays out of flow and
                      cannot inflate the box past its aspect-ratio: WebView2
                      otherwise lets a non-16:9 minimap's intrinsic size drive the
                      height, giving ragged cards. */}
                  <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-muted">
                    <CachedThumb
                      url={it.thumb}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                      fallback={
                        <MapIcon
                          size={28}
                          className="text-muted-foreground/40"
                        />
                      }
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-medium"
                        title={it.title}
                      >
                        {it.title}
                      </p>
                      {it.subtitle && (
                        <p className="truncate text-xs text-muted-foreground">
                          {it.subtitle}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-auto w-full"
                      onClick={() => input && enqueue(input)}
                      disabled={
                        !input ||
                        isInstalled ||
                        status === "queued" ||
                        status === "active" ||
                        status === "done"
                      }
                      aria-label={
                        isInstalled
                          ? `${it.title} already downloaded`
                          : `Download ${it.title}`
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
        {sorted && visible && sorted.length > visible.length && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLimit((l) => l + PAGE)}
            >
              Show more ({sorted.length - visible.length} remaining)
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
