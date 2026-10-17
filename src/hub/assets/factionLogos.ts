import type { FactionLogosResult } from "@/content/bindings";
import { unitsyncFactionLogos } from "@/content/bindings";
import type { GameFaction } from "../games/facts";
import { type AssetKey, assetsTheHubWants } from "./have";
import { type AssetUpload, uploadAssetsToHub } from "./upload";

/**
 * Sending a game's faction logos to the hub (issue #4387).
 *
 * A logo is the small picture on a side's toggle and a faction's strip, read out
 * of the game's `Sidepics/` folder by the unitsync worker and encoded there as
 * the hub's `logo` asset. This asks the hub which ones it lacks and sends those,
 * through the same have check and upload the unit pictures use.
 *
 * ## Facts first
 *
 * The hub makes a faction's row from the game's facts and answers a logo for a
 * faction it has no row for with a 404. So the caller sends the game's facts
 * before this runs, and passes the factions that were in them. The key is the
 * facts' own (`gameFactions`), never one rebuilt here, because the two have to
 * agree character for character.
 *
 * ## The allowance
 *
 * Faction logos have their own hourly count per account per game on the hub,
 * separate from unit pictures, so sending them spends nothing from the unit
 * ledger in `./budget`.
 */

/** Everything this reaches outside itself, so a test can count the calls. */
export interface FactionLogoTools {
  logos: typeof unitsyncFactionLogos;
  ask: typeof assetsTheHubWants;
  upload: typeof uploadAssetsToHub;
}

export const liveFactionLogoTools: FactionLogoTools = {
  logos: unitsyncFactionLogos,
  ask: assetsTheHubWants,
  upload: uploadAssetsToHub,
};

/** What sending one game's logos came to. */
export interface FactionLogoPass {
  /** Logos the game ships and the worker encoded. */
  found: number;
  /** Logos the hub took. */
  written: number;
  /** Anything the worker or the upload said that is worth showing. */
  errors: string[];
}

/** A faction logo upload, narrowed from the union. */
type FactionUpload = Extract<AssetUpload, { keyed_on: "faction" }>;

/**
 * The logos that came out, as declarations.
 *
 * `factions` is what the game's facts named, and the worker is asked for each by
 * its name. A side the game ships no emblem for is simply absent from the result,
 * and so is not here.
 */
export function factionLogoUploads(
  game: string,
  factions: readonly GameFaction[],
  result: FactionLogosResult,
): FactionUpload[] {
  const keyOfName = new Map(factions.map((one) => [one.name, one.key]));
  const uploads: FactionUpload[] = [];
  const seen = new Set<string>();
  for (const logo of result.logos) {
    const key = keyOfName.get(logo.side);
    const asset = logo.asset;
    if (!key || !asset || seen.has(key)) continue;
    seen.add(key);
    uploads.push({
      keyed_on: "faction",
      game,
      faction_key: key,
      variant: asset.variant,
      source_hash: asset.sourceHash,
      encode_profile: asset.encodeProfile,
      origin: "extracted",
      mime: asset.mime,
      source_archive: asset.sourceArchive,
      path: asset.path,
    });
  }
  return uploads;
}

/** The have check's question for one ready logo. */
function keyOf(asset: FactionUpload): AssetKey {
  return {
    keyed_on: "faction",
    game: asset.game,
    faction_key: asset.faction_key,
    variant: asset.variant,
    source_hash: asset.source_hash,
  };
}

/**
 * Send the logos of one game's factions that the hub does not hold.
 *
 * Nothing throws for a game that ships none, or for a hub that refuses: the
 * upload reports what it was refused to the person who pressed the button, and
 * a worker that could not read the archive says so in {@link FactionLogoPass.errors}.
 */
export async function sendFactionLogos(
  target: {
    hubUrl: string;
    enginePath: string;
    dataDir: string;
    gameArchive: string;
  },
  shortname: string,
  factions: readonly GameFaction[],
  tools: FactionLogoTools = liveFactionLogoTools,
): Promise<FactionLogoPass> {
  const none: FactionLogoPass = { found: 0, written: 0, errors: [] };
  if (factions.length === 0) return none;

  const read = await tools.logos({
    enginePath: target.enginePath,
    dataDir: target.dataDir,
    gameArchive: target.gameArchive,
    sides: factions.map((one) => one.name),
    assets: true,
  });
  const errors = [...read.errors];
  const extracted = factionLogoUploads(shortname, factions, read);
  if (extracted.length === 0) return { ...none, errors };

  const keys = extracted.map(keyOf);
  const answers = await tools.ask(target.hubUrl, keys);
  const sending = extracted.filter(
    (_, at) => (answers[at]?.status ?? "missing") !== "have",
  );
  if (sending.length === 0)
    return { found: extracted.length, written: 0, errors };

  const run = await tools.upload(target.hubUrl, sending, {
    startedBy: "user",
    opId: crypto.randomUUID(),
  });
  return { found: extracted.length, written: run.written, errors };
}
