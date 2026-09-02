import { campaignMediaDelete } from "./bindings";
import type { Campaign, CampaignMission } from "./model";

/**
 * Which files a campaign has imported, and which of them nothing names any more
 * (issue #2210).
 *
 * A mission can import into four slots and a campaign into two more, and each
 * one lands in the campaign's own folder under app-data. Removing the mission,
 * or replacing what a slot holds, used to drop the reference and leave the file
 * behind: the editor only ever deleted a panorama, and the command it used could
 * not reach the folder that audio and video go to. Nothing else on the page
 * could see the leftovers, so they went only when the whole campaign did.
 *
 * The slot list lives here rather than at each call site, because a slot added
 * to the document and forgotten at the delete is how this happened. The
 * confirmation on mission removal reads the same list, so what it promises goes
 * is what goes.
 */

/** One imported file a document holds, and the slot it sits in. */
export interface StoredMedia {
  /** The slot's name in the UI, for a confirmation that has to say what it takes. */
  label: string;
  /** The bare filename in the campaign's `images/` or `media/` folder. */
  file: string;
}

/** Every mission slot that can hold an imported file, in the order they are edited. */
const MISSION_SLOTS = [
  ["panorama", "panorama"],
  ["sideGraphic", "side graphic"],
  ["voiceover", "briefing voiceover"],
  ["cutscene", "intro cutscene"],
] as const;

/** The campaign's own two image slots. */
const CAMPAIGN_SLOTS = [
  ["icon", "icon"],
  ["background", "background"],
] as const;

/**
 * The files this mission imported. Only a `file` ref is one: a `data` ref
 * carries its bytes inline and a `local` ref points at something the
 * distribution shipped, and neither is the campaign's to delete.
 */
export function missionMedia(mission: CampaignMission): StoredMedia[] {
  return MISSION_SLOTS.flatMap(([slot, label]) => {
    const ref = mission[slot];
    return ref?.kind === "file" ? [{ label, file: ref.file }] : [];
  });
}

/** Every imported file the whole document names, missions and campaign alike. */
export function campaignMediaFiles(campaign: Campaign): Set<string> {
  const files = CAMPAIGN_SLOTS.flatMap(([slot]) => {
    const ref = campaign[slot];
    return ref?.kind === "file" ? [ref.file] : [];
  });
  for (const mission of campaign.missions) {
    files.push(...missionMedia(mission).map((m) => m.file));
  }
  return new Set(files);
}

/**
 * The files `prev` imported that `next` no longer names anywhere.
 *
 * Whole-document rather than per-slot, because the same file can be named twice
 * (a mission copied from another, or an import that reused a stored ref), and a
 * file another slot still plays is one the campaign still needs.
 */
export function droppedMediaFiles(prev: Campaign, next: Campaign): string[] {
  const kept = campaignMediaFiles(next);
  return [...campaignMediaFiles(prev)].filter((file) => !kept.has(file));
}

/**
 * Delete whatever `candidates` names that `next` does not. Best-effort: a file
 * that will not go is wasted disk space, which is not worth failing an edit
 * the author has already made and stopping them saving it.
 *
 * `candidates` is not necessarily one document's files: a caller tracking
 * every unwritten edit rather than just the oldest document can hand this the
 * whole accumulated set, so a file that arrived and left again before either
 * edit reached disk is still found (issue #2374).
 */
export async function deleteUnnamedMedia(
  campaignId: string,
  candidates: Iterable<string>,
  next: Campaign,
): Promise<void> {
  const kept = campaignMediaFiles(next);
  for (const file of candidates) {
    if (kept.has(file)) continue;
    try {
      const { deleted } = await campaignMediaDelete({ campaignId, file });
      // The document named a file neither folder held. Nothing to do about it
      // here, but a delete that quietly removes nothing is what issue #2210
      // was, so it is said out loud rather than read as a removal.
      if (!deleted) {
        console.warn("campaign media was already gone", file);
      }
    } catch (e) {
      console.error("could not delete campaign media", file, e);
    }
  }
}

/**
 * Delete the files `next` leaves behind, comparing it against one earlier
 * document. Best-effort, for the same reason `deleteUnnamedMedia` is.
 */
export async function deleteDroppedMedia(
  campaignId: string,
  prev: Campaign,
  next: Campaign,
): Promise<void> {
  await deleteUnnamedMedia(campaignId, campaignMediaFiles(prev), next);
}
