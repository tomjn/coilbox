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
 * payload carries a {@link Campaign} with every panorama inlined as a `data:` URI
 * so it travels as one self-contained file.
 *
 * There are two payload shapes, and which one is written depends on what the
 * campaign holds (issue #769):
 *
 * - `kindVersion: 1`, the payload *is* the campaign document. Written whenever no
 *   mission carries a scenario, which is every campaign authored before the
 *   scenario editor.
 * - `kindVersion: 2`, the payload is `{ campaign, media }`, where `media` holds
 *   each attached scenario's dialogue clips inlined as `data:` URIs, keyed by
 *   scenario id then by the bare file name the document references. Written
 *   whenever any mission carries a scenario.
 *
 * The clips travel *beside* the document rather than inside it for the reason
 * `../scenario/transfer.ts` gives at length: a dialogue line names its portrait
 * and voice clip as bare file names, because the compile step copies those files
 * into the game's VFS where the engine loads them by name. Inlining them into the
 * document would change what `compileScenario` emits.
 *
 * The version is conditional rather than always 2 because `kindVersion` is what
 * stops an older coilbox opening a file it cannot honour. A campaign with a
 * scenario is exactly that: an older build parses the document, silently drops
 * the `scenario` field it has never heard of, and offers a mission that plays as
 * a bare skirmish with none of the triggers the author wrote. A campaign
 * *without* scenarios has no such problem, so bumping its version would lock
 * older builds out of files they can play perfectly well.
 */
export const CAMPAIGN_KIND_VERSION = 2;

/** The payload version for a campaign no older build could misread: the document
 * alone, exactly as campaigns have always been exported. */
export const CAMPAIGN_KIND_VERSION_PLAIN = 1;

/** The pre-container wrapper, still read for backward compatibility. */
export const EXPORT_FORMAT = "coilbox-campaign";
export const EXPORT_FORMAT_VERSION = 1;

/**
 * Every attached scenario's dialogue clips: scenario id, then the bare file name
 * the document references, then the clip as a `data:` URI.
 */
export type CampaignScenarioMedia = Record<string, Record<string, string>>;

/** A `kindVersion: 2` payload: the document beside its scenarios' clips. */
export interface CampaignExport {
  campaign: Campaign;
  media: CampaignScenarioMedia;
}

/**
 * What reading an export file yields. `media` is `null` when the file predates
 * media carrying (a `kindVersion: 1` container or the legacy wrapper), which is
 * not the same as a file that carries an empty set.
 */
export interface CampaignExportContents {
  campaign: Campaign;
  media: CampaignScenarioMedia | null;
}

/** True when any mission carries a scenario, which is what decides the payload
 * version an export is written at. */
export function campaignCarriesScenarios(campaign: Campaign): boolean {
  return campaign.missions.some((m) => m.scenario);
}

/**
 * Wrap a campaign (panoramas already inlined as data URIs) as an export file,
 * carrying `media` when the campaign has scenarios to carry it for.
 */
export function wrapCampaignForExport(
  campaign: Campaign,
  media: CampaignScenarioMedia = {},
): Container<Campaign | CampaignExport> {
  if (!campaignCarriesScenarios(campaign)) {
    return makeContainer("campaign", CAMPAIGN_KIND_VERSION_PLAIN, campaign);
  }
  return makeContainer("campaign", CAMPAIGN_KIND_VERSION, { campaign, media });
}

/**
 * Narrow an untrusted `media` value. A malformed entry is dropped rather than
 * rejecting the import, the way a scenario export's is: a missing portrait costs
 * a line its picture, where refusing costs the author the whole campaign.
 */
function parseScenarioMedia(value: unknown): CampaignScenarioMedia {
  const media: CampaignScenarioMedia = {};
  if (typeof value !== "object" || value === null) return media;
  for (const [scenarioId, clips] of Object.entries(value as object)) {
    if (typeof clips !== "object" || clips === null) continue;
    const kept: Record<string, string> = {};
    for (const [file, uri] of Object.entries(clips as object)) {
      if (typeof uri === "string" && uri.startsWith("data:")) kept[file] = uri;
    }
    if (Object.keys(kept).length > 0) media[scenarioId] = kept;
  }
  return media;
}

/**
 * Parse an exported campaign file: accept either payload version of the canonical
 * container or the legacy wrapper, then validate the inner campaign via
 * {@link parseCampaignJson}. Returns `null` on any mismatch (including a
 * newer-version file) so an untrusted import surfaces a friendly inline error
 * instead of crashing. A bare, unwrapped campaign document is deliberately
 * rejected here, use {@link parseCampaignJson} directly for that.
 */
export function parseCampaignExport(
  json: string,
): CampaignExportContents | null {
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
    const payload = container.payload as Record<string, unknown>;
    const carriesMedia = container.kindVersion >= CAMPAIGN_KIND_VERSION;
    const document = carriesMedia ? payload.campaign : payload;
    const campaign = parseCampaignJson(JSON.stringify(document ?? null));
    if (!campaign) return null;
    return {
      campaign,
      media: carriesMedia ? parseScenarioMedia(payload.media) : null,
    };
  }

  // Legacy pre-container wrapper, so campaigns exported before #479 still open.
  const d = data as Record<string, unknown>;
  if (d.format !== EXPORT_FORMAT || d.formatVersion !== EXPORT_FORMAT_VERSION) {
    return null;
  }
  if (typeof d.campaign !== "object" || d.campaign === null) return null;
  const campaign = parseCampaignJson(JSON.stringify(d.campaign));
  return campaign ? { campaign, media: null } : null;
}
