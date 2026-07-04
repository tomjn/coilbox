import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * Typed bindings to the `coilbox-campaign` plugin. Campaign documents and progress
 * cross the boundary as opaque JSON strings (the frontend owns the schema, see
 * `model.ts`); the plugin only handles storage, safe image import/re-encode and
 * opaque import/export round-trips.
 */

/** One stored campaign document plus where it was read from. */
export interface CampaignListItem {
  json: string;
  /** `bundled` campaigns ship read-only in the portable `.coilbox` folder. */
  source: "local" | "bundled";
}

/** Every stored campaign: writable local documents, then read-only bundled ones. */
export const campaignList = defineCommand<
  Record<string, never>,
  { items: CampaignListItem[] }
>("coilbox-campaign", "campaign_list");

/** Write a campaign document (serialized by the caller). Id: `[A-Za-z0-9-]+`. */
export const campaignSave = defineCommand<
  { id: string; json: string },
  Record<string, never>
>("coilbox-campaign", "campaign_save");

/** Delete a campaign document and its imported images. */
export const campaignDelete = defineCommand<
  { id: string },
  Record<string, never>
>("coilbox-campaign", "campaign_delete");

/**
 * Import a panorama from a file the user picked: decoded, downscaled to bounds and
 * re-encoded as JPEG by the plugin. Returns the bare stored filename.
 */
export const campaignImageImport = defineCommand<
  { campaignId: string; srcPath: string },
  { file: string }
>("coilbox-campaign", "campaign_image_import");

/**
 * Import a panorama from a base64 `data:` URI (materializing an image embedded in
 * an imported campaign). Same decode + downscale + re-encode bounds as the file
 * import. Returns the bare stored filename.
 */
export const campaignImageImportData = defineCommand<
  { campaignId: string; dataUri: string },
  { file: string }
>("coilbox-campaign", "campaign_image_import_data");

/** Read a stored panorama back as a `data:` URL for display. */
export const campaignImageRead = defineCommand<
  { campaignId: string; file: string },
  { dataUrl: string }
>("coilbox-campaign", "campaign_image_read");

/** Best-effort removal of a stored panorama. */
export const campaignImageDelete = defineCommand<
  { campaignId: string; file: string },
  Record<string, never>
>("coilbox-campaign", "campaign_image_delete");

/** Write a caller-serialized campaign export document to a chosen path. */
export const campaignExport = defineCommand<
  { json: string; dest: string },
  Record<string, never>
>("coilbox-campaign", "campaign_export");

/** Read a campaign export file the user picked; the caller parses/validates it. */
export const campaignImport = defineCommand<{ src: string }, { json: string }>(
  "coilbox-campaign",
  "campaign_import",
);

/** Load the opaque progress document (an empty default when none exists yet). */
export const campaignProgressLoad = defineCommand<
  Record<string, never>,
  { json: string }
>("coilbox-campaign", "campaign_progress_load");

/** Persist the opaque progress document. */
export const campaignProgressSave = defineCommand<
  { json: string },
  Record<string, never>
>("coilbox-campaign", "campaign_progress_save");
