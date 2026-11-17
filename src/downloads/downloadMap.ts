import { t } from "@lingui/core/macro";
import type { HubFileDownload } from "../hub/api";
import { knownMap } from "../hub/maps/knownMaps";
import { dlDownloadMapRaw } from "./bindings";
import { type DownloadAttempt, hostOf } from "./downloadHistory";
import { downloadFromMirrors } from "./downloadMirrors";
import { withDownloadNotify } from "./downloadNotify";
import { norm } from "./gameRepos";
import { fetchHubFile } from "./hubFileDownload";
import { getHubMapBase } from "./hubMapBase";
import { type MapSource, mapSourceOrder } from "./mapSources";
import {
  findInIndex,
  indexTick,
  loadEvolutionRtsMaps,
  loadHakoraMaps,
  loadSpringfilesList,
} from "./mirrorIndex";
import { type ProgressSink, progressChannel } from "./progressChannel";
import {
  AttemptLog,
  isCancel,
  nextKind,
  orderFrom,
  type SourceStep,
  SourceWalkError,
} from "./sourceWalk";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * What the hub lists for a map, or none when there is no write root to save to,
 * the hub is off, or it knows nothing of the map (issue #5251). `knownMap` never
 * rejects, so a hub that cannot be reached is the same as one with no sources.
 */
async function hubMapSources(
  mapName: string,
  hasWritePath: boolean,
): Promise<HubFileDownload[]> {
  const base = getHubMapBase();
  if (!base || !hasWritePath) return [];
  return (await knownMap(base, mapName))?.downloads ?? [];
}

/** The step that names a hub source, as a retry offers it. */
function hubStep(dl: HubFileDownload): SourceStep {
  return {
    source: dl.kind,
    mirror: dl.kind === "url" ? hostOf(dl.value) : null,
  };
}

/**
 * Where in the hub's sources a retry starts. A step of kind `url` or `github`
 * can only have come from this step, since no other map source records as
 * either, so it names a hub source: the first of that kind on the same host.
 * Anything else starts at the first.
 */
function hubStartIndex(
  sources: readonly HubFileDownload[],
  startAt?: SourceStep,
): number {
  if (startAt?.source !== "url" && startAt?.source !== "github") return 0;
  const at = sources.findIndex((s) => {
    const step = hubStep(s);
    return (
      step.source === startAt.source &&
      (startAt.mirror === null || step.mirror === startAt.mirror)
    );
  });
  return Math.max(at, 0);
}

/**
 * Download a map, trying each source in the order set by mapSourceOrder and
 * resolving with the name of the first that succeeds. Per project policy (issue
 * 511, following #500's game ordering) that order is known mirrors first, then
 * pr-downloader (rapid) as the last resort, with the hub's own sources ahead of
 * the mirrors (issue #5251).
 *
 * 0. the hub: every source it lists for the map, in its order and github
 *    entries included, so an author's repository comes before any known mirror.
 *    Each is an attempt of its own, and a failure moves on to the next. Present
 *    only when the hub lists some. A hub that is off, cannot be reached or does
 *    not know the map lists none.
 * 1. the maps.evolutionrts.info mirror of maps first made for Beyond All
 *    Reason. Match by filename, since it carries no springname.
 * 2. springfiles catalog mirror. Match by springname/name, then fetch each of
 *    its mirrors in turn until one delivers (issue #4577).
 * 3. the hakora.xyz mirror. Match by filename, like evolutionrts.
 * 4. rapid via pr-downloader, on its own default search, which is springfiles.
 *
 * Steps 0-3 need a write root. Without one only rapid is attempted. Throws with
 * every attempted source's error when all fail.
 *
 * There was another step: retrying rapid against Beyond All Reason's
 * `files-cdn` search. It is gone, and deliberately not replaced. That endpoint
 * resolves a springname by fetching the archive and storing a copy, so asking it
 * for a map BAR does not have makes BAR host somebody else's map at their own
 * cost. This step asked it for every map the mirrors above had missed, whatever
 * game it belonged to. The price of removing it is that BAR-exclusive maps
 * carried by no other mirror can no longer be downloaded here at all.
 *
 * The mirror indexes come from `mirrorIndex`, which holds each for the session.
 * A map missing from a held index refetches it once, unless the held copy
 * loaded after `askedAt`, when the download was asked for.
 *
 * Progress arrives as a sink rather than a channel, because each attempt needs a
 * channel of its own: see `progressChannel` for what sharing one costs.
 */
async function downloadMapAnySourceImpl(opts: {
  mapName: string;
  writePath?: string;
  /** Pass a stable id to make the active download cancellable via dlCancel. */
  opId?: string;
  onProgress: ProgressSink;
  /** The `indexTick` when the download was asked for. Defaults to now. */
  askedAt?: number;
  /** Told about each source tried, whether it worked or not (issue #4576). */
  onAttempt?: (attempt: DownloadAttempt) => void;
  /** Skip the sources before this one, for a retry on the next (issue #4577). */
  startAt?: SourceStep;
  /** Told which source each attempt is on as it starts (issue #4583). */
  onSource?: (step: SourceStep) => void;
}): Promise<string> {
  const { mapName, writePath, opId, onProgress, startAt } = opts;
  const askedAt = opts.askedAt ?? indexTick();
  const target = norm(mapName);
  const log = new AttemptLog(opts.onAttempt, opts.onSource);
  const hubSources = await hubMapSources(mapName, !!writePath);
  const order = mapSourceOrder({
    hasWritePath: !!writePath,
    hasHubSources: hubSources.length > 0,
  });

  /** Fetch a file from its mirrors, and say which kind of source it was. */
  const fetchFile = async (
    source: Exclude<MapSource, "hub">,
    urls: readonly string[],
    filename: string,
    label: string,
  ): Promise<string | null> =>
    (await downloadFromMirrors({
      source,
      urls,
      destDir: `${writePath}/maps`,
      filename,
      opId,
      onProgress,
      log,
      startAt,
      afterSource: nextKind(order, source),
    }))
      ? label
      : null;

  /**
   * Try each hub source in turn. A cancel stops the walk with the hub source
   * after the one cancelled as the next step, or the step after the hub's when
   * it was the last.
   */
  const fetchFromHub = async (): Promise<string | null> => {
    const from = hubStartIndex(hubSources, startAt);
    for (const [i, dl] of hubSources.slice(from).entries()) {
      try {
        await fetchHubFile(dl, {
          destDir: `${writePath}/maps`,
          opId,
          onProgress,
          log,
        });
        return `hub: ${dl.kind === "url" ? (hostOf(dl.value) ?? dl.value) : dl.value}`;
      } catch (e) {
        if (isCancel(e)) {
          const rest = hubSources[from + i + 1];
          throw new SourceWalkError(
            msg(e),
            rest ? hubStep(rest) : nextKind(order, "hub"),
          );
        }
        log.fail(e);
      }
    }
    return null;
  };

  const attempt = async (source: MapSource): Promise<string | null> => {
    switch (source) {
      case "hub":
        return fetchFromHub();
      case "springfiles": {
        if (!writePath) return null;
        const hit = await findInIndex(
          (refresh) => loadSpringfilesList("map", refresh),
          ({ results }) =>
            results.find(
              (f) => norm(f.springname) === target || norm(f.name) === target,
            ),
          askedAt,
        );
        if (!hit?.mirrors?.length) return null;
        return fetchFile(
          source,
          hit.mirrors,
          hit.filename,
          "springfiles mirror",
        );
      }
      case "hakora": {
        if (!writePath) return null;
        const hit = await findInIndex(
          loadHakoraMaps,
          ({ maps }) => maps.find((m) => norm(m.filename) === target),
          askedAt,
        );
        if (!hit) return null;
        return fetchFile(source, [hit.url], hit.filename, "hakora");
      }
      case "evolutionrts": {
        if (!writePath) return null;
        const hit = await findInIndex(
          loadEvolutionRtsMaps,
          ({ maps }) => maps.find((m) => norm(m.filename) === target),
          askedAt,
        );
        if (!hit) return null;
        return fetchFile(
          source,
          [hit.url],
          hit.filename,
          "evolutionrts mirror",
        );
      }
      case "rapid": {
        // The pr-downloader step fetches from springfiles too.
        log.begin(
          source,
          { reference: mapName },
          { recordAs: "springfiles", label: "springfiles (pr-downloader)" },
        );
        await dlDownloadMapRaw({
          springName: mapName,
          writePath,
          opId,
          onProgress: progressChannel(onProgress),
        });
        return "springfiles (pr-downloader)";
      }
    }
  };

  for (const source of orderFrom(order, startAt)) {
    // The hub step begins an attempt for each source it lists.
    if (source !== "hub") log.begin(source);
    try {
      const result = await attempt(source);
      if (result) {
        log.ok();
        return result;
      }
    } catch (e) {
      if (e instanceof SourceWalkError) throw e;
      if (isCancel(e))
        throw new SourceWalkError(msg(e), nextKind(order, source));
      log.fail(e);
    }
  }

  const errors = log.errors.join("; ");
  throw new SourceWalkError(
    t`No source could provide "${mapName}". ${errors}`,
    null,
  );
}

export const downloadMapAnySource = withDownloadNotify(
  downloadMapAnySourceImpl,
  (o) => o.mapName,
);
