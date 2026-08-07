import { Button } from "@picoframe/frame";
import { AlertCircle, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDownloadQueue } from "../../downloads/DownloadQueueProvider";
import {
  type ContentRoot,
  type ContentState,
  contentOpenPath,
  contentScanRoot,
  contentStorageOverview,
  type StorageOverview,
} from "../bindings";
import { useContentState, usePreferredEngine } from "../config";
import { formatBytes } from "../format";
import { canPrune } from "../rapidPool";
import { BulkDeleteReplaysPanel } from "./components/BulkDeleteReplaysPanel";
import { DeleteEngineButton } from "./components/DeleteEngineButton";
import { ReclaimCachesButton } from "./components/ReclaimCachesButton";
import { ReclaimSpaceButton } from "./components/ReclaimSpaceButton";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/**
 * Sizes already computed this session, keyed by root path. Walking a rapid pool
 * takes seconds, so leaving the section and coming back must not pay for it
 * again. Module state rather than a hook, so it survives the unmount. Refresh
 * clears it.
 */
const sizeCache = new Map<string, StorageOverview>();

/** What one root's breakdown is doing right now. */
type RootState =
  | { status: "loading" }
  | { status: "ready"; overview: StorageOverview }
  | { status: "error"; message: string };

/**
 * Storage settings section (issue #386): where each content folder's disk has
 * gone, and every cleanup action in one place.
 *
 * Nothing else totals a root, so a player with a full disk had no way to see
 * that most of it is engines they upgraded past and replays they watched once.
 * The four cleanup actions the issue asks for all live here rather than beside
 * whatever screen happened to own them: the rapid pool prune (#329) and the
 * cache reclaim moved out of Content Folders, and the replay and engine
 * removals are new.
 *
 * The frame renders the section title, so this is the body only.
 */
