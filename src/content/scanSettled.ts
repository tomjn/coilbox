/** A unitsync scan reading, as much of it as anything outside the hook needs. */
export interface ScanReading {
  loading: boolean;
  data: unknown;
  error: string | null;
  cancelled: boolean;
}

/**
 * Whether the unitsync scan has gone as far as it is ever going to.
 *
 * Not the same question as "did it find anything". A scan that errored, or that
 * was cancelled, has answered: it will not answer again without something else
 * changing, and a caller that waits for data it is never going to get waits
 * forever. That is the difference between a reader who sees an empty install and
 * a reader who sees a spinner that never stops.
 *
 * An install with no engine has no scan to wait for and never will, so it is
 * settled the moment the target read says there is no target.
 *
 * Shared, because two readers act on "the inventory has answered": the home
 * page's map inventory (`../home/suggestedMap`) and the get-started offer
 * (`./getStartedOffer`). They decide different things off it, and the whole point
 * of the offer being shared is that the two cannot disagree about whether the
 * question is answerable yet.
 */
export function scanSettled(args: {
  /** The preferred-target read is still in flight. */
  targetLoading: boolean;
  /** There is an engine and a data dir to scan. */
  hasTarget: boolean;
  scan: ScanReading;
}): boolean {
  if (args.targetLoading) return false;
  if (!args.hasTarget) return true;
  const { loading, data, error, cancelled } = args.scan;
  return !loading && (data !== null || error !== null || cancelled);
}
