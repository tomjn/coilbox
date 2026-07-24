import {
  asContainer,
  CONTAINER_VERSION,
  type Container,
  decodeContainerText,
  makeContainer,
} from "../container/container";
import { type Campaign, parseCampaignJson } from "./model";

/**
 * Campaign export/import (issue #479). An exported campaign is a canonical
 * coilbox container (`../container/container.ts`) with `kind: "campaign"`, whose
 * payload is a {@link Campaign} with every panorama inlined as a `data:` URI so
 * it travels as one self-contained file.
 */
export const CAMPAIGN_KIND_VERSION = 1;

/** The pre-container wrapper, still read for backward compatibility. */
export const EXPORT_FORMAT = "coilbox-campaign";
export const EXPORT_FORMAT_VERSION = 1;

/** Wrap a campaign (panoramas already inlined as data URIs) as an export file. */
export function wrapCampaignForExport(campaign: Campaign): Container<Campaign> {
  return makeContainer("campaign", CAMPAIGN_KIND_VERSION, campaign);
}

/**
 * Parse an exported campaign file: accept the canonical container or the legacy
 * wrapper, then validate the inner campaign via {@link parseCampaignJson}.
 * Returns `null` on any mismatch (including a newer-version file) so an
 * untrusted import surfaces a friendly inline error instead of crashing. A bare,
 * unwrapped campaign document is deliberately rejected here, use
 * {@link parseCampaignJson} directly for that.
 */
export function parseCampaignExport(json: string): Campaign | null {
  const data = decodeContainerText(json);
  if (typeof data !== "object" || data === null) return null;

  const container = asContainer(data);
  if (container) {
    if (container.kind !== "campaign") return null;
    if (container.container > CONTAINER_VERSION) return null;
    if (container.kindVersion > CAMPAIGN_KIND_VERSION) return null;
    if (typeof container.payload !== "object" || container.payload === null) {
      return null;
    }
    return parseCampaignJson(JSON.stringify(container.payload));
  }

  // Legacy pre-container wrapper, so campaigns exported before #479 still open.
  const d = data as Record<string, unknown>;
  if (d.format !== EXPORT_FORMAT || d.formatVersion !== EXPORT_FORMAT_VERSION) {
    return null;
  }
  if (typeof d.campaign !== "object" || d.campaign === null) return null;
  return parseCampaignJson(JSON.stringify(d.campaign));
}
