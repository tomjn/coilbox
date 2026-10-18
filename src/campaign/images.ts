import { mediaKind } from "../lib/assetUrl";
import {
  type CampaignImageKind,
  campaignImageImportData,
  campaignUnitFileRead,
  campaignUnitFileWrite,
  campaignUnitList,
} from "./bindings";
import {
  type Campaign,
  type CampaignUnit,
  type ImageRef,
  UNIT_FILE,
} from "./model";
import { resolveImageDataUri } from "./panorama";

/**
 * What a ref is for: an image field, whose kind picks the encode bounds, or one
 * file of an attached unit's copy, which travels as it is (issue #4517).
 */
type RefSlot = CampaignImageKind | { unitName: string; file: string };

/**
 * Apply an async transform to every media ref on a campaign — its icon and
 * background, plus each mission's panorama, side graphic, voiceover and cutscene,
 * and the files of each attached unit's copy — returning a new campaign. The
 * transform is told which field it's handling so it can pick the right encode
 * bounds/format; a ref it resolves to `undefined` is dropped, so one broken image
 * never sinks the whole operation.
 *
 * Centralising the field list here keeps export (inline image `file` → `data`) and
 * import (materialise `data` → `file`) exhaustive: adding a media field to the model
 * means updating only this walker, not both call sites. The `kind` is only consulted
 * for image encoding; audio/video refs (voiceover/cutscene) pass through both
 * transforms untouched, so the kind handed to them is immaterial.
 */
async function mapCampaignImages(
  campaign: Campaign,
  transform: (ref: ImageRef, slot: RefSlot) => Promise<ImageRef | undefined>,
): Promise<Campaign> {
  const one = (ref: ImageRef | undefined, kind: CampaignImageKind) =>
    ref ? transform(ref, kind) : Promise.resolve(undefined);

  // `unit.json` goes last. A copy's folder is listed only once it holds one, so
  // an import that stops part way leaves nothing a launch would read.
  const unitFiles = async (unit: CampaignUnit) => {
    if (!unit.files) return unit;
    const files: Record<string, ImageRef> = {};
    const carry = async (file: string) => {
      const next = await transform(unit.files?.[file] as ImageRef, {
        unitName: unit.unitName,
        file,
      });
      if (next) files[file] = next;
    };
    const names = Object.keys(unit.files);
    await Promise.all(names.filter((n) => n !== UNIT_FILE).map(carry));
    if (names.includes(UNIT_FILE)) await carry(UNIT_FILE);
    return { ...unit, files };
  };

  const [icon, background, missions, units] = await Promise.all([
    one(campaign.icon, "icon"),
    one(campaign.background, "background"),
    Promise.all(
      campaign.missions.map(async (m) => {
        const [panorama, sideGraphic, voiceover, cutscene] = await Promise.all([
          one(m.panorama, "panorama"),
          one(m.sideGraphic, "sideGraphic"),
          one(m.voiceover, "panorama"),
          one(m.cutscene, "panorama"),
        ]);
        return { ...m, panorama, sideGraphic, voiceover, cutscene };
      }),
    ),
    campaign.units
      ? Promise.all(campaign.units.map(unitFiles))
      : Promise.resolve(undefined),
  ]);

  return {
    ...campaign,
    icon,
    background,
    missions,
    ...(units ? { units } : {}),
  };
}

/**
 * Give each attached unit the list of files its copy holds, as `file` refs for
 * the walker to inline. A unit whose copy is not on disk gets none, and exports
 * as an entry with no files.
 */
async function withUnitFileRefs(campaign: Campaign): Promise<Campaign> {
  if (!campaign.units?.length) return campaign;
  const { units: stored } = await campaignUnitList({ campaignId: campaign.id });
  return {
    ...campaign,
    units: campaign.units.map((unit) => {
      const copy = stored.find((s) => s.unitName === unit.unitName);
      if (!copy) return unit;
      const files: Record<string, ImageRef> = {};
      for (const file of [UNIT_FILE, ...copy.files]) {
        files[file] = { kind: "file", file };
      }
      return { ...unit, files };
    }),
  };
}

/** What `inlineCampaignImages` can be asked to carry besides images. */
export interface InlineOptions {
  /**
   * Carry each attached unit's copy: `unit.json` and the textures in its
   * folder. The bundled atlas is not in a folder, so it is never carried. For
   * an export file, not for a duplicate, which copies the folders themselves.
   */
  units?: boolean;
}

/**
 * Inline every stored *image* `file` as a base64 `data` URI, producing a
 * self-contained campaign for export. A `file` that can't be read is dropped.
 *
 * `local` refs and audio/video `file` refs pass through verbatim: `local` points at
 * distribution-bundled files that travel alongside the JSON, and AV is far too large
 * to inline (and can't be range-served as a data URI). Consequence: a single-JSON
 * export of a campaign with user-imported AV keeps `file` refs that only resolve on
 * the authoring machine — sharing such AV needs a bundle export (a follow-up).
 */
export async function inlineCampaignImages(
  campaign: Campaign,
  { units = false }: InlineOptions = {},
): Promise<Campaign> {
  const source = units ? await withUnitFileRefs(campaign) : campaign;
  return mapCampaignImages(source, async (ref, slot) => {
    if (ref.kind !== "file") return ref; // local + data pass through
    if (typeof slot === "object") {
      try {
        const { dataUri } = await campaignUnitFileRead({
          campaignId: campaign.id,
          unitName: slot.unitName,
          file: slot.file,
        });
        return { kind: "data", dataUri };
      } catch {
        return undefined;
      }
    }
    if (mediaKind(ref.file) !== "image") return ref; // AV file can't be inlined
    try {
      const dataUri = await resolveImageDataUri(campaign.id, ref.file);
      return { kind: "data", dataUri };
    } catch {
      return undefined;
    }
  });
}

/**
 * Materialise every embedded `data` image to a file under `campaignId`, producing a
 * campaign whose images live on disk (for import). Each field imports with its own
 * kind so icons/side graphics keep alpha. A broken embedded image is dropped.
 *
 * A unit's embedded files are written into its copy's folder under the same
 * names, and the entry's `files` are removed: the folder is the copy from then
 * on. A unit whose `unit.json` did not arrive is dropped from the campaign,
 * since a mission naming it would refuse to launch.
 */
export async function materializeCampaignImages(
  campaign: Campaign,
  campaignId: string,
): Promise<Campaign> {
  const written = await mapCampaignImages(campaign, async (ref, slot) => {
    if (ref.kind !== "data") return ref;
    try {
      if (typeof slot === "object") {
        await campaignUnitFileWrite({
          campaignId,
          unitName: slot.unitName,
          file: slot.file,
          dataUri: ref.dataUri,
        });
        return { kind: "file", file: slot.file };
      }
      const { file } = await campaignImageImportData({
        campaignId,
        dataUri: ref.dataUri,
        kind: slot,
      });
      return { kind: "file", file };
    } catch {
      return undefined;
    }
  });
  if (!written.units) return written;
  const units = written.units
    .filter((unit) => !unit.files || unit.files[UNIT_FILE])
    .map(({ files: _files, ...unit }) => unit);
  return { ...written, units: units.length > 0 ? units : undefined };
}
