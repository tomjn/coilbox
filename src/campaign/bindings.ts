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
 * What an imported image is for. Selects the plugin's size bound and encoder:
 * `panorama`/`background` re-encode to opaque JPEG; `icon`/`sideGraphic` keep
 * alpha as PNG so a transparent logo/emblem isn't flattened onto black. Omitting it
 * defaults to `panorama`.
 */
export type CampaignImageKind =
  | "panorama"
  | "background"
  | "icon"
  | "sideGraphic";

/**
 * Import an image from a file the user picked: decoded, downscaled to the kind's
 * bounds and re-encoded by the plugin. Returns the bare stored filename.
 */
export const campaignImageImport = defineCommand<
  { campaignId: string; srcPath: string; kind?: CampaignImageKind },
  { file: string }
>("coilbox-campaign", "campaign_image_import");

/**
 * Import an image from a base64 `data:` URI (materializing an image embedded in an
 * imported campaign). Same decode + downscale + re-encode bounds as the file
 * import. Returns the bare stored filename.
 */
export const campaignImageImportData = defineCommand<
  { campaignId: string; dataUri: string; kind?: CampaignImageKind },
  { file: string }
>("coilbox-campaign", "campaign_image_import_data");

/**
 * Import an audio/video file the user picked, copied **verbatim** (no re-encode) into
 * the campaign's `media/<id>/` folder. Returns the bare stored filename; reference it
 * as a `{ kind: "file" }` media ref, resolved to a `coilbox://` URL for playback.
 */
export const campaignMediaImport = defineCommand<
  { campaignId: string; srcPath: string },
  { file: string }
>("coilbox-campaign", "campaign_media_import");

/**
 * Import an audio/video clip from a base64 `data:` URI, copied verbatim like
 * {@link campaignMediaImport} (no re-encode). Used by the archive-import picker:
 * the clip is read out of a game archive via unitsync, not a file the user
 * picked, so there is no on-disk `srcPath` to hand the file-based command.
 * `ext` (no leading dot) picks the stored file's extension. Returns the bare
 * stored filename.
 */
export const campaignMediaImportData = defineCommand<
  { campaignId: string; dataUri: string; ext: string },
  { file: string }
>("coilbox-campaign", "campaign_media_import_data");

/** Read a stored panorama back as a `data:` URL for display. */
export const campaignImageRead = defineCommand<
  { campaignId: string; file: string },
  { dataUrl: string }
>("coilbox-campaign", "campaign_image_read");

/**
 * Delete one file a mission imported, whichever folder it went into: a
 * re-encoded image under `images/<id>/` or a verbatim clip under `media/<id>/`.
 * The stored ref carries only the filename, so the plugin looks in both.
 *
 * `deleted` is false when neither folder held it, which is not an error (the
 * mission is dropping a reference either way) but is not a removal either. A
 * campaign id or file name that could reach outside those folders is rejected.
 */
export const campaignMediaDelete = defineCommand<
  { campaignId: string; file: string },
  { deleted: boolean; from: "images" | "media" | null }
>("coilbox-campaign", "campaign_media_delete");

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

/** One stored copy of a builder unit, as `campaign_unit_list` answers it. */
export interface StoredCampaignUnit {
  unitName: string;
  /** The copy itself, parsed by `units.ts`. */
  json: string;
  /** The copy's folder, which its textures are read from at launch. */
  dir: string;
  /** The textures in that folder, by file name. */
  files: string[];
}

/**
 * Whose unit copies a command reads or writes: a campaign's (the default), a
 * conquest's, keyed by galaxy id, or a warpath run's (issue #4518). Each keeps
 * its copies beside its own data.
 */
export type UnitsScope = "campaign" | "conquest" | "warpath";

/**
 * Store a campaign's copy of one builder unit under
 * `units/<campaignId>/<unitName>/`, replacing an earlier copy whole (issue
 * #4516). `atlas` is an extension pack's atlas to carry, and `stored` the
 * texture store keys to carry. The base pack's atlas ships with coilbox and is
 * never carried. Answers the copy's folder.
 */
export const campaignUnitSave = defineCommand<
  {
    campaignId: string;
    scope?: UnitsScope;
    unitName: string;
    json: string;
    atlas: { pack: string; name: string } | null;
    stored: string[];
  },
  { dir: string }
>("coilbox-campaign", "campaign_unit_save");

/** Every builder unit copy a campaign holds. */
export const campaignUnitList = defineCommand<
  { campaignId: string; scope?: UnitsScope },
  { units: StoredCampaignUnit[] }
>("coilbox-campaign", "campaign_unit_list");

/** Remove a campaign's copy of one builder unit. */
export const campaignUnitDelete = defineCommand<
  { campaignId: string; scope?: UnitsScope; unitName: string },
  { deleted: boolean }
>("coilbox-campaign", "campaign_unit_delete");

/** Remove every builder unit copy one conquest or run holds. */
export const campaignUnitsDelete = defineCommand<
  { campaignId: string; scope: UnitsScope },
  { deleted: boolean }
>("coilbox-campaign", "campaign_units_delete");

/** Copy every builder unit copy from one campaign to another. */
export const campaignUnitsCopy = defineCommand<
  { fromId: string; toId: string },
  { copied: number }
>("coilbox-campaign", "campaign_units_copy");

/** Read one file of a unit copy, `unit.json` or a texture, as a `data:` URI. */
export const campaignUnitFileRead = defineCommand<
  { campaignId: string; unitName: string; file: string },
  { dataUri: string }
>("coilbox-campaign", "campaign_unit_file_read");

/**
 * Write one file of a unit copy from a `data:` URI. Write the textures before
 * `unit.json`: a folder without one is not a copy, so a copy that stops part
 * way is never read.
 */
export const campaignUnitFileWrite = defineCommand<
  { campaignId: string; unitName: string; file: string; dataUri: string },
  { file: string }
>("coilbox-campaign", "campaign_unit_file_write");
