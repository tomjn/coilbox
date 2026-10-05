import type { HandmadeConquestChallengeSettings } from "./challenge";

/**
 * An imported challenge waiting for its conquest to start, by map id.
 *
 * A generated challenge is saved as a map of its own the moment it is
 * imported. A hand-made map is already installed and holds one conquest, so
 * there is nothing to save until the player has picked a faction on the map's
 * own setup panel. The challenge's settings wait here until then. They last as
 * long as the app is open: after a restart the code has to be imported again.
 */
const held = new Map<string, HandmadeConquestChallengeSettings>();

/** Keep a challenge for the setup panel of the map it names. */
export function holdHandmadeChallenge(
  settings: HandmadeConquestChallengeSettings,
): void {
  held.set(settings.map.id, settings);
}

/** The challenge waiting on a map, if any. */
export function heldHandmadeChallenge(
  mapId: string,
): HandmadeConquestChallengeSettings | undefined {
  return held.get(mapId);
}

/** Forget the challenge waiting on a map: it started, or the player chose
 * their own settings. */
export function releaseHandmadeChallenge(mapId: string): void {
  held.delete(mapId);
}
