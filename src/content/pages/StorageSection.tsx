import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import {
  AlertCircle,
  FolderOpen,
  Loader2,
  RefreshCw,
  Star,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { HelpPopover } from "@/components/HelpPopover";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { describeError } from "@/i18n/uiError";
import { formatBytes } from "@/lib/format";
import { useDownloadQueue } from "../../downloads/DownloadQueueProvider";
import {
  type ContentRoot,
  type ContentState,
  contentOpenPath,
  contentScanRoot,
  contentStorageOverview,
  contentUnitDefSetsUsage,
  type EngineUsage,
  type StorageCategory,
  type StorageOverview,
} from "../bindings";
import { useContentState, usePreferredEngine } from "../config";
import { canPrune } from "../rapidPool";
import { categoryLabel } from "../storageLabels";
import { BulkDeleteReplaysPanel } from "./components/BulkDeleteReplaysPanel";
import { DeleteEngineButton } from "./components/DeleteEngineButton";
import {
  clearDuplicateReportCache,
  DuplicateContent,
} from "./components/DuplicateContent";
import { ReclaimCachesButton } from "./components/ReclaimCachesButton";
import { ReclaimSpaceButton } from "./components/ReclaimSpaceButton";
import { ReplayTracksStorage } from "./components/ReplayTracksStorage";

const msg = (e: unknown): string => describeError(e);

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

/** One category's figures, when the breakdown has them. */
function category(state: RootState | undefined, id: string) {
  return state?.status === "ready"
    ? state.overview.categories.find((c) => c.id === id)
    : undefined;
}

/** `path` without the `root` it sits in, which the list's heading names. */
function pathInRoot(path: string, root: string): string {
  const base = root.replace(/[\\/]+$/, "");
  if (base && path.startsWith(base) && /[\\/]/.test(path[base.length] ?? "")) {
    return path.slice(base.length + 1);
  }
  return path;
}

/**
 * Storage settings section (issue #386): where each content folder's disk has
 * gone, and every cleanup action in one place.
 *
 * Nothing else totals a root, so a player with a full disk had no way to see
 * that most of it is engines they upgraded past and replays they watched once.
 * The rapid pool prune (#329), the cache clear, and the replay and engine
 * removals all live here rather than beside whatever screen owns the content.
 *
 * The frame renders the section title, so this is the body only.
 */
export default function StorageSection() {
  const { t } = useLingui();
  const { state, setState, loading } = useContentState();
  const { active, queued } = useDownloadQueue();
  const pruneAllowed = canPrune(active, queued.length);
  const allEngines = (state?.roots ?? []).flatMap((r) => r.engines);
  const { resolvedId } = usePreferredEngine(allEngines);
  const preferredPath = allEngines.find((e) => e.id === resolvedId)?.path;

  const roots = (state?.roots ?? []).filter((r) => r.exists);
  const rootKey = roots.map((r) => r.path).join("\n");
  const [sizes, setSizes] = useState<Record<string, RootState>>({});
  const [openError, setOpenError] = useState<string | null>(null);

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

  /** Bumped by Refresh and by a delete, so the duplicate report reads again. */
  const [reportVersion, setReportVersion] = useState(0);

  const refresh = () => {
    sizeCache.clear();
    clearDuplicateReportCache();
    setReportVersion((v) => v + 1);
    for (const root of roots) size(root.path, true);
  };

  const openPath = (path: string) => {
    setOpenError(null);
    contentOpenPath({ path }).catch((e) => setOpenError(msg(e)));
  };

  /**
   * Re-read one root after a delete: its sizes, and its tracked engine list,
   * which a removed engine has just made stale everywhere else. A failed rescan
   * stays quiet, because the breakdown in front of the user is still right.
   */
  const refreshRoot = useCallback(
    async (path: string) => {
      clearDuplicateReportCache();
      setReportVersion((v) => v + 1);
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
      <div className="flex flex-col gap-10">
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            <Trans>
              No content folders to measure yet. Add one in{" "}
              <Link
                to="/settings/content-folders"
                className="underline underline-offset-4"
              >
                Content folders
              </Link>
              .
            </Trans>
          </p>
        </div>
        <AppDataSection />
      </div>
    );
  }

  // A root is left out of the engine and replay lists once its breakdown shows
  // it has none, so a second folder holding only maps adds no empty block.
  const engineRoots = roots.filter((r) => {
    const s = sizes[r.path];
    return s?.status === "ready" && s.overview.engines.length > 0;
  });
  const replayRoots = roots.filter((r) => {
    const s = sizes[r.path];
    return s?.status !== "ready" || (category(s, "replays")?.files ?? 0) > 0;
  });
  const titled = roots.length > 1;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-10">
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              <Trans>Content folders</Trans>
            </h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={refreshing}
                  onClick={refresh}
                  aria-label={t`Refresh`}
                >
                  {refreshing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <Trans>Measure the folders again</Trans>
              </TooltipContent>
            </Tooltip>
          </div>
          {openError && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription className="select-text break-words">
                {openError}
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-5">
            {roots.map((root) => (
              <RootUsage
                key={root.id}
                root={root}
                state={sizes[root.path] ?? { status: "loading" }}
                canPrune={pruneAllowed}
                onOpen={openPath}
                onChanged={() => refreshRoot(root.path)}
              />
            ))}
          </div>
        </section>

        {engineRoots.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">
              <Trans>Engines</Trans>
            </h2>
            <div className="flex flex-col gap-5">
              {engineRoots.map((root) => {
                const s = sizes[root.path];
                if (s?.status !== "ready") return null;
                return (
                  <RootGroup key={root.id} root={root} titled={titled}>
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {s.overview.engines.map((engine) => (
                        <EngineUsageRow
                          key={engine.path}
                          engine={engine}
                          rootPath={root.path}
                          preferred={engine.path === preferredPath}
                          onOpen={openPath}
                          onDeleted={() => refreshRoot(root.path)}
                        />
                      ))}
                    </ul>
                  </RootGroup>
                );
              })}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-semibold">
              <Trans>Delete replays</Trans>
            </h2>
            <HelpPopover label={t`About deleting replays`}>
              <p>
                <Trans>
                  Pick an age or tick a box to choose replays, then delete them
                  in one go. Each filter narrows the choice further. Coilbox
                  shows the total before anything is deleted.
                </Trans>
              </p>
            </HelpPopover>
          </div>
          {replayRoots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No replays in your content folders.</Trans>
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {replayRoots.map((root) => (
                <RootGroup key={root.id} root={root} titled={titled}>
                  <div className="rounded-md border border-border px-4 py-3">
                    <BulkDeleteReplaysPanel
                      rootPath={root.path}
                      onDeleted={() => refreshRoot(root.path)}
                    />
                  </div>
                </RootGroup>
              ))}
            </div>
          )}
        </section>

        <DuplicateContent
          roots={roots.map((r) => r.path)}
          version={reportVersion}
          onOpen={openPath}
        />

        <AppDataSection />
      </div>
    </TooltipProvider>
  );
}

/** A content folder's name above its part of a list, when there are several. */
function RootGroup({
  root,
  titled,
  children,
}: {
  root: ContentRoot;
  titled: boolean;
  children: ReactNode;
}) {
  if (!titled) return children;
  return (
    <div className="flex flex-col gap-1.5">
      <h3
        className="truncate font-mono text-xs text-muted-foreground"
        title={root.path}
      >
        {root.label ?? root.path}
      </h3>
      {children}
    </div>
  );
}

/** What coilbox itself keeps: caches, replay tracks and replay unit lists. */
function AppDataSection() {
  const { t } = useLingui();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">
        <Trans>Coilbox data</Trans>
      </h2>
      <SettingList>
        <SettingRow
          label={t`Caches`}
          help={
            <p>
              <Trans>
                Map thumbnails, game headers, unit icons and branding art.
                Coilbox makes them again when it needs them, so clearing them
                only frees disk space.
              </Trans>
            </p>
          }
          helpLabel={t`About caches`}
        >
          <ReclaimCachesButton />
        </SettingRow>
        <ReplayTracksStorage />
        <ReplayUnitLists />
      </SettingList>
    </section>
  );
}

/**
 * What the unit lists kept for replays cost (#1176). They are not a cache:
 * a list is what lets a replay still name its units once its game has been
 * updated or removed, so there is nothing here to clear. A list goes when the
 * last replay that uses it is deleted.
 */
function ReplayUnitLists() {
  const { t } = useLingui();
  const [usage, setUsage] = useState<{
    sets: number;
    replays: number;
    bytes: number;
  } | null>(null);

  useEffect(() => {
    let live = true;
    contentUnitDefSetsUsage(undefined)
      .then((found) => {
        if (live) setUsage(found);
      })
      // The row is left out. Nothing else on the screen depends on it.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!usage) return null;
  const lists = plural(usage.sets, { one: "# list", other: "# lists" });
  const replays = plural(usage.replays, {
    one: "# replay",
    other: "# replays",
  });
  return (
    <SettingRow
      label={t`Replay unit lists`}
      description={
        usage.sets === 0 ? t`None kept yet` : t`${lists} for ${replays}`
      }
      help={
        <>
          <p>
            <Trans>
              A unit list lets a replay name its units after its game is updated
              or removed. One is kept the first time a replay's build orders are
              read, or when a replay is analysed.
            </Trans>
          </p>
          <p>
            <Trans>
              They are not a cache. Each goes when the last replay that uses it
              is deleted.
            </Trans>
          </p>
        </>
      }
      helpLabel={t`About replay unit lists`}
    >
      {usage.sets > 0 && (
        <span className="text-sm tabular-nums">{formatBytes(usage.bytes)}</span>
      )}
    </SettingRow>
  );
}

/** One content folder: what each kind of content takes, and the total. */
function RootUsage({
  root,
  state,
  canPrune,
  onOpen,
  onChanged,
}: {
  root: ContentRoot;
  state: RootState;
  /** Whether the rapid pool prune is allowed (no in-flight downloads). */
  canPrune: boolean;
  onOpen: (path: string) => void;
  /** Re-size this root after something was removed from it. */
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const hasPool = (category(state, "rapidPool")?.files ?? 0) > 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h3
          className="truncate font-mono text-xs text-muted-foreground"
          title={root.path}
        >
          {root.label ?? root.path}
        </h3>
        {hasPool && (
          <ReclaimSpaceButton
            rootPath={root.path}
            canPrune={canPrune}
            blockReason={t`Finish or cancel downloads first`}
            onReclaimed={onChanged}
          />
        )}
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
        <ul className="divide-y divide-border rounded-md border border-border">
          {state.overview.categories
            // An empty kind says nothing, and the total still covers it.
            .filter((c) => c.files > 0 || c.bytes > 0)
            .map((c) => (
              <CategoryRow key={c.id} category={c} onOpen={onOpen} />
            ))}
          <li className="flex items-center gap-4 bg-muted/30 px-4 py-2.5 text-sm font-medium">
            <span className="flex-1">
              <Trans>Total</Trans>
            </span>
            <span className="tabular-nums">
              {formatBytes(state.overview.totalBytes)}
            </span>
            <span className="w-8" />
          </li>
        </ul>
      )}
    </div>
  );
}

function CategoryRow({
  category: c,
  onOpen,
}: {
  category: StorageCategory;
  onOpen: (path: string) => void;
}) {
  const { t } = useLingui();
  const name = categoryLabel(t, c);
  const firstPath = c.paths[0];
  return (
    <li className="flex items-center gap-4 px-4 py-1.5 text-sm">
      <span className="min-w-0 flex-1">{name}</span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {plural(c.files, { one: "# file", other: "# files" })}
      </span>
      <span className="w-20 text-right tabular-nums">
        {formatBytes(c.bytes)}
      </span>
      {firstPath ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-8"
              onClick={() => onOpen(firstPath)}
              aria-label={t`Open the ${name} folder`}
            >
              <FolderOpen className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <Trans>Open the folder</Trans>
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="h-8 w-8" />
      )}
    </li>
  );
}

