import { scenarioMediaRead, scenarioMediaWrite } from "../scenario/bindings";
import {
  dropMissingDialogueMedia,
  scenarioMediaFiles,
} from "../scenario/transfer";
import type { Campaign } from "./model";
import type { CampaignScenarioMedia } from "./transfer";

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
