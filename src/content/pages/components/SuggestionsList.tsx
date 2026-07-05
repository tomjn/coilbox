import { Button, cn } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { AlertCircle, CheckCircle2, Download, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  type DownloadProgress,
  dlDownload,
  dlDownloadFile,
  dlDownloadMap,
} from "../../../downloads/bindings";
import { ProgressBar } from "../../../downloads/pages/components/ProgressBar";
import { errMessage } from "../../../downloads/pages/components/states";
import {
  resolveSuggestedArt,
  type SuggestedDownload,
  type SuggestedGame,
  type SuggestedMap,
  useBrandingCatalog,
  useBrandingImage,
} from "../../branding";
import { invalidateScans } from "../../config";

type Suggestion = SuggestedGame | SuggestedMap;

interface SuggestionsListProps {
  kind: "game" | "map";
  /** Already filtered to uninstalled items. */
  items: Suggestion[];
  writePath?: string;
  /** Called after a successful download (page rescans; card re-checks). */
  onComplete?: () => void;
  heading?: string;
}

/** Dispatch a suggestion to the matching downloads-plugin command. */
function runDownload(
  dl: SuggestedDownload,
  kind: "game" | "map",
  writePath: string,
  onProgress: Channel<DownloadProgress>,
): Promise<{ message: string }> {
  switch (dl.kind) {
    case "rapid":
      return dlDownload({
        tag: dl.tag,
        masterUrl: dl.masterUrl,
        writePath,
        onProgress,
      });
    case "map":
      return dlDownloadMap({
        springName: dl.springName,
        searchUrl: dl.searchUrl,
        writePath,
        onProgress,
      });
    case "url":
      return dlDownloadFile({
        url: dl.url,
        filename: dl.filename,
        destDir: `${writePath}/${dl.subdir ?? (kind === "game" ? "games" : "maps")}`,
        onProgress,
      });
  }
}

/**
 * A grid of pre-curated download suggestions (games or maps) shown on the
 * first-run/empty content screens. Reuses the downloads-plugin commands, progress
 * channel and `ProgressBar`; on a successful download it clears the unitsync scan
 * cache and calls `onComplete` so the host screen refreshes and the item drops out
 * (or the whole block is replaced once real content appears).
 */
export function SuggestionsList({
  kind,
  items,
  writePath,
  onComplete,
  heading,
}: SuggestionsListProps) {
  const entries = useBrandingCatalog();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  if (items.length === 0) return null;

  async function onDownload(item: Suggestion) {
    if (!writePath || downloading !== null) return;
    setDownloading(item.id);
    setProgress(null);
    setResult(null);
    const onProgress = new Channel<DownloadProgress>();
    onProgress.onmessage = (p) => setProgress(p);
    try {
      const { message } = await runDownload(
        item.download,
        kind,
        writePath,
        onProgress,
      );
      setResult({ ok: true, message });
      // A newly-downloaded game/map must appear without a manual rescan.
      invalidateScans();
      onComplete?.();
    } catch (e) {
      setResult({ ok: false, message: errMessage(e) });
    } finally {
      setDownloading(null);
      setProgress(null);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">
          {heading ??
            (kind === "game"
              ? "Get started — download a game"
              : "Get started — download a map")}
        </h2>
        {!writePath && (
          <p className="text-xs text-muted-foreground">
            Set a download folder in Downloads settings to enable downloads.
          </p>
        )}
      </div>

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
        {items.map((item) => (
          <SuggestionCard
            key={item.id}
            item={item}
            art={
              kind === "game"
                ? resolveSuggestedArt(entries, item as SuggestedGame)
                : (item as SuggestedMap).thumb
            }
            active={downloading === item.id}
            progress={progress}
            disabled={!writePath || downloading !== null}
            onDownload={() => onDownload(item)}
          />
        ))}
      </ul>

      {result && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-sm",
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
    </section>
  );
}

function SuggestionCard({
  item,
  art,
  active,
  progress,
  disabled,
  onDownload,
}: {
  item: Suggestion;
  art?: string[];
  active: boolean;
  progress: DownloadProgress | null;
  disabled: boolean;
  onDownload: () => void;
}) {
  const imageUrl = useBrandingImage(art, true);
  return (
    <li className="flex flex-col overflow-hidden rounded-lg border border-border/50 bg-card">
      <div className="aspect-video w-full overflow-hidden bg-muted">
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="space-y-0.5">
          <p className="truncate text-sm font-medium" title={item.title}>
            {item.title}
          </p>
          {item.blurb && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {item.blurb}
            </p>
          )}
        </div>
        <div className="mt-auto flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onDownload}
            disabled={disabled}
            aria-label={`Download ${item.title}`}
          >
            {active ? <Loader2 className="animate-spin" /> : <Download />}
            {active ? "Downloading…" : "Download"}
          </Button>
          {active && progress && <ProgressBar progress={progress} />}
        </div>
      </div>
    </li>
  );
}
