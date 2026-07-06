import { mediaKind } from "../lib/assetUrl";
import { type CampaignImageKind, campaignImageImportData } from "./bindings";
import type { Campaign, ImageRef } from "./model";
import { resolveImageDataUri } from "./panorama";

/**
 * Apply an async transform to every media ref on a campaign — its icon and
 * background, plus each mission's panorama, side graphic, voiceover and cutscene —
 * returning a new campaign. The transform is told which field it's handling so it can
 * pick the right encode bounds/format; a ref it resolves to `undefined` is dropped,
 * so one broken image never sinks the whole operation.
 *
 * Centralising the field list here keeps export (inline image `file` → `data`) and
 * import (materialise `data` → `file`) exhaustive: adding a media field to the model
 * means updating only this walker, not both call sites. The `kind` is only consulted
 * for image encoding; audio/video refs (voiceover/cutscene) pass through both
 * transforms untouched, so the kind handed to them is immaterial.
 */
async function mapCampaignImages(
  campaign: Campaign,
  transform: (
    ref: ImageRef,
    kind: CampaignImageKind,
  ) => Promise<ImageRef | undefined>,
): Promise<Campaign> {
  const one = (ref: ImageRef | undefined, kind: CampaignImageKind) =>
    ref ? transform(ref, kind) : Promise.resolve(undefined);

  const [icon, background, missions] = await Promise.all([
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
  ]);

  return { ...campaign, icon, background, missions };
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
export function inlineCampaignImages(campaign: Campaign): Promise<Campaign> {
  return mapCampaignImages(campaign, async (ref) => {
    if (ref.kind !== "file") return ref; // local + data pass through
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
 */
export function materializeCampaignImages(
  campaign: Campaign,
  campaignId: string,
): Promise<Campaign> {
  return mapCampaignImages(campaign, async (ref, kind) => {
    if (ref.kind !== "data") return ref;
    try {
      const { file } = await campaignImageImportData({
        campaignId,
        dataUri: ref.dataUri,
        kind,
      });
      return { kind: "file", file };
    } catch {
      return undefined;
    }
  });
}
