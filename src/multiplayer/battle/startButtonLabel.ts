/**
 * The battle room header's Start button asks the autohost to begin (`!start`),
 * and for most players the autohost turns that into a vote the room has to
 * pass (issue #3198). Calling that button "Start" reads as if the click
 * launches the match, when for most players it only opens a vote.
 *
 * "Start" is kept for whoever the click actually starts the match for: the
 * founder (a battle coilbox hosts itself, or one hosted directly on Zero-K),
 * and a Tachyon lobby's boss. Everyone else sees "Vote to start".
 */
export function startButtonLabel(canStartDirectly: boolean): string {
  return canStartDirectly ? "Start" : "Vote to start";
}
