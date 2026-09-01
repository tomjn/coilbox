/**
 * Copying a campaign somebody already has (issues #2189 and #2224).
 *
 * A campaign is playable when it holds at least one mission and every mission
 * names a game and a map (`campaignIsPlayable`). Both of those come from a
 * snapshot of a saved preset, which is a copy of setup made on this machine
 * against content this machine has installed. Nothing coilbox could ship as a
 * starter template can supply either: a template naming BAR and Comet Catcher
 * is a draft on an install that has neither, and a template naming no game is
 * the blank document it was meant to replace. So the only starter that is
 * already playable is a campaign this install already has, and the way to start
 * from one is to copy it.
 *
 * That covers both wants. An author iterating on their own campaign copies it
 * and edits the copy, and somebody who wants to build on a campaign their
 * distribution bundled copies that instead, which is the one-step version of
 * export-then-import that #2224 asks for.
 *
 * What a copy carries:
 *
 * - Every mission, with its snapshot, its attached scenario, its objectives and
 *   its restrictions. Mission and scenario ids are kept, the way import keeps
 *   them, so an attached scenario's dialogue clips still resolve out of the
 *   media store (they are keyed by the scenario's own id, see `scenarioMedia.ts`)
 *   and a mission still reads as attached to the scenario it came from.
 * - Every image, written afresh under the new campaign's own id.
 * - Nothing from the original's progress. Progress is keyed by campaign id, so
 *   a copy starts unplayed, which is what a copy made to be edited wants.
 */

import { mediaKind } from "../lib/assetUrl";
import { campaignImageImportData } from "./bindings";
import { mapCampaignImages } from "./images";
import type { Campaign } from "./model";
import { resolveImageDataUri } from "./panorama";

/**
 * The title for a copy of `title`, unused by any of `taken`.
 *
 * "Copy of X" alone is enough once. Copying the same campaign twice to compare
 * two variants is the reason somebody duplicates at all, and two rows reading
 * "Copy of Beachhead" cannot be told apart in a list that shows the title, so
 * the second one counts up.
 */
export function copyTitle(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `Copy of ${title}`;
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) candidate = `${base} (${n++})`;
  return candidate;
}

export interface DuplicatedCampaign {
  /** The copy, not yet saved. */
  campaign: Campaign;
  /** How many audio or video files had to stay with the original. */
  droppedMedia: number;
}

/**
 * A copy of `source` under a fresh id, with its images copied into that id's
 * own image folder. Returns the document to save rather than saving it, so the
 * caller owns the write and the failure it can report.
 *
 * One pass over the same media walker export and import use, because a media ref
 * means something different in the copy depending on how it is stored:
 *
 * - A `file` image belongs to the source campaign's folder, so it is read back
 *   and written again under the new id. That is the round trip import already
 *   does, and it costs the image a second JPEG or PNG encode.
 * - A `local` ref is a path into the distribution's own `.coilbox` folder, which
 *   is where it stays. This is how a copy of a bundled campaign keeps its art.
 * - A `data` ref carries its bytes inline and is already good under any id.
 * - A `file` audio or video file cannot be copied. Its bytes live in the source
 *   campaign's `media/<id>/` folder, and the only way into another campaign's
 *   folder is an import command that takes a path on disk or a base64 URI, and
 *   the frontend has neither for a stored clip. Keeping the ref would give the
 *   copy a voiceover that silently plays nothing, so it is dropped and counted,
 *   and the caller says so.
 *
 * An image that cannot be read or written is dropped too, the way it is on
 * export and import. One broken picture does not sink the copy.
 */
export async function duplicateCampaign(
  source: Campaign,
  title: string,
  now: string = new Date().toISOString(),
): Promise<DuplicatedCampaign> {
  const id = crypto.randomUUID();
  let droppedMedia = 0;

  const copied = await mapCampaignImages(source, async (ref, kind) => {
    if (ref.kind !== "file") return ref;
    if (mediaKind(ref.file) !== "image") {
      droppedMedia++;
      return undefined;
    }
    try {
      const dataUri = await resolveImageDataUri(source.id, ref.file);
      const { file } = await campaignImageImportData({
        campaignId: id,
        dataUri,
        kind,
      });
      return { kind: "file", file };
    } catch {
      return undefined;
    }
  });

  return {
    campaign: { ...copied, id, title, createdAt: now, updatedAt: now },
    droppedMedia,
  };
}
