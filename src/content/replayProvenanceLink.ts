import type { ReplayProvenance } from "./replayUserState";

/**
 * Where a tagged replay's provenance links back to. Conquest and warpath both
 * link to the run/galaxy with the node preselected via `?node=` when the
 * provenance carries one (warpath's node route mirrors conquest's, see #469).
 * Campaign links straight to the mission briefing. A stale/deleted target
 * (galaxy, run or mission no longer exists, or a node id that no longer
 * exists in it) still resolves to a route, each destination page already
 * renders its own "not found" or degraded state rather than crashing.
 */
export function provenanceLink(
  p: ReplayProvenance,
): { to: string; label: string } | null {
  switch (p.mode) {
    case "conquest":
      if (!p.galaxyId) return null;
      return {
        to: p.nodeId
          ? `/conquest/${encodeURIComponent(p.galaxyId)}?node=${encodeURIComponent(p.nodeId)}`
          : `/conquest/${encodeURIComponent(p.galaxyId)}`,
        label: "Back to conquest galaxy",
      };
    case "warpath":
      if (!p.runId) return null;
      return {
        to: p.nodeId
          ? `/warpath/${encodeURIComponent(p.runId)}?node=${encodeURIComponent(p.nodeId)}`
          : `/warpath/${encodeURIComponent(p.runId)}`,
        label: "Back to warpath run",
      };
    case "campaign":
      if (!p.campaignId || !p.missionId) return null;
      return {
        to: `/campaign/${encodeURIComponent(p.campaignId)}/${encodeURIComponent(p.missionId)}`,
        label: "Back to mission",
      };
    case "refight":
      if (!p.sourceReplayFilename) return null;
      return {
        to: `/play/replays/${encodeURIComponent(p.sourceReplayFilename)}`,
        label: "Back to original replay",
      };
    default:
      return null;
  }
}
