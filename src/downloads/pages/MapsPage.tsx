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
  dlSpringfilesList,
} from "../bindings";
import { useWriteRootPath } from "../config";
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
}

function barSubtitle(m: BarMap): string {
  const parts: string[] = [];
  if (m.author) parts.push(`by ${m.author}`);
  if (m.mapWidth && m.mapHeight) parts.push(`${m.mapWidth}×${m.mapHeight}`);
  if (m.playerCountMax)
    parts.push(`${m.playerCountMin ?? 2}–${m.playerCountMax}p`);
  return parts.join(" · ");
}

export default function MapsPage() {
  const writePath = useWriteRootPath();
  const [source, setSource] = useState<Source>("bar");
  const [items, setItems] = useState<MapItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
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
          })),
        );
      } else {
        const { results } = await dlSpringfilesList({ category: "map" });
        setItems(
          results.map((f) => ({
            springName: f.springname,
            title: f.name || f.springname,
            subtitle: f.size
              ? `${(f.size / 1_048_576).toFixed(1)} MB`
              : undefined,
            thumb: f.mapimages[0],
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
            onValueChange={(v) => setSource(v as Source)}
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
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter maps…"
              aria-label="Filter maps"
              className="h-9 pl-7"
            />
          </div>
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
        {filtered && filtered.length === 0 && (
          <EmptyState icon={MapIcon}>
            {filter.trim()
              ? `No maps match “${filter.trim()}”.`
              : "No maps found."}
          </EmptyState>
        )}
        {filtered && filtered.length > 0 && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {filtered.map((it) => (
              <li
                key={it.springName}
                className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
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
                    disabled={downloading !== null}
                    aria-label={`Download ${it.title}`}
                  >
                    {downloading === it.springName ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Download />
                    )}
                    {downloading === it.springName
                      ? "Downloading…"
                      : "Download"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
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
