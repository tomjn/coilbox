import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type DownloadProgress,
  dlRecoilEngines,
  dlSpringfilesEngines,
  type EngineRelease,
  type SpringfilesEngine,
} from "../downloads/bindings";
import { useWriteRoot } from "../downloads/config";
import {
  identityOf,
  type QueueStatus,
  useDownloadComplete,
  useDownloadQueue,
} from "../downloads/DownloadQueueProvider";
import { useContentTargets, useUnitsyncScan } from "./config";
import {
  type ContentRequirement,
  type InstalledContentSnapshot,
  resolveVerdict,
} from "./resolveContent";

/** Live state of resolving a set of requirements against the recipient's own
 * install, plus the ability to download whatever's missing through the
 * app-wide download queue (`DownloadQueueProvider`). */
export interface ResolveContentState {
  /** True while the install scan (or, for engine requirements, the engine
   * catalogs) hasn't reported back yet. */
  loading: boolean;
  /** True when the install read stopped without saying what is installed, so
   * the check never happened and never will without the reader fixing the
   * engine (issue #1386). Nothing is `missing` and nothing is `resolved`. */
  unreadable: boolean;
  /** What the install read said when it stopped, when it said anything. */
  unreadableReason: string | null;
  /** Every requirement not yet satisfied, deduped. */
  missing: ContentRequirement[];
  /** True once every requirement is satisfied (including no requirements at
   * all) — the gate to call the actual import/launch step. */
  resolved: boolean;
  /** Queue a download for one missing requirement. A no-op if it can't be
   * downloaded right now (see {@link ResolveContentState.canDownload}). */
  download: (req: ContentRequirement) => void;
  /** The queue's live status for a requirement, or `null` before it's queued. */
  statusFor: (req: ContentRequirement) => QueueStatus | null;
  /** Live progress while a requirement is downloading. */
  progressFor: (req: ContentRequirement) => DownloadProgress | null;
  /** The queue's failure message for a requirement's last attempt, if any. */
  errorFor: (req: ContentRequirement) => string | null;
  /** Whether a requirement can be downloaded at all right now — false with no
   * write-root configured, or (engine requirements only) no catalog match. */
  canDownload: (req: ContentRequirement) => boolean;
  /**
   * True only once the download folder has been read and there is none.
   *
   * Separate from `!canDownload`, which is also false for the frame or two the
   * read takes, so a caller that blames the missing folder for a disabled
   * download only says so when that is what happened (issue #1104).
   */
  noWriteRoot: boolean;
}

/**
 * Resolve a set of content requirements against the given engine/data-root
 * target (typically `usePreferredTarget()`'s target), offering downloads for
 * anything missing via the app-wide queue. Re-scans after every queue
 * completion so a just-downloaded item clears from `missing` without a manual
 * refresh.
 *
 * `targetLoading` is the caller's own target read still being in flight. Pass
 * it, or a caller that reaches here before its engine is known reads as a
 * machine with nothing installed and gets offered downloads for content it
 * already has (issue #1377).
 */
