import { Button, cn } from "@picoframe/frame";
import { AlertCircle, CheckCircle2, Download, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { dlGithubReleaseArchives } from "../../../downloads/bindings";
import type { WriteRoot } from "../../../downloads/config";
import type { EnqueueInput } from "../../../downloads/DownloadQueueProvider";
import {
  GAME_REPOS,
  type GameRepo,
  mergeGameRepos,
  resolveGithubRepo,
} from "../../../downloads/gameRepos";
import { ProgressBar } from "../../../downloads/pages/components/ProgressBar";
import { errMessage } from "../../../downloads/pages/components/states";
import { useQueuedDownload } from "../../../downloads/useQueuedDownload";
import {
  resolveSuggestedArt,
  type SuggestedDownload,
  type SuggestedGame,
  type SuggestedMap,
  useBrandingCatalog,
  useBrandingImage,
  useGithubGameRepos,
} from "../../branding";
import { invalidateScans } from "../../config";

type Suggestion = SuggestedGame | SuggestedMap;

interface SuggestionsListProps {
  kind: "game" | "map";
  /** Already filtered to uninstalled items. */
  items: Suggestion[];
  /** Where downloads go, and whether that has been read yet. The pair travels
   * together so the "set a folder" line waits for the read rather than showing
   * on the first render of every visit (issue #1104). */
  writeRoot: WriteRoot;
  /** Called after a successful download (page rescans; card re-checks). */
  onComplete?: () => void;
  heading?: string;
}

/**
 * Turn a suggestion into a download-queue request, so it runs on the app-wide
 * queue and shows in the topbar indicator like every other download. `repos` is
 * the unified GitHub game-repo registry (issue #512), used to resolve a `github`
 * download's `sourceKey`.
 *
 * Async because a `github` suggestion names a repo, not a file: the release
 * archive has to be looked up before there is a URL to queue.
 */
export async function suggestionRequest(
  dl: SuggestedDownload,
  kind: "game" | "map",
  label: string,
  writePath: string,
  repos: GameRepo[],
): Promise<EnqueueInput> {
  const destDir = (subdir?: string) =>
    `${writePath}/${subdir ?? (kind === "game" ? "games" : "maps")}`;
  switch (dl.kind) {
    case "rapid":
      // Default to the standard rapid master when the catalog entry omits one:
      // a non-empty master pins PRD_RAPID_REPO_MASTER and disables the rapid
      // streamer in the sidecar, matching every working rapid caller. Left
      // unset, the streamer path can exit 0 without installing (a silent no-op).
      return {
        kind: "rapid",
        label,
        args: {
          tag: dl.tag,
          masterUrl: dl.masterUrl || "https://repos.springrts.com",
          writePath,
        },
      };
    case "map":
      return {
        kind: "map",
        label,
        args: {
          springName: dl.springName,
          searchUrl: dl.searchUrl,
          writePath,
        },
      };
    case "url":
      return {
        kind: "file",
        label,
        args: {
          url: dl.url,
          filename: dl.filename,
          destDir: destDir(dl.subdir),
        },
      };
    case "github": {
      // Resolve the repo directly, or via the unified registry's sourceKey (issue
      // 512), then stream the matching (or newest) release archive directly.
      // Games like SplinterFaction ship only via GitHub releases. `resolveGithubRepo`
      // never returns undefined - it throws a clear error instead (issue #525).
      const repo = resolveGithubRepo(repos, dl);
      const { archives } = await dlGithubReleaseArchives({ repo });
      const pick = dl.asset
        ? archives.find((a) =>
            a.filename.toLowerCase().includes(dl.asset?.toLowerCase() ?? ""),
          )
        : archives[0];
      if (!pick) throw new Error(`No release archive found for ${repo}.`);
      return {
        kind: "file",
        label,
        args: {
          url: pick.url,
          filename: pick.filename,
          destDir: destDir(dl.subdir),
        },
      };
    }
  }
}

/**
 * A grid of pre-curated download suggestions (games or maps) shown on the
 * first-run/empty content screens. Reuses the downloads-plugin commands, progress
 * channel and `ProgressBar`. On a successful download it clears the unitsync scan
 * cache and calls `onComplete` so the host screen's own state refreshes, while a
 * downloaded item stays in its slot marked done (issue #526) so the rest of
 * `items` (whatever the caller passed in) stays selectable for the visit.
 */
export function SuggestionsList({
  kind,
  items,
  writeRoot,
  onComplete,
  heading,
}: SuggestionsListProps) {
  const writePath = writeRoot.path;
  const noWriteRoot = !writeRoot.loading && !writePath;
  const entries = useBrandingCatalog();
  // Unified GitHub game-repo registry (issue #512): the catalog is authoritative
  // once loaded, GAME_REPOS is the fallback seed.
  const catalogRepos = useGithubGameRepos();
  const repos = useMemo(
    () => mergeGameRepos(catalogRepos, GAME_REPOS),
    [catalogRepos],
  );
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  // Marks an item done in place once its download succeeds, rather than relying
  // on `items` shrinking (the caller holds a stable snapshot for the visit so the
  // rest stay selectable - issue #526). Local to this list, so it survives
  // regardless of how the caller reacts to `onComplete`.
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  if (items.length === 0) return null;

  function onDownloaded(item: Suggestion) {
    setResult({ ok: true, message: `${item.title} downloaded.` });
    setDoneIds((prev) => new Set(prev).add(item.id));
    // A newly-downloaded game/map must appear without a manual rescan.
    invalidateScans();
    onComplete?.();
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
        {noWriteRoot && (
          <p className="text-xs text-muted-foreground">
            Set a download folder in{" "}
            <Link
              className="underline underline-offset-4"
              to="/settings/downloads"
            >
              Downloads settings
            </Link>{" "}
            to enable downloads.
          </p>
        )}
      </div>

      {/* auto-fill, not auto-fit: a suggestion card stays game-card sized even
          when only one or two are shown on a wide window (issue #529). auto-fit
          would stretch the real tracks to fill the row, blowing the art up. */}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
        {items.map((item) => (
          <SuggestionCard
            key={item.id}
            item={item}
            kind={kind}
            repos={repos}
            writePath={writePath}
            art={
              kind === "game"
                ? resolveSuggestedArt(entries, item as SuggestedGame)
                : (item as SuggestedMap).thumb
            }
            done={doneIds.has(item.id)}
            onDownloaded={() => onDownloaded(item)}
            onFailed={(message) => setResult({ ok: false, message })}
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
  kind,
  repos,
  writePath,
  art,
  done,
  onDownloaded,
  onFailed,
}: {
  item: Suggestion;
  kind: "game" | "map";
  repos: GameRepo[];
  writePath?: string;
  art?: string[];
  /** This item's download already succeeded this visit (issue #526): stays in
   * place, marked done, instead of vanishing or re-offering the download. */
  done: boolean;
  onDownloaded: () => void;
  onFailed: (message: string) => void;
}) {
  const imageUrl = useBrandingImage(art, true);
  const dl = useQueuedDownload();
  const active = dl.busy;
  const disabled = !writePath || active;

  async function onDownload() {
    if (!writePath) return;
    try {
      const request = await suggestionRequest(
        item.download,
        kind,
        `${kind === "game" ? "Game" : "Map"}: ${item.title}`,
        writePath,
        repos,
      );
      const settled = await dl.start(request);
      if (settled?.status === "done") onDownloaded();
      else if (settled?.error) onFailed(settled.error);
    } catch (e) {
      onFailed(errMessage(e));
    }
  }

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
            disabled={disabled || done}
            aria-label={
              done ? `${item.title} downloaded` : `Download ${item.title}`
            }
          >
            {done ? (
              <CheckCircle2 className="text-emerald-500" />
            ) : active ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Download />
            )}
            {done
              ? "Downloaded"
              : dl.status === "queued"
                ? "Queued…"
                : active
                  ? "Downloading…"
                  : "Download"}
          </Button>
          {dl.progress && <ProgressBar progress={dl.progress} />}
        </div>
      </div>
    </li>
  );
}
