/**
 * The campaigns a game ships inside its own archive (issue #2161).
 *
 * The campaign twin of `scenario/gameScenarios.ts`. A game lays a campaign out
 * as `campaigns/<folder>/campaign.json`, which is the same document the builder
 * exports, and puts the campaign's media beside it. A `file` ref in that
 * document names one of those files, where in a stored campaign it names one in
 * coilbox's own media folder.
 *
 * A game's campaign is read-only, because a packaged archive cannot be written
 * and a loose one belongs to its game, not to coilbox. Progress is unaffected:
 * it was never in the campaign document, it is in coilbox's own progress file
 * keyed by campaign id, which is how a bundled campaign already tracks it.
 */

import type { GameItem } from "../content/bindings";
import { isSdd } from "../content/format";
import { AUDIO_EXTS, mediaKind, VIDEO_EXTS } from "../lib/assetUrl";
import {
  scenarioGameCampaignFile,
  scenarioGameCampaigns,
} from "../scenario/bindings";
import { type Campaign, parseCampaignJson } from "./model";

/** Where a game's campaign lives, enough to read its files back. */
export interface CampaignGameOrigin {
  gameName: string;
  archivePath: string;
  folder: string;
  /** True for a loose `.sdd` game folder, false for a packaged archive. */
  loose: boolean;
}

/** One campaign a game ships, with its raw document for its dialogue clips. */
export interface GameCampaign {
  campaign: Campaign;
  source: "game";
  origin: CampaignGameOrigin;
  /** The document as the game holds it, which may carry dialogue clips. */
  json: string;
}

/** The document a campaign folder holds. */
export const CAMPAIGN_DOCUMENT = "campaign.json";

/** Decode base64 to bytes. */
function bytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Where each game campaign listed this session came from, by campaign id. */
const origins = new Map<string, CampaignGameOrigin>();

/** Each game campaign's document as the game holds it, by campaign id. */
const documents = new Map<string, string>();

/** The ids of the campaigns coilbox holds itself, local or bundled. */
let storedIds: ReadonlySet<string> = new Set();

/**
 * Say which campaigns coilbox holds itself. One of those hides a game's campaign
 * with the same id, so the lookups below must not answer for it (issue #5485).
 */
export function setStoredCampaignIds(ids: Iterable<string>): void {
  storedIds = new Set(ids);
}

/**
 * A game campaign's document as the game holds it, which is where an exported
 * campaign carries its missions' dialogue clips. `undefined` for a campaign
 * that is not a game's, or one not listed yet this session.
 */
export function gameCampaignJson(campaignId: string): string | undefined {
  return storedIds.has(campaignId) ? undefined : documents.get(campaignId);
}

/**
 * Where a campaign came from, or `undefined` for one that is not a game's.
 * Populated by {@link gameCampaigns}, so it answers once the list has been read.
 */
export function gameCampaignOrigin(
  campaignId: string,
): CampaignGameOrigin | undefined {
  return storedIds.has(campaignId) ? undefined : origins.get(campaignId);
}

/**
 * A packaged game's campaigns, by the game object the content scan returned. A
 * rescan returns new objects, so this holds one read per archive per scan. A
 * loose `.sdd` is never held, since its author may be editing it right now.
 */
const packagedReads = new WeakMap<GameItem, Promise<GameCampaign[]>>();

/** One game's campaigns. A game that cannot be read is skipped with a warning. */
async function readGame(
  game: GameItem,
  archivePath: string,
  loose: boolean,
): Promise<GameCampaign[]> {
  const found: GameCampaign[] = [];
  try {
    const { campaigns } = await scenarioGameCampaigns({ root: archivePath });
    for (const folder of campaigns) {
      const { base64 } = await scenarioGameCampaignFile({
        root: archivePath,
        folder,
        file: CAMPAIGN_DOCUMENT,
      });
      const json = new TextDecoder().decode(bytes(base64));
      const campaign = parseCampaignJson(json);
      if (!campaign) {
        console.warn("skipping invalid campaign document", game.name, folder);
        continue;
      }
      found.push({
        campaign,
        source: "game",
        origin: { gameName: game.name, archivePath, folder, loose },
        json,
      });
    }
  } catch (e) {
    console.warn("could not read campaigns from", game.name, e);
  }
  return found;
}

/**
 * Every campaign every installed game ships, in game order and then folder
 * order. Two games shipping a campaign with the same id keep the first, since
 * progress is keyed by id and two campaigns cannot share one run.
 */
export async function gameCampaigns(
  games: readonly GameItem[],
): Promise<GameCampaign[]> {
  const found: GameCampaign[] = [];
  const seen = new Set<string>();
  for (const game of games) {
    const archivePath = game.primaryArchive.path;
    if (!archivePath) continue;
    const loose = isSdd(game.primaryArchive);
    let read = loose ? undefined : packagedReads.get(game);
    if (!read) {
      read = readGame(game, archivePath, loose);
      if (!loose) packagedReads.set(game, read);
    }
    for (const loaded of await read) {
      if (seen.has(loaded.campaign.id)) {
        console.warn(
          "skipping a second campaign with the same id",
          game.name,
          loaded.campaign.id,
        );
        continue;
      }
      seen.add(loaded.campaign.id);
      origins.set(loaded.campaign.id, loaded.origin);
      documents.set(loaded.campaign.id, loaded.json);
      found.push(loaded);
    }
  }
  return found;
}

/** The content type a media file is served as, by extension. */
function contentType(file: string): string {
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  const kind = mediaKind(file);
  if (kind === "audio" && AUDIO_EXTS.includes(ext)) {
    return ext === "mp3" ? "audio/mpeg" : `audio/${ext}`;
  }
  if (kind === "video" && VIDEO_EXTS.includes(ext)) {
    return ext === "mov" ? "video/quicktime" : `video/${ext}`;
  }
  return ext === "jpg" ? "image/jpeg" : `image/${ext}`;
}

/**
 * One of a game campaign's media files as a `data:` URI, for the export and
 * duplicate paths, which inline or re-import an image's bytes.
 */
export async function gameCampaignFileDataUri(
  origin: CampaignGameOrigin,
  file: string,
): Promise<string> {
  const { base64 } = await scenarioGameCampaignFile({
    root: origin.archivePath,
    folder: origin.folder,
    file,
  });
  return `data:${contentType(file)};base64,${base64}`;
}

/** Object URLs already made this session, keyed archive, folder and file. */
const urls = new Map<string, Promise<string>>();

/**
 * A URL the webview can load for one of a game campaign's media files. The
 * bytes are read out of the archive into a blob, so nothing is written to disk
 * and the media stays in its game. Held for the session: a loose game's media
 * edited mid-session shows on the next start.
 */
export function gameCampaignFileUrl(
  origin: CampaignGameOrigin,
  file: string,
): Promise<string> {
  const key = `${origin.archivePath}\n${origin.folder}\n${file}`;
  let url = urls.get(key);
  if (!url) {
    url = scenarioGameCampaignFile({
      root: origin.archivePath,
      folder: origin.folder,
      file,
    }).then(({ base64 }) =>
      URL.createObjectURL(
        new Blob([bytes(base64)], { type: contentType(file) }),
      ),
    );
    url.catch(() => urls.delete(key));
    urls.set(key, url);
  }
  return url;
}
