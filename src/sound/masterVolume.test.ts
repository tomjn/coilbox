// @vitest-environment happy-dom

/**
 * Every cue used to connect straight to `ctx.destination` and set its own gain
 * inside its own play function, so there was nothing in the graph a master
 * volume could turn down. This proves the one thing that fixes: each tone now
 * ends at the shared master gain and nothing reaches the destination past it,
 * so one node controls the lot.
 *
 * It also pins the three relative levels. The gong is driven hard because a ring
 * has to carry across a room, the chime and ping are nudges, and they were tuned
 * against each other rather than picked independently. Flattening them while
 * moving the code would be a silent behaviour change nobody would notice until a
 * ring failed to wake somebody.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeParam {
  value = 1;
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
  setTargetAtTime(v: number) {
    this.value = v;
    return this;
  }
}

class FakeNode {
  /** Nodes that connect into this one, so a test can walk the graph backwards. */
  inbound: FakeNode[] = [];
  connect(target: FakeNode) {
    target.inbound.push(this);
    return target;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeFilter extends FakeNode {
  type = "";
  frequency = new FakeParam();
}
class FakeCompressor extends FakeNode {
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
}
class FakeOscillator extends FakeNode {
  type = "";
  frequency = new FakeParam();
  start() {}
  stop() {}
}

class FakeAudioContext {
  state: "suspended" | "running" = "running";
  currentTime = 0;
  destination = new FakeNode();
  async resume() {
    this.state = "running";
  }
  createGain() {
    return new FakeGain();
  }
  createBiquadFilter() {
    return new FakeFilter();
  }
  createDynamicsCompressor() {
    return new FakeCompressor();
  }
  createOscillator() {
    return new FakeOscillator();
  }
}

beforeEach(() => {
  vi.resetModules();
  (window as unknown as { AudioContext: unknown }).AudioContext =
    FakeAudioContext;
});

/**
 * The base level a tone was built at, read off the graph. The chain runs
 * master <- group <- event <- (the gong's limiter) <- the tone's own gain, so
 * this walks back through the two nodes the player controls to reach the one
 * the tone set for itself.
 */
function toneLevelInto(master: FakeNode): number {
  const group = master.inbound.at(-1);
  const event = group?.inbound.at(-1);
  let tone = event?.inbound.at(-1);
  if (tone instanceof FakeCompressor) tone = tone.inbound.at(-1);
  if (!(tone instanceof FakeGain)) throw new Error("no tone gain on the chain");
  return tone.gain.value;
}

describe("the master gain", () => {
  it("is the only thing connected to the speakers", async () => {
    const { getAudioContext, getMasterGain } = await import("./context");
    const { playEvent } = await import("./play");

    playEvent("ring");
    playEvent("hostIngame");
    playEvent("mention");

    const ctx = getAudioContext() as unknown as FakeAudioContext;
    const master = getMasterGain() as unknown as FakeNode;
    // Three tones played, and the destination still has exactly one thing
    // feeding it. A cue that connected straight to the destination would show
    // up here as a second entry and would ignore the volume entirely.
    expect(ctx.destination.inbound).toEqual([master]);
  });

  it("keeps the gong, chime and ping at the levels they were tuned to", async () => {
    const { getMasterGain } = await import("./context");
    const { playEvent } = await import("./play");
    const master = getMasterGain() as unknown as FakeNode;

    // Each event's default sound, at the level that sound is built at. These
    // are what a player hears before touching anything.
    playEvent("ring");
    expect(toneLevelInto(master)).toBe(1.4);
    playEvent("hostIngame");
    expect(toneLevelInto(master)).toBe(0.3);
    playEvent("mention");
    expect(toneLevelInto(master)).toBe(0.28);
  });

  it("starts at full volume, so nothing sounds different until the player asks", async () => {
    const { getMasterGain } = await import("./context");
    const master = getMasterGain() as unknown as FakeGain;
    expect(master.gain.value).toBe(1);
  });

  it("scales by the player's volume and drops to silence on mute", async () => {
    const { getMasterGain, setMasterLevel } = await import("./context");
    const master = getMasterGain() as unknown as FakeGain;

    setMasterLevel(0.4, false);
    expect(master.gain.value).toBeCloseTo(0.4);

    // Mute is not "volume zero": it silences without losing the 0.4, so
    // unmuting puts the player back where they were.
    setMasterLevel(0.4, true);
    expect(master.gain.value).toBe(0);
    setMasterLevel(0.4, false);
    expect(master.gain.value).toBeCloseTo(0.4);
  });

  it("remembers a level set before anything had ever played", async () => {
    // The slider can move before a single cue has fired, and the master gain is
    // created lazily on the first one. Without this the player's setting would
    // be silently discarded until the second cue of the session.
    const { getMasterGain, setMasterLevel } = await import("./context");
    setMasterLevel(0.25, false);
    const master = getMasterGain() as unknown as FakeGain;
    expect(master.gain.value).toBeCloseTo(0.25);
  });
});