/** One installed engine, what it takes, and its delete. */
function EngineUsageRow({
  engine,
  rootPath,
  preferred,
  onOpen,
  onDeleted,
}: {
  engine: EngineUsage;
  rootPath: string;
  /** The engine every launch uses, which cannot be deleted. */
  preferred: boolean;
  onOpen: (path: string) => void;
  onDeleted: () => void;
}) {
  const { t } = useLingui();
  const version = engine.version;
  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {version}
          {preferred && (
            <span
              className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
              title={t`Every launch uses this engine. Set another as preferred on the Engines page to delete it.`}
            >
              <Star className="size-3 fill-current" />
              <Trans>Preferred</Trans>
            </span>
          )}
        </p>
        <p
          className="truncate font-mono text-xs text-muted-foreground"
          title={engine.path}
        >
          {pathInRoot(engine.path, rootPath)}
        </p>
      </div>
      <span className="text-sm tabular-nums">{formatBytes(engine.bytes)}</span>
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-8"
              onClick={() => onOpen(engine.path)}
              aria-label={t`Open the ${version} folder`}
            >
              <FolderOpen className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <Trans>Open the engine's folder</Trans>
          </TooltipContent>
        </Tooltip>
        {preferred ? (
          // Keeps the sizes lined up with the rows that have a delete.
          <span className="w-8" />
        ) : (
          <DeleteEngineButton engine={engine} onDeleted={onDeleted} />
        )}
      </div>
    </li>
  );
}
