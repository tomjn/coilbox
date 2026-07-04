import {
  type Campaign,
  type CampaignExportFile,
  parseCampaignJson,
} from "./model";

/**
 * The export wrapper's stable identity. An exported campaign is a
 * {@link CampaignExportFile}: this wrapper (so the importer can recognise the file
 * and its schema version) around a {@link Campaign} whose panoramas have all been
 * inlined as `data:` URIs, so it travels as a single self-contained file.
 */
export const EXPORT_FORMAT = "coilbox-campaign";
export const EXPORT_FORMAT_VERSION = 1;

/** Wrap a campaign (panoramas already inlined as data URIs) as an export file. */
export function wrapCampaignForExport(campaign: Campaign): CampaignExportFile {
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    campaign,
  };
}

/**
 * Parse an exported campaign file: validate the wrapper (format + version), then
 * the inner campaign via {@link parseCampaignJson}. Returns `null` on any mismatch
 * so an untrusted import surfaces a friendly inline error instead of crashing.
 */
export function parseCampaignExport(json: string): Campaign | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.format !== EXPORT_FORMAT || d.formatVersion !== EXPORT_FORMAT_VERSION) {
    return null;
  }
  if (typeof d.campaign !== "object" || d.campaign === null) return null;
  return parseCampaignJson(JSON.stringify(d.campaign));
}
