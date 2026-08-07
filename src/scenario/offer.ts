/**
 * What coilbox offers a game it cannot install the mission runtime into.
 *
 * Adopting the runtime means writing `luarules/`, `luaui/` and `missions/` into
 * the game folder, and a packaged `.sd7`/`.sdz` is a file rather than a folder.
 * So a packaged game gets the test mutator instead: coilbox's own game beside
 * it, depending on it and carrying the runtime plus the one scenario being
 * tested.
 *
 * The wording is the point. An author reading this has to come away knowing the
 * mutator tests a scenario and never ships one, or the generated game looks like
 * a supported way to distribute a mission. It is all author wording: this is
 * shown on a game's page in Content and in the editor's test drawer, never to a
 * player pressing Play (issue #862).
 */

import { MUTATOR_FOLDER } from "../lib/generatedGames";
import type { RuntimeMarker } from "./bindings";
import { packagedGameRoute } from "./wording";

/** The packaged-game offer, in the order it is read. */
export interface MutatorOffer {
  /** Why the runtime cannot be installed into this game. */
  reason: string;
  /** What coilbox does instead. */
  offer: string;
  /** What that route is not for. Null when there is no route to qualify. */
  limit: string | null;
}

/**
 * What to say on a packaged game's page.
 *
 * `available` is the runtime this build of coilbox ships, which is the one the
 * mutator would carry. Without it there is no mutator to offer, so the offer
 * says that rather than promising a route coilbox cannot take.
 */
export function mutatorOffer(
  gameName: string,
  available: RuntimeMarker | null,
): MutatorOffer {
  if (!available) {
    return {
      reason: `${gameName} is a packaged archive, which cannot be written into, so coilbox cannot install the mission runtime into it.`,
      offer:
        "This build of coilbox ships no mission runtime, so it has no test mutator to offer either.",
      limit: null,
    };
  }
  return {
    reason: packagedGameRoute("author", gameName),
    offer: `Coilbox writes a game of its own, ${MUTATOR_FOLDER}, beside this one. It depends on ${gameName} for units, sides and everything else, and carries mission runtime version ${available.version} plus the one scenario under test. Testing a scenario writes it, and deleting that folder undoes it.`,
    limit: `It is a test route and never a distribution one. For ${gameName} to play scenarios itself it has to vendor the runtime, and coilbox can only install that into a loose .sdd copy of the game.`,
  };
}
