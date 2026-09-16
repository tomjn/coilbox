import {
  dlDownloadFileRaw,
  dlDownloadMapRaw,
  dlHakoraMaps,
  dlSpringfilesList,
} from "./bindings";
import { withDownloadNotify } from "./downloadNotify";
import { norm } from "./gameRepos";
import { type MapSource, mapSourceOrder } from "./mapSources";
import { type ProgressSink, progressChannel } from "./progressChannel";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Download a map, trying each source in the order set by mapSourceOrder and
 * resolving with the name of the first that succeeds. Per project policy (issue
 * 511, following #500's game ordering) that order is known mirrors first, then
 * pr-downloader (rapid) as the last resort.
 *
 * 1. springfiles catalog mirror. Match by springname/name, fetch the first mirror.
 * 2. the hakora.xyz mirror. Match by filename, since it carries no springname.
 * 3. rapid via pr-downloader, on its own default search, which is springfiles.
 *
 * Steps 1-2 need a write root. Without one only rapid is attempted. Throws with
 * every attempted source's error when all fail.
 *
 * There was a fourth step: retrying rapid against Beyond All Reason's
 * `files-cdn` search. It is gone, and deliberately not replaced. That endpoint
 * resolves a springname by fetching the archive and storing a copy, so asking it
 * for a map BAR does not have makes BAR host somebody else's map at their own
 * cost. This step asked it for every map the mirrors above had missed, whatever
 * game it belonged to. The price of removing it is that BAR-exclusive maps
 * carried by no other mirror can no longer be downloaded here at all.
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
}): Promise<string> {
  const { mapName, writePath, opId, onProgress } = opts;
  const target = norm(mapName);
  const errors: string[] = [];

  const attempt = async (source: MapSource): Promise<string | null> => {
    switch (source) {
      case "springfiles": {
        if (!writePath) return null;
        const { results } = await dlSpringfilesList({ category: "map" });
        const hit = results.find(
          (f) => norm(f.springname) === target || norm(f.name) === target,
        );
        const url = hit?.mirrors?.[0];
        if (!hit || !url) return null;
        await dlDownloadFileRaw({
          url,
          destDir: `${writePath}/maps`,
          filename: hit.filename,
          opId,
          onProgress: progressChannel(onProgress),
        });
        return "springfiles mirror";
      }
      case "hakora": {
        if (!writePath) return null;
        const { maps } = await dlHakoraMaps(undefined);
        const hit = maps.find((m) => norm(m.filename) === target);
        if (!hit) return null;
        await dlDownloadFileRaw({
          url: hit.url,
          destDir: `${writePath}/maps`,
          filename: hit.filename,
          opId,
          onProgress: progressChannel(onProgress),
        });
        return "hakora";
      }
      case "rapid": {
        const label = "springfiles (pr-downloader)";
        try {
          await dlDownloadMapRaw({
            springName: mapName,
            writePath,
            opId,
            onProgress: progressChannel(onProgress),
          });
          return label;
        } catch (e) {
          errors.push(`${label}: ${msg(e)}`);
        }
        return null;
      }
    }
  };

  const order = mapSourceOrder({ hasWritePath: !!writePath });
  for (const source of order) {
    try {
      const result = await attempt(source);
      if (result) return result;
    } catch (e) {
      errors.push(`${source}: ${msg(e)}`);
    }
  }

  throw new Error(`No source could provide "${mapName}". ${errors.join("; ")}`);
}

export const downloadMapAnySource = withDownloadNotify(
  downloadMapAnySourceImpl,
  (o) => o.mapName,
);
