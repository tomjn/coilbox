import { formatSpeed } from "@/downloads/pages/components/ProgressBar";

/**
 * What the in-game pill says about a game its host is relaying (issue #2024).
 *
 * A host who took the relay route is carrying every other player's traffic on
 * their own machine, and until now nothing on screen said so. The thing they
 * cannot otherwise find out is whether it is still working: a relay that has
 * quietly stopped leaves the battle open, the sidecar running and the game
 * frozen, and the first anybody hears is players saying so.
 */

/**
 * How often to ask what the relay is carrying, in milliseconds.
 *
 * The agent reports once a second and no faster, which is `TRAFFIC_EVERY` in
 * `coilbox-relay-protocol` and the reasoning is there. Asking more often would
 * be redrawing the same figure on a machine that is busy running a game, and
 * asking less often would leave a relay that had stopped looking healthy for
 * longer than it takes somebody to notice.
 */
export const ASK_EVERY_MS = 1000;

/**
 * Why the number is there, for somebody who hovers over it wondering.
 *
 * Says what the machine is doing rather than what the number is, because the
 * number reads for itself and the fact that this host is carrying everybody
 * else's traffic does not.
 */
export const RELAY_CARRYING_DETAIL =
  "This game goes through your machine's relay, so every other player's traffic passes through here. This is how much went through in the last second.";

/**
 * The relay's rate in a few words. Pure.
 *
 * Zero gets words rather than "0 B/s" because it is the answer somebody is
 * looking at the pill to find, and a number that happens to be zero is easy to
 * read past. It is also not a fault on its own: a game that has not started yet
 * carries nothing, and so does one that is over.
 */
export function relayCarryingLabel(bytesPerSecond: number): string {
  if (!(bytesPerSecond > 0)) return "Relaying nothing";
  return `Relaying ${formatSpeed(bytesPerSecond)}`;
}
