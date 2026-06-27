import { Button, cn, Input } from "@picoframe/frame";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Gamepad2,
  Loader2,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  dlDownloadFile,
  dlSpringfilesList,
  type SpringFile,
} from "../bindings";
import { useWriteRootPath } from "../config";
import { OptionSelect } from "./components/OptionSelect";
import { RapidBrowser } from "./components/RapidBrowser";
import { EmptyState, errMessage } from "./components/states";

type Source = "rapid" | "springfiles";

/**
 * springfiles games are plain mod archives (not rapid), so they're fetched by a
 * direct download of the mirror into `<root>/games/`. Requires a configured
 * write root since there's no default destination.
 */
function SpringfilesGames({ writePath }: { writePath?: string }) {
  const [games, setGames] = useState<SpringFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setGames(null);
    setResult(null);
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

  async function download(game: SpringFile) {
    if (!writePath || !game.mirrors[0]) return;
    setDownloading(game.springname);
    setResult(null);
    try {
      const { message } = await dlDownloadFile({
        url: game.mirrors[0],
        destDir: `${writePath}/games`,
        filename: game.filename,
      });
      setResult({ ok: true, message });
    } catch (e) {
      setResult({ ok: false, message: errMessage(e) });
    } finally {
      setDownloading(null);
    }
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
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
        <p className="border-b border-border px-6 py-2 text-xs text-muted-foreground">
          Set a download folder in Downloads settings to enable springfiles game
          downloads.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin" /> loading games…
          </p>
        )}
        {error && (
          <p className="m-4 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle size={15} className="mt-px shrink-0" />
            {error}
          </p>
        )}
        {filtered && filtered.length === 0 && (
          <EmptyState icon={Gamepad2}>
            {filter.trim()
              ? `No games match “${filter.trim()}”.`
              : "No games found."}
          </EmptyState>
        )}
        {filtered && filtered.length > 0 && (
          <ul className="divide-y divide-border">
            {filtered.map((g) => (
              <li
                key={g.springname}
                className="flex items-center justify-between gap-3 px-6 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {g.name || g.springname}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {g.filename}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => download(g)}
                  disabled={downloading !== null || !writePath || !g.mirrors[0]}
                  aria-label={`Download ${g.name || g.springname}`}
                >
                  {downloading === g.springname ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  {downloading === g.springname ? "Downloading…" : "Download"}
                </Button>
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

/**
 * Games: download games from any configured rapid source (shared RapidBrowser)
 * or as direct mod archives from springfiles, into the configured content root.
 */
export default function GamesPage() {
  const writePath = useWriteRootPath();
  const [source, setSource] = useState<Source>("rapid");

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-6 py-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold leading-none">Games</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Download games from a rapid repository or from springfiles into the
            configured content folder.
          </p>
        </div>
        <OptionSelect
          value={source}
          onValueChange={(v) => setSource(v as Source)}
          className="w-48"
          options={[
            { value: "rapid", label: "Rapid" },
            { value: "springfiles", label: "springfiles" },
          ]}
        />
      </header>
      {source === "rapid" ? (
        <div className="min-h-0 flex-1">
          <RapidBrowser writePath={writePath} />
        </div>
      ) : (
        <SpringfilesGames writePath={writePath} />
      )}
    </div>
  );
}
