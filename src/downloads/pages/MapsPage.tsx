import { Button, cn, Input } from "@picoframe/frame";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  Map as MapIcon,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type BarMap,
  dlBarMaps,
  dlDownloadMap,
  dlInstalledContent,
  dlSpringfilesList,
  type SpringFile,
} from "../bindings";
import { useContentRootPaths, useWriteRootPath } from "../config";
import { OptionSelect } from "./components/OptionSelect";
import { EmptyState, errMessage } from "./components/states";

/** pr-downloader HTTP search endpoint for BAR map files. */
const BAR_SEARCH_URL = "https://files-cdn.beyondallreason.dev/find";

type Source = "bar" | "springfiles";

/** Normalised row rendered by the grid, regardless of source. */
interface MapItem {
  /** Download identifier passed to `--download-map`. */
  springName: string;
  title: string;
  subtitle?: string;
  thumb?: string;
  /** On-disk archive name, lowercased for installed-detection matching. */
  filename: string;
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

function springSubtitle(f: SpringFile): string {
  const parts: string[] = [];
  if (f.metadata.author) parts.push(`by ${f.metadata.author}`);
  if (f.metadata.width && f.metadata.height)
    parts.push(`${f.metadata.width}×${f.metadata.height}`);
  if (f.size) parts.push(`${(f.size / 1_048_576).toFixed(1)} MB`);
  return parts.join(" · ");
}

export default function MapsPage() {
  const writePath = useWriteRootPath();
  const [source, setSource] = useState<Source>("bar");
  const [items, setItems] = useState<MapItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("name-asc");
  const [limit, setLimit] = useState(PAGE);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  const load = useCallback(async (src: Source) => {
    setLoading(true);
    setError(null);
    setItems(null);
    setResult(null);
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

  async function download(springName: string) {
    setDownloading(springName);
    setResult(null);
    try {
      const { message } = await dlDownloadMap({
        springName,
        searchUrl: source === "bar" ? BAR_SEARCH_URL : undefined,
        writePath,
      });
      setResult({ ok: true, message });
      await refreshInstalled();
    } catch (e) {
      setResult({ ok: false, message: errMessage(e) });
    } finally {
      setDownloading(null);
    }
  }

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
    const arr = [...filtered];
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
  }, [filtered, sort]);

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
            Browse and download maps from Beyond All Reason or springfiles into
            the configured content folder.
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
          {items && (
            <span className="text-sm text-muted-foreground">
              {filter.trim() && filtered
                ? `${filtered.length} / ${items.length}`
                : items.length}{" "}
              maps
            </span>
          )}
        </div>
        {!writePath && (
          <p className="text-xs text-muted-foreground">
            No download folder set — pick one in Downloads settings so maps land
            where the engine can find them.
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading && (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin" /> loading maps…
          </p>
        )}
        {error && (
          <p className="m-2 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle size={15} className="mt-px shrink-0" />
            {error}
          </p>
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
              return (
                <li
                  key={it.springName}
                  className="flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/20 hover:bg-accent/30 [content-visibility:auto] [contain-intrinsic-size:14rem]"
                >
                  <div className="flex aspect-video items-center justify-center bg-muted">
                    {it.thumb ? (
                      <img
                        src={it.thumb}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <MapIcon size={28} className="text-muted-foreground/40" />
                    )}
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
                      onClick={() => download(it.springName)}
                      disabled={downloading !== null || isInstalled}
                      aria-label={
                        isInstalled
                          ? `${it.title} already downloaded`
                          : `Download ${it.title}`
                      }
                    >
                      {downloading === it.springName ? (
                        <Loader2 className="animate-spin" />
                      ) : isInstalled ? (
                        <CheckCircle2 className="text-emerald-500" />
                      ) : (
                        <Download />
                      )}
                      {downloading === it.springName
                        ? "Downloading…"
                        : isInstalled
                          ? "Already downloaded"
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

      {result && (
        <div
          className={cn(
            "flex items-start gap-2 border-t px-6 py-3 text-sm",
            result.ok
              ? "border-border bg-card text-card-foreground"
              : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {result.ok ? (
            <CheckCircle2
              size={16}
              className="mt-px shrink-0 text-emerald-500"
            />
          ) : (
            <AlertCircle size={16} className="mt-px shrink-0" />
          )}
          <span className="min-w-0 break-words">{result.message}</span>
        </div>
      )}
    </div>
  );
}
