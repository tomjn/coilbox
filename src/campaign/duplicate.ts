/**
 * Copying a campaign somebody already has (issue #2189).
 *
 * A campaign is playable when it holds at least one mission and every mission
 * names a game and a map (`campaignIsPlayable`). Both come from a snapshot of a
 * saved preset, which is a copy of setup made on this machine against content
 * this machine has installed. Nothing coilbox could ship as a starter template
 * can supply either: a template naming BAR and Comet Catcher is a Draft on an
 * install that has neither, and a template naming no game is the blank document
 * it was meant to replace. So the only starter already past the Draft badge is a
 * campaign this install already has, and the way to start from one is to copy it.
 *
 * What a copy carries:
 *
 * - Every mission, with its snapshot, its attached scenario, its objectives and
 *   its restrictions. Mission and scenario ids are kept, the way import keeps
 *   them, so an attached scenario's dialogue clips still resolve out of the media
 *   store (they are keyed by the scenario's own id, see `scenarioMedia.ts`) and a
 *   mission still reads as attached to the scenario it came from.
 * - Every stored image and every stored audio or video file, written afresh under
 *   the new campaign's own id.
 * - Nothing from the original's progress. Progress is keyed by campaign id, so a
 *   copy starts unplayed, which is what a copy made to be edited wants.
 */

import { campaignMediaUrl, mediaKind } from "../lib/assetUrl";
import { fetchAsDataUrl } from "../lib/dataUrl";
import { campaignMediaImportData } from "./bindings";
import { inlineCampaignImages, materializeCampaignImages } from "./images";
import type { Campaign, ImageRef } from "./model";
import { ensureCampaignScenarioMedia } from "./scenarioMedia";

/**
 * The title for a copy of `title`, unused by any of `taken`.
 *
 * "Copy of X" alone is enough once. Copying one campaign twice to compare two
 * variants is a reason somebody duplicates at all, and two rows reading "Copy of
 * Beachhead" cannot be told apart in a list that shows the title, so the second
 * one counts up.
 */
export function copyTitle(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `Copy of ${title}`;
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) candidate = `${base} (${n++})`;
  return candidate;
}

/**
 * Every media slot a campaign has, as the refs currently in them.
 *
 * The read-only twin of the field list in `mapCampaignImages` (`images.ts`),
 * which is the walker export and import share. It is written out a second time
 * here because that walker is not exported, so adding a media field to the model
 * means updating this list too. Exporting the one walker would collapse the two,
 * and that is a change to `images.ts` to make with the next change to it.
 */
function mediaRefs(campaign: Campaign): (ImageRef | undefined)[] {
  return [
    campaign.icon,
    campaign.background,
    ...campaign.missions.flatMap((m) => [
      m.panorama,
      m.sideGraphic,
      m.voiceover,
      m.cutscene,
    ]),
  ];
}

/** How many of a campaign's media slots are filled. */
function mediaCount(campaign: Campaign): number {
  return mediaRefs(campaign).filter(Boolean).length;
}

/**
 * Copy one stored audio or video file into `targetId`'s own media folder, and
 * return the ref the copy should carry.
 *
 * Anything that is not a stored AV file passes through. A `local` ref is a path
 * into the distribution's `.coilbox` folder, which is where it stays and is how a
 * copy of a bundled campaign keeps its art without a second set of bytes. A
 * `data` ref carries its bytes inline and is already good under any id. An image
 * `file` is the image pass's job.
 *
 * A stored AV `file` is the one that cannot be left alone. It names a bare file
 * under the *source* campaign's `media/<id>/` folder, and `campaign_delete`
 * removes that whole folder, so a copy that kept the ref would play its voiceover
 * only until somebody deleted the campaign it was copied from. The bytes are read
 * back off the `coilbox://` protocol and written again under the new id, which is
 * the same round trip the archive-import picker already makes.
 */
async function copyStoredMedia(
  sourceId: string,
  targetId: string,
  ref: ImageRef | undefined,
): Promise<ImageRef | undefined> {
  if (ref?.kind !== "file" || mediaKind(ref.file) === "image") return ref;
  const dataUri = await fetchAsDataUrl(campaignMediaUrl(sourceId, ref.file));
  if (!dataUri) return undefined;
  try {
    const { file } = await campaignMediaImportData({
      campaignId: targetId,
      dataUri,
      ext: ref.file.split(".").pop() ?? "",
    });
    return { kind: "file", file };
  } catch {
    return undefined;
  }
}

/** Every AV slot copied into `targetId`, dropping any file that will not read. */
async function copyCampaignMedia(
  campaign: Campaign,
  sourceId: string,
  targetId: string,
): Promise<Campaign> {
  const one = (ref: ImageRef | undefined) =>
    copyStoredMedia(sourceId, targetId, ref);

  const [icon, background, missions] = await Promise.all([
    one(campaign.icon),
    one(campaign.background),
    Promise.all(
      campaign.missions.map(async (m) => {
        const [panorama, sideGraphic, voiceover, cutscene] = await Promise.all([
          one(m.panorama),
          one(m.sideGraphic),
          one(m.voiceover),
          one(m.cutscene),
        ]);
        return { ...m, panorama, sideGraphic, voiceover, cutscene };
      }),
    ),
  ]);

  return { ...campaign, icon, background, missions };
}

export interface CampaignCopy {
  /** The copy, not yet saved. */
  campaign: Campaign;
  /** How many media files could not be copied and were left out. */
  droppedMedia: number;
}

/**
 * A copy of `source` under a fresh id, with its media copied into that id's own
 * folders. Returns the document to save rather than saving it, so the caller owns
 * the write and the failure it can report.
 *
 * Images go through export's inline pass and import's materialise pass back to
 * back, which is the round trip that already re-ids an imported campaign's art.
 * It costs each image a second decode and re-encode, and it means one walker
 * rather than a second copy of the encode bounds each field wants.
 *
 * A file that cannot be read or written is dropped rather than sinking the copy,
 * the way it is on export and import, and the count of what went is returned so
 * the caller can say so. Silently handing back a campaign whose briefings have
 * lost their art would be the worse failure.
 *
 * A bundled campaign's dialogue clips are only written into the media store on
 * the launch path, and that path finds them by looking up a *bundled* campaign
 * with that id, which the copy is not. So they are put there first, under the
 * scenario ids both campaigns name. For a local campaign this reads the campaign
 * list and does nothing else.
 */
export async function duplicateCampaign(
  source: Campaign,
  title: string,
  now: string = new Date().toISOString(),
): Promise<CampaignCopy> {
  const id = crypto.randomUUID();
  await ensureCampaignScenarioMedia(source.id);

  const withImages = await materializeCampaignImages(
    await inlineCampaignImages(source),
    id,
  );
  const copied = await copyCampaignMedia(withImages, source.id, id);

  return {
    campaign: { ...copied, id, title, createdAt: now, updatedAt: now },
    droppedMedia: mediaCount(source) - mediaCount(copied),
  };
}
