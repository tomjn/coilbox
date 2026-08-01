import { scenarioMediaRead, scenarioMediaWrite } from "../scenario/bindings";
import { listScenarios, sweepScenarioMedia } from "../scenario/storage";
import {
  dropMissingDialogueMedia,
  scenarioMediaFiles,
} from "../scenario/transfer";
import { campaignList } from "./bindings";
import type { Campaign } from "./model";
import { type CampaignScenarioMedia, parseCampaignExport } from "./transfer";

/**
 * Moving an attached scenario's dialogue clips in and out of a campaign export
 * (issues #769 and #866).
 *
 * A mission carries a whole scenario document, but a dialogue line names its
 * portrait and voice clip as bare file names living in the app's scenario media
 * store under the scenario's id. `scenario_write_mission` copies them out of that
 * store at launch. So a mission plays with its clips only while that store holds
 * them, which stops being true the moment the campaign leaves the machine it was
 * authored on, or the author deletes the scenario they attached.
 *
 * Export reads the clips out of the store and inlines them. Import writes them
 * back in. Both key on the *snapshot's own* scenario id, the one the source
 * document had, because that id is also the `missions/<id>/` folder a compiled
 * mission is written into and the value of the `coilbox_mission` modoption.
 * Minting a fresh id here would work as long as all three moved together, but it
 * would also make every imported mission read as `orphaned` even for an author
 * who has the source scenario, so the id is kept.
 *
 * Writing under an id this machine already has is safe: stored clip names are
 * minted as `<uuid>.<ext>` per import (`scenario_media_import`), so a given name
 * always holds the same bytes and an overwrite is a rewrite of what was there.
 */

/** Each attached scenario's id mapped to the clip names it references, unioned
 * across missions so two missions on one scenario are read once. */
function referencedClips(campaign: Campaign): Map<string, Set<string>> {
  const wanted = new Map<string, Set<string>>();
  for (const mission of campaign.missions) {
    if (!mission.scenario) continue;
    const files = wanted.get(mission.scenario.id) ?? new Set<string>();
    for (const file of scenarioMediaFiles(mission.scenario)) files.add(file);
    wanted.set(mission.scenario.id, files);
  }
  return wanted;
}

/**
 * True when a campaign mission's snapshot still names this exact clip.
 *
 * The narrow half of `scenarioIsAttached` in `missionScenario.ts`, which decides
 * the same thing for a whole scenario. A snapshot names its clips by file name,
 * and a stored
 * name always holds the same bytes, so a name a snapshot still carries is a file
 * that mission still plays.
 */
export function clipIsAttached(
  campaigns: Campaign[],
  scenarioId: string,
  file: string,
): boolean {
  return campaigns.some((campaign) =>
    referencedClips(campaign).get(scenarioId)?.has(file),
  );
}

/**
 * Read every attached scenario's dialogue clips out of the media store, inlined
 * as `data:` URIs, ready to travel in an export. A clip that cannot be read is
 * left out rather than sinking the export, the way a broken campaign image is.
 */
export async function collectCampaignScenarioMedia(
  campaign: Campaign,
): Promise<CampaignScenarioMedia> {
  const media: CampaignScenarioMedia = {};
  await Promise.all(
    [...referencedClips(campaign)].map(async ([scenarioId, files]) => {
      const clips: Record<string, string> = {};
      await Promise.all(
        [...files].map(async (file) => {
          try {
            const { dataUrl } = await scenarioMediaRead({ scenarioId, file });
            clips[file] = dataUrl;
          } catch {
            console.warn("skipping unreadable dialogue clip", scenarioId, file);
          }
        }),
      );
      if (Object.keys(clips).length > 0) media[scenarioId] = clips;
    }),
  );
  return media;
}

/**
 * Write an imported campaign's dialogue clips into the scenario media store, so
 * its missions play with their portraits and voices on a machine that has never
 * seen the source scenarios. Returns what actually landed, keyed by scenario id,
 * for {@link dropUnavailableDialogueMedia}.
 *
 * The 16 MB per-clip ceiling and the `data:` check are the plugin's
 * (`scenario_media_write`), so an export from outside cannot write an arbitrary
 * file. A rejected clip costs that line its picture and nothing more.
 */
export async function restoreCampaignScenarioMedia(
  media: CampaignScenarioMedia,
): Promise<Map<string, Set<string>>> {
  const written = new Map<string, Set<string>>();
  for (const [scenarioId, clips] of Object.entries(media)) {
    const landed = new Set<string>();
    for (const [file, dataUri] of Object.entries(clips)) {
      try {
        await scenarioMediaWrite({ scenarioId, file, dataUri });
        landed.add(file);
      } catch {
        console.warn("skipping unwritable dialogue clip", scenarioId, file);
      }
    }
    written.set(scenarioId, landed);
  }
  return written;
}

