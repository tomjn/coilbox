import { t } from "@lingui/core/macro";
import { dlDownloadMapRaw } from "./bindings";
import type { DownloadAttempt } from "./downloadHistory";
import { downloadFromMirrors } from "./downloadMirrors";
import { withDownloadNotify } from "./downloadNotify";
import { norm } from "./gameRepos";
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
 * Download a map, trying each source in the order set by mapSourceOrder and
 * resolving with the name of the first that succeeds. Per project policy (issue
 * 511, following #500's game ordering) that order is known mirrors first, then
 * pr-downloader (rapid) as the last resort.
 *
 * 1. the maps.evolutionrts.info mirror of maps first made for Beyond All
 *    Reason. Match by filename, since it carries no springname.
 * 2. springfiles catalog mirror. Match by springname/name, then fetch each of
 *    its mirrors in turn until one delivers (issue #4577).
 * 3. the hakora.xyz mirror. Match by filename, like evolutionrts.
 * 4. rapid via pr-downloader, on its own default search, which is springfiles.
 *
 * Steps 1-3 need a write root. Without one only rapid is attempted. Throws with
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
  const order = mapSourceOrder({ hasWritePath: !!writePath });

  /** Fetch a file from its mirrors, and say which kind of source it was. */
  const fetchFile = async (
    source: MapSource,
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

  const attempt = async (source: MapSource): Promise<string | null> => {
    switch (source) {
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
    log.begin(source);
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