export default function StorageSection() {
  const { state, setState, loading } = useContentState();
  const { active, queued } = useDownloadQueue();
  const pruneAllowed = canPrune(active, queued.length);
  const allEngines = (state?.roots ?? []).flatMap((r) => r.engines);
  const { resolvedId } = usePreferredEngine(allEngines);
  const preferredPath = allEngines.find((e) => e.id === resolvedId)?.path;

  const roots = (state?.roots ?? []).filter((r) => r.exists);
  const rootKey = roots.map((r) => r.path).join("\n");
  const [sizes, setSizes] = useState<Record<string, RootState>>({});

  /** Size one root, from the cache unless `force`. */
  const size = useCallback(async (root: string, force: boolean) => {
    const cached = sizeCache.get(root);
    if (cached && !force) {
      setSizes((s) => ({
        ...s,
        [root]: { status: "ready", overview: cached },
      }));
      return;
    }
    setSizes((s) => ({ ...s, [root]: { status: "loading" } }));
    try {
      const { overview } = await contentStorageOverview({ root });
      sizeCache.set(root, overview);
      setSizes((s) => ({ ...s, [root]: { status: "ready", overview } }));
    } catch (e) {
      setSizes((s) => ({
        ...s,
        [root]: { status: "error", message: msg(e) },
      }));
    }
  }, []);

  // Every root is walked at once, so a small root's breakdown is on screen
  // while a large pool is still being counted.
  useEffect(() => {
    for (const path of rootKey.split("\n").filter(Boolean)) size(path, false);
  }, [rootKey, size]);

  const refreshing = Object.values(sizes).some((s) => s.status === "loading");

  const refresh = () => {
    sizeCache.clear();
    for (const root of roots) size(root.path, true);
  };

  const openPath = (path: string) => {
    contentOpenPath({ path }).catch(() => {});
  };

  /**
   * Re-read one root after a delete: its sizes, and its tracked engine list,
   * which a removed engine has just made stale everywhere else. A failed rescan
   * stays quiet, because the breakdown in front of the user is still right.
   */
  const refreshRoot = useCallback(
    async (path: string) => {
      await size(path, true);
      try {
        const { root } = await contentScanRoot({ path });
        setState((s: ContentState | null) =>
          s
            ? { ...s, roots: s.roots.map((r) => (r.id === root.id ? root : r)) }
            : s,
        );
      } catch {
        // quiet on purpose, see above
      }
    },
    [size, setState],
  );

  if (loading && !state) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-48 rounded-lg border border-border/50 bg-card" />
        <Skeleton className="h-48 rounded-lg border border-border/50 bg-card" />
      </div>
    );
  }

  if (roots.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <p className="text-sm text-muted-foreground">
          No content folders to measure yet. Add one in Content Folders.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            What each content folder holds, and what you can clear out of it.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={refreshing}
            onClick={refresh}
          >
            {refreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh
          </Button>
        </div>

        <div className="flex flex-col gap-4">
          {roots.map((root) => (
            <RootStorageCard
              key={root.id}
              root={root}
              state={sizes[root.path] ?? { status: "loading" }}
              canPrune={pruneAllowed}
              preferredEnginePath={preferredPath}
              onOpen={openPath}
              onChanged={() => refreshRoot(root.path)}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Caches
            </h2>
            <p className="text-xs text-muted-foreground">
              Generated thumbnails, headers, icons and branding art. All
              regenerate on demand, so clearing them only frees disk space.
            </p>
          </div>
          <ReclaimCachesButton />
        </div>
      </section>
    </div>
  );
}

/** One content folder: its breakdown, its engines, and its cleanup actions. */
function RootStorageCard({
  root,
  state,
  canPrune,
  preferredEnginePath,
  onOpen,
  onChanged,
}: {
  root: ContentRoot;
  state: RootState;
  /** Whether the rapid pool prune is allowed (no in-flight downloads). */
  canPrune: boolean;
  /** The engine every launch uses, which must not be deletable. */
  preferredEnginePath?: string;
  onOpen: (path: string) => void;
  /** Re-size this root after something was deleted from it. */
  onChanged: () => void;
}) {
  return (
    <Card className="gap-4 rounded-lg border-border/50 p-4 shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="break-all font-mono text-sm" title={root.path}>
          {root.label ? (
            <span className="mr-2 font-sans font-medium">{root.label}</span>
          ) : null}
          {root.path}
        </p>
        <ReclaimSpaceButton
          rootPath={root.path}
          canPrune={canPrune}
          blockReason="Finish or cancel downloads before reclaiming space"
        />
      </div>

      {state.status === "loading" ? (
        <Skeleton className="h-56" />
      ) : state.status === "error" ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription className="break-words">
            {state.message}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Content</TableHead>
                <TableHead className="text-right">Files</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="w-24">
                  <span className="sr-only">Reveal in file manager</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.overview.categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.label}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {c.files}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBytes(c.bytes)}
                  </TableCell>
                  <TableCell className="text-right">
                    {c.paths.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpen(c.paths[0])}
                        title={`Reveal ${c.paths[0]}`}
                      >
                        <FolderOpen className="size-4" />
                        <span className="sr-only">Reveal {c.label} folder</span>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Total</TableCell>
                <TableCell />
                <TableCell className="text-right font-medium tabular-nums">
                  {formatBytes(state.overview.totalBytes)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Replay cleanup
            </h3>
            <BulkDeleteReplaysPanel
              rootPath={root.path}
              onDeleted={onChanged}
            />
          </div>

          {state.overview.engines.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Engines
              </h3>
              <ul className="flex flex-col gap-2">
                {state.overview.engines.map((engine) => (
                  <li
                    key={engine.path}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/50 p-3"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-medium">{engine.version}</span>
                      <span
                        className="break-all font-mono text-xs text-muted-foreground"
                        title={engine.path}
                      >
                        {engine.path}
                      </span>
                    </div>
                    <span className="tabular-nums">
                      {formatBytes(engine.bytes)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onOpen(engine.path)}
                      title={`Reveal ${engine.path}`}
                    >
                      <FolderOpen className="size-4" />
                      <span className="sr-only">
                        Reveal the {engine.version} folder
                      </span>
                    </Button>
                    <DeleteEngineButton
                      engine={engine}
                      blockReason={
                        engine.path === preferredEnginePath
                          ? "This is your preferred engine, the one every launch uses. Set another as preferred first."
                          : undefined
                      }
                      onDeleted={onChanged}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
