import { MANIFEST_FILE } from "../conquest/handmade/manifest";
import type { HandmadeMapResult } from "../conquest/handmade/read";
import type { GalaxyDoc } from "../conquest/model";
import type { HandmadeMapRef } from "./mapRef";

/** How a message names the map: its title where the code carries one. */
function nameOf(ref: HandmadeMapRef, installedTitle?: string): string {
  return `"${ref.title ?? installedTitle ?? ref.id}"`;
}

export type ChallengeMapCheck =
  | { ok: true; map: GalaxyDoc }
  | { ok: false; message: string };

/**
 * Decide whether the installed map is the one a challenge was made on, from
 * what the library answered for the map's id. On any failure the message says
 * which map is needed and which game it is for, and the challenge must not
 * start: a generated map in its place would be a different challenge.
 *
 * `gameName` is the game the challenge names, as the player knows it.
 */
export function checkChallengeMap(
  ref: HandmadeMapRef,
  gameName: string,
  result: HandmadeMapResult,
): ChallengeMapCheck {
  if (!result.ok) {
    const [first, ...rest] = result.errors;
    // The library answers an id it has no map for with this one error, and
    // nothing else reports the manifest itself as the missing file.
    const notInstalled =
      first?.code === "file-missing" &&
      rest.length === 0 &&
      first.file === MANIFEST_FILE;
    if (notInstalled || !first) {
      return {
        ok: false,
        message: `This challenge is played on the hand-made map ${nameOf(ref)}, which is made for ${gameName}. That map is not installed here, and a challenge code cannot carry it. Get the map from whoever shared the code, import it on the Conquest page, then import this code again.`,
      };
    }
    return {
      ok: false,
      message: `This challenge is played on the hand-made map ${nameOf(ref)}, which is made for ${gameName}. The copy installed here could not be read, so the challenge was not started. ${first.message}`,
    };
  }
  const map = result.doc;
  if (ref.fingerprint && map.handmade?.fingerprint !== ref.fingerprint) {
    return {
      ok: false,
      message: `This challenge was made on a different version of the hand-made map ${nameOf(ref, map.title)}, which is made for ${gameName}. The version installed here does not match it, so the challenge was not started. Get the version the code was made on from whoever shared it, import it on the Conquest page, then import this code again.`,
    };
  }
  return { ok: true, map };
}

/** The message when the map folders could not be listed at all. */
export function challengeMapListFailure(
  ref: HandmadeMapRef,
  reason: unknown,
): string {
  return `This challenge is played on the hand-made map ${nameOf(ref)}, and the hand-made maps could not be listed, so the challenge was not started. ${reason instanceof Error ? reason.message : String(reason)}`;
}
