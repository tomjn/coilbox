import { type CampaignImageKind, campaignImageImportData } from "./bindings";
import type { Campaign, ImageRef } from "./model";
import { resolveImageDataUri } from "./panorama";

/**
 * Apply an async transform to every image on a campaign — its icon and background,
 * plus each mission's panorama and side graphic — returning a new campaign. The
 * transform is told which field it's handling so it can pick the right encode
 * bounds/format; a ref it resolves to `undefined` is dropped, so one broken image
 * never sinks the whole operation.
 *
 * Centralising the field list here keeps export (inline `file` → `data`) and import
 * (materialise `data` → `file`) exhaustive: adding an image field to the model means
 * updating only this walker, not both call sites.
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
        const [panorama, sideGraphic] = await Promise.all([
          one(m.panorama, "panorama"),
          one(m.sideGraphic, "sideGraphic"),
        ]);
        return { ...m, panorama, sideGraphic };
      }),
    ),
  ]);

  return { ...campaign, icon, background, missions };
}

/**
 * Inline every stored `file` image as a base64 `data` URI, producing a
 * self-contained campaign for export. A `file` that can't be read is dropped.
 */
export function inlineCampaignImages(campaign: Campaign): Promise<Campaign> {
  return mapCampaignImages(campaign, async (ref) => {
    if (ref.kind !== "file") return ref;
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
