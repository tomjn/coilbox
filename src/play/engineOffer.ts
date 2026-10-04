/**
 * What the skirmish page offers when it has no engine (issue #3365).
 *
 * Pure, so the decision is tested without React. The engine offered is the
 * newest build the release catalog lists for this platform. Nothing in the
 * branding catalog or the distribution profile names an engine, and with none
 * installed there is no game to say which one it wants, so "newest" is the
 * same default the first-run setup card already uses (`fetchNewestRecoil`).
 */

export interface EngineOfferReadings {
  /** An installed engine is available to launch with. */
  hasTarget: boolean;
  /** The installed engines have not been read yet. */
  targetLoading: boolean;
  writeRoot: { loading: boolean; path?: string };
  /** The newest build in the engine catalog. `version` is null when the
   *  catalog lists none for this platform. */
  newestEngine: { loaded: boolean; version: string | null };
}

export type EngineOffer =
  /** An engine is installed, so there is nothing to offer. */
  | { kind: "none" }
  /** Something is still being read. Say nothing yet. */
  | { kind: "pending" }
  /** Offer to download this engine version. */
  | { kind: "download"; version: string }
  /** Nothing can be downloaded: no folder to write to, or no build listed.
   *  The page points at the content folders setting. */
  | { kind: "settings" };

export function skirmishEngineOffer(r: EngineOfferReadings): EngineOffer {
  if (r.hasTarget) return { kind: "none" };
  if (r.targetLoading || r.writeRoot.loading || !r.newestEngine.loaded) {
    return { kind: "pending" };
  }
  if (!r.writeRoot.path || !r.newestEngine.version) return { kind: "settings" };
  return { kind: "download", version: r.newestEngine.version };
}
