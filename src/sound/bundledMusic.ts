import type { Track } from "./music";
import nostalgiaUrl from "./nostalgia.mp3";

/**
 * The track coilbox ships itself, so there is something to listen to on a build
 * whose distribution bundles no music and with no game picked.
 *
 * It is a loop rather than a piece with an ending. The player advances to the
 * next track when one finishes, and with a single-track queue that restarts
 * this one, which is what makes a loop the right shape here.
 */
export const BUNDLED_TRACKS: Track[] = [
  { kind: "bundled", url: nostalgiaUrl, label: "Nostalgia" },
];
