// @vitest-environment happy-dom

/**
 * The three sound cues (mention, ingame, ring) used to each own a separate
 * AudioContext and a separate pointerdown/keydown "unlock" listener (issue
 * #2444), so each was a separate answer to "has the user gestured yet".
 * Whichever cue's context got created first paid the unlock, and the others
 * could still see themselves as suspended and stay silent. This proves the
 * shared module now hands out one context, unlocked by one listener, no
 * matter how many call sites ask for it first.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeAudioContext {
  state: "suspended" | "running" = "suspended";
  resume = vi.fn(async () => {
    this.state = "running";
  });
}

beforeEach(() => {
  vi.resetModules();
  (window as unknown as { AudioContext: unknown }).AudioContext =
    FakeAudioContext;
});

describe("soundCue", () => {
  it("unlocks a single shared AudioContext on the first gesture, for every caller", async () => {
    const { getAudioContext } = await import("./soundCue");

    // Stand in for two different cues each asking for a context before any
    // gesture has happened, the way mentionCue/ingameCue/ringEffect each
    // used to independently.
    const fromCueA = getAudioContext() as unknown as FakeAudioContext | null;
    const fromCueB = getAudioContext() as unknown as FakeAudioContext | null;
    expect(fromCueA).toBe(fromCueB);
    expect(fromCueA?.state).toBe("suspended");

    window.dispatchEvent(new Event("pointerdown"));

    // One shared unlock listener resumed the one shared context, so both
    // stand-ins see it unlocked - neither is left waiting on a gesture the
    // other one already consumed.
    expect(fromCueA?.resume).toHaveBeenCalledTimes(1);
    expect(fromCueA?.state).toBe("running");
  });
});
