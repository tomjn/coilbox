import { useSyncExternalStore } from "react";
import type { InviteIntent, InviteLink } from "./inviteOffer";

/**
 * Where an invite link waits between arriving and being acted on (issue
 * #3382). Two things are held, one of each at most.
 *
 * `prompt` is the link the player is being asked about. While it is set, a
 * second link is refused rather than swapped in, so the button somebody has
 * read cannot be made to do something else by a link that arrives after it.
 *
 * `intent` is the join the player agreed to, waiting for its server to be
 * logged in to.
 *
 * Both live in this module's memory and nowhere else. Nothing here is written
 * to settings or storage, so neither outlives the app.
 */
interface InviteState {
  prompt: InviteLink | null;
  intent: InviteIntent | null;
}

const EMPTY: InviteState = { prompt: null, intent: null };

let state = EMPTY;
const listeners = new Set<() => void>();

function set(next: InviteState) {
  state = next;
  for (const listener of listeners) listener();
}

/**
 * Put a link in front of the player. Answers false, and changes nothing, when
 * one is already there.
 */
export function offerInvite(link: InviteLink): boolean {
  if (state.prompt) return false;
  set({ ...state, prompt: link });
  return true;
}

/** Whether a link is in front of the player now, so another kind of prompt can
 * wait its turn too. */
export function invitePromptOpen(): boolean {
  return state.prompt !== null;
}

/** Take the link away unanswered, which is a cancel. */
export function closeInvitePrompt(): void {
  if (state.prompt) set({ ...state, prompt: null });
}

/**
 * Hold the join the player agreed to, in place of any held before, or drop
 * it with null. Agreeing answers the prompt, so that goes too.
 */
export function setInviteIntent(intent: InviteIntent | null): void {
  set({ prompt: intent ? null : state.prompt, intent });
}

/** Forget everything. For tests. */
export function resetInviteStore(): void {
  set(EMPTY);
}

export function useInviteState(): InviteState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
