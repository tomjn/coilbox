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
 * Why a pill has appeared for a game this coilbox never started (issue #2074).
 *
 * Somebody who closed coilbox during a relayed game and opened it again is
 * looking at a pill for a match they cannot see, cannot name and cannot end, so
 * the first job of this sentence is to say why it is there at all. The second is
 * to say what happens next without anybody having to do anything, because there
 * is nothing they can do and being told that is better than looking for a
 * button.
 */
export const RELAY_LEFT_RUNNING_DETAIL =
  "A game you started earlier is still being played through your machine's relay, so every other player's traffic passes through here. Coilbox did not start this one and cannot end it. The relay stops on its own once that game finishes.";

/**
 * The relay's rate in a few words. Pure.
 *
 * Zero gets words rather than "0 B/s" because it is the answer somebody is
 * looking at the pill to find, and a number that happens to be zero is easy to
 * read past. It is also not a fault on its own: a game that has not started yet
 * carries nothing, and so does one that is over.
 *
 * `null` is a relay that is up and has not said what it is carrying, which is a
 * different thing from one carrying nothing and gets a shorter sentence rather
 * than an invented figure. It is the honest answer for a sidecar coilbox is
 * reading off disk rather than talking to, and for one whose last word has gone
 * stale.
 */
export function relayCarryingLabel(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null) return "Relaying";
  if (!(bytesPerSecond > 0)) return "Relaying nothing";
  return `Relaying ${formatSpeed(bytesPerSecond)}`;
}