export function useResolveContent(
  requirements: ContentRequirement[],
  target: { enginePath?: string; dataDir?: string } | undefined,
  targetLoading = false,
): ResolveContentState {
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const contentTargets = useContentTargets();
  const writeRoot = useWriteRoot();
  const writePath = writeRoot.path;
  const { enqueue, statusFor: queueStatusFor, items } = useDownloadQueue();

  const hasEngineReq = requirements.some((r) => r.kind === "engine");
  const [engineCatalog, setEngineCatalog] = useState<{
    recoil: EngineRelease[];
    springfiles: SpringfilesEngine[];
  } | null>(null);
  useEffect(() => {
    if (!hasEngineReq || engineCatalog) return;
    let cancelled = false;
    Promise.all([
      dlRecoilEngines(undefined).catch(() => ({
        releases: [] as EngineRelease[],
      })),
      dlSpringfilesEngines(undefined).catch(() => ({
        engines: [] as SpringfilesEngine[],
      })),
    ]).then(([r, s]) => {
      if (!cancelled)
        setEngineCatalog({ recoil: r.releases, springfiles: s.engines });
    });
    return () => {
      cancelled = true;
    };
  }, [hasEngineReq, engineCatalog]);

  useDownloadComplete(() => {
    scan.run(true);
    contentTargets.refresh();
  });

  const installed: InstalledContentSnapshot = useMemo(
    () => ({
      games: (scan.data?.games ?? []).map((g) => ({
        name: g.name,
        shortname: g.info.shortname,
        version: g.info.version,
      })),
      maps: (scan.data?.maps ?? []).map((m) => m.name),
      engineVersions: contentTargets.targets.map((t) => t.engineVersion),
    }),
    [scan.data, contentTargets.targets],
  );

  const { loading, unreadable, unreadableReason, missing, resolved } =
    resolveVerdict({
      requirements,
      installed,
      targetLoading,
      hasTarget: !!target?.enginePath && !!target?.dataDir,
      scan,
      enginesLoading: contentTargets.loading,
      engineCatalogPending: hasEngineReq && !engineCatalog,
    });

  const enqueueInputFor = useCallback(
    (req: ContentRequirement) => {
      if (!writePath) return null;
      const key = req.downloadKey ?? req.label;
      if (req.kind === "game") {
        // Resolve across every source in policy order (GitHub and mirrors first,
        // pr-downloader last, per issue 500) so a GitHub-only game such as
        // SplinterFaction installs instead of failing on rapid.
        return {
          kind: "game" as const,
          label: `Game: ${req.label}`,
          args: { gameName: key, writePath },
        };
      }
      if (req.kind === "map") {
        // Resolve across every source in policy order (known mirrors first,
        // pr-downloader last, per issue 511), matching the game requirement above.
        return {
          kind: "mapAnySource" as const,
          label: `Map: ${req.label}`,
          args: { mapName: key, writePath },
        };
      }
      if (!engineCatalog) return null;
      const recoil = engineCatalog.recoil.find((r) => r.version === key);
      if (recoil) {
        return {
          kind: "engineRecoil" as const,
          label: `Engine ${req.label}`,
          args: {
            version: recoil.version,
            assetUrl: recoil.assetUrl,
            writePath,
          },
        };
      }
      const spring = engineCatalog.springfiles.find((e) => e.version === key);
      if (spring) {
        return {
          kind: "engineSpring" as const,
          label: `Engine ${req.label}`,
          args: { version: spring.version, writePath },
        };
      }
      return null;
    },
    [writePath, engineCatalog],
  );

  const download = useCallback(
    (req: ContentRequirement) => {
      const input = enqueueInputFor(req);
      if (input) enqueue(input);
    },
    [enqueueInputFor, enqueue],
  );

  const statusFor = useCallback(
    (req: ContentRequirement) => {
      const input = enqueueInputFor(req);
      return input ? queueStatusFor(identityOf(input)) : null;
    },
    [enqueueInputFor, queueStatusFor],
  );

  const itemFor = useCallback(
    (req: ContentRequirement) => {
      const input = enqueueInputFor(req);
      if (!input) return null;
      const identity = identityOf(input);
      return items.find((i) => i.identity === identity) ?? null;
    },
    [enqueueInputFor, items],
  );

  const progressFor = useCallback(
    (req: ContentRequirement) => itemFor(req)?.progress ?? null,
    [itemFor],
  );
  const errorFor = useCallback(
    (req: ContentRequirement) => itemFor(req)?.error ?? null,
    [itemFor],
  );
  const canDownload = useCallback(
    (req: ContentRequirement) => enqueueInputFor(req) !== null,
    [enqueueInputFor],
  );

  return {
    loading,
    unreadable,
    unreadableReason,
    missing,
    resolved,
    download,
    statusFor,
    progressFor,
    errorFor,
    canDownload,
    noWriteRoot: !writeRoot.loading && !writePath,
  };
}