/**
 * Campaigns whose clips this session has already materialised, so a second
 * launch does not decode and rewrite the same files.
 */
const materialised = new Set<string>();

/**
 * Put a bundled campaign's dialogue clips in the media store, before one of its
 * missions is launched (issue #877).
 *
 * An imported campaign wrote its clips at import time. A bundled one never went
 * through import: it is read straight out of `.coilbox/campaigns/` as the file
 * the builder exported, and `parseCampaignJson` unwraps the document and leaves
 * the clips beside it untouched. So without this a distribution's missions play
 * their radio messages with no portrait and no voice.
 *
 * They go in the ordinary media store, under the ids the export carried, even
 * though the campaign itself is read-only. That store is the only place
 * `scenario_write_mission` reads from, so anywhere else would mean teaching the
 * write path a second root for the sake of a handful of small files. While the
 * campaign is bundled they are held the way an imported campaign's are, because
 * `scenarioIsAttached` and {@link clipIsAttached} both count bundled campaigns.
 * When it stops being bundled {@link sweepOrphanedScenarioMedia} takes them.
 *
 * Called on the launch path rather than when the list is read, because the list
 * is read on every app start for the sidebar's campaign gate and this decodes
 * and writes files. A campaign that carries no media, which is every local one
 * and every campaign authored before the scenario editor, costs one read.
 */
export async function ensureCampaignScenarioMedia(
  campaignId: string,
): Promise<void> {
  if (materialised.has(campaignId)) return;
  materialised.add(campaignId);
  try {
    const { items } = await campaignList({});
    for (const item of items) {
      if (item.source !== "bundled") continue;
      const parsed = parseCampaignExport(item.json);
      if (!parsed || parsed.campaign.id !== campaignId || !parsed.media) {
        continue;
      }
      await restoreCampaignScenarioMedia(parsed.media);
      return;
    }
  } catch (e) {
    // Retry on the next launch: a clip that did not land only costs a line its
    // picture, so this must never be the reason a mission does not start.
    materialised.delete(campaignId);
    console.warn("could not materialise bundled dialogue clips", e);
  }
}

/** Every scenario id something on this machine still names its clips by. */
export function namedScenarioIds(
  scenarios: readonly { id: string }[],
  campaigns: readonly Campaign[],
): Set<string> {
  const named = new Set<string>();
  for (const scenario of scenarios) named.add(scenario.id);
  for (const campaign of campaigns) {
    for (const mission of campaign.missions) {
      if (mission.scenario) named.add(mission.scenario.id);
    }
  }
  return named;
}

/** Whether this session has already swept. */
let swept = false;

/**
 * Drop the media folders nothing names any more (issue #919).
 *
 * A scenario's own clips go when the scenario does. A bundled campaign's are
 * written here on the launch path instead, and the only thing holding them is
 * the campaign still being bundled. A distribution that drops that campaign, or
 * ships a version of it whose scenarios carry different clips, leaves the old
 * folders behind for good. So does a local campaign the author deleted after
 * deleting the scenario it attached, which kept the clips for its sake.
 *
 * `campaigns` is every campaign there is, because the caller has just read them
 * all. A partial list would read a folder that is named as one that is not, so
 * a caller that could not read them must not call this at all.
 *
 * Once a session, off the campaign list read, which happens on start for the
 * sidebar's campaign gate. Anything orphaned after that is collected on the next
 * start: these are a handful of small files, so this is tidiness rather than a
 * cost worth scanning the disk repeatedly for.
 */
export async function sweepOrphanedScenarioMedia(
  campaigns: readonly Campaign[],
): Promise<void> {
  if (swept) return;
  swept = true;
  try {
    const removed = await sweepScenarioMedia(
      namedScenarioIds(await listScenarios(), campaigns),
    );
    if (removed.length > 0) {
      console.info("dropped dialogue clips nothing names", removed);
    }
  } catch (e) {
    swept = false;
    console.warn("could not sweep orphaned dialogue clips", e);
  }
}

/**
 * Drop every dialogue reference to a clip that did not arrive, so a stored
 * campaign never names a portrait or voice clip that is not on this machine.
 *
 * Only for an export that carried media. An older export carries none, and its
 * missions' clips either exist here already (the author's own campaign) or never
 * will, so stripping the references would only lose information.
 */
export function dropUnavailableDialogueMedia(
  campaign: Campaign,
  available: ReadonlyMap<string, ReadonlySet<string>>,
): Campaign {
  return {
    ...campaign,
    missions: campaign.missions.map((mission) =>
      mission.scenario
        ? {
            ...mission,
            scenario: dropMissingDialogueMedia(
              mission.scenario,
              available.get(mission.scenario.id) ?? new Set<string>(),
            ),
          }
        : mission,
    ),
  };
}
