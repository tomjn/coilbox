// @vitest-environment happy-dom

/**
 * A sound's volume is the master times its group times the event's own, and a
 * mute anywhere on that path silences it. That is four separate things a player
 * can set.
 *
 * These prove the chain is wired the way the settings screen claims, because a
 * group slider connected to nothing looks exactly like a working one. The last
 * few cover the preview button, which deliberately leaves that chain.
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

/** The event gain and the group gain a played event routed through. */
function chainFrom(master: FakeNode) {
  const group = master.inbound.at(-1) as FakeGain;
  const event = group?.inbound.at(-1) as FakeGain;
  return { group, event };
}

describe("the event and group chain", () => {
  it("runs each event through its own gain and then its group's", async () => {
    const { getMasterGain } = await import("./context");
    const { playEvent } = await import("./play");
    const master = getMasterGain() as unknown as FakeNode;

    playEvent("mention");
    const { group, event } = chainFrom(master);

    // Four nodes deep is the whole point: master, group, event, then the
    // sound. Collapse any of them and one of the four sliders stops working.
    expect(group).toBeInstanceOf(FakeGain);
    expect(event).toBeInstanceOf(FakeGain);
    expect(event).not.toBe(group);
  });

  it("gives two events in the same group one shared group gain", async () => {
    const { getMasterGain } = await import("./context");
    const { playEvent, setGroupLevel } = await import("./play");
    const master = getMasterGain() as unknown as FakeNode;

    playEvent("mention");
    const first = chainFrom(master).group;
    playEvent("ring");
    const second = chainFrom(master).group;
    expect(second).toBe(first);

    // And so turning the group down reaches both, which is what a group is for.
    setGroupLevel("alerts", 0.5, false);
    expect(first.gain.value).toBeCloseTo(0.5);
  });

  it("turns one event down without touching its neighbours", async () => {
    const { getMasterGain } = await import("./context");
    const { playEvent, setEventLevel } = await import("./play");
    const master = getMasterGain() as unknown as FakeNode;

    playEvent("mention");
    const mention = chainFrom(master).event;
    playEvent("ring");
    const ring = chainFrom(master).event;

    setEventLevel("mention", 0.2, false);
    expect(mention.gain.value).toBeCloseTo(0.2);
    expect(ring.gain.value).toBe(1);
  });

  it("silences a muted event and leaves the group alone", async () => {
    const { getMasterGain } = await import("./context");
    const { playEvent, setEventLevel } = await import("./play");
    const master = getMasterGain() as unknown as FakeNode;

    playEvent("ring");
    const { event, group } = chainFrom(master);
    setEventLevel("ring", 0.8, true);
    expect(event.gain.value).toBe(0);
    expect(group.gain.value).toBe(1);
  });

  it("remembers a level set before the event had ever played", async () => {
    // The settings screen pushes every stored level in at startup, long before
    // most events fire. Without this, a saved level would be ignored until the
    // second time an event happened.
    const { getMasterGain } = await import("./context");
    const { playEvent, setEventLevel, setGroupLevel } = await import("./play");
    const master = getMasterGain() as unknown as FakeNode;

    setEventLevel("ring", 0.3, false);
    setGroupLevel("alerts", 0.6, false);
    playEvent("ring");

    const { event, group } = chainFrom(master);
    expect(event.gain.value).toBeCloseTo(0.3);
    expect(group.gain.value).toBeCloseTo(0.6);
  });

  it("plays the sound an event is pointed at, not its default", async () => {
    const { getMasterGain } = await import("./context");
    const { playEvent, setEventSound, soundForEvent } = await import("./play");
    const master = getMasterGain() as unknown as FakeNode;

    expect(soundForEvent("mention")).toBe("ping");

    setEventSound("mention", "gong");
    expect(soundForEvent("mention")).toBe("gong");
    playEvent("mention");

    // The gong is the only sound with a limiter, so its presence on the chain
    // is proof the choice reached the audio rather than only the dropdown.
    const { event } = chainFrom(master);
    expect(event.inbound.at(-1)).toBeInstanceOf(FakeCompressor);

    setEventSound("mention", null);
    expect(soundForEvent("mention")).toBe("ping");
  });

  it("swallows a failure rather than taking down whatever it was announcing", async () => {
    // `notify()` promises its callers it never throws, and plays a cue before
    // its own try block. A cue is a decoration on something real happening, so
    // a refused or closed AudioContext must not break the download that
    // finished or the message that arrived.
    const { getAudioContext, getMasterGain } = await import("./context");
    const { playEvent } = await import("./play");
    getMasterGain();
    const ctx = getAudioContext() as unknown as FakeAudioContext;
    // What a closed or refused context looks like from the inside: the very
    // first node the cue tries to build throws.
    ctx.createGain = () => {
      throw new Error("audio context closed");
    };

    expect(() => playEvent("ring")).not.toThrow();
  });

  it("keeps matchmaking off the table but still on the chain", async () => {
    // The matchmaking page has no way in from the navigation yet, so a row for
    // it would be a setting for something a player cannot open. The event
    // itself still has to play.
    const { EVENTS, VISIBLE_EVENT_IDS } = await import("./events");
    expect(VISIBLE_EVENT_IDS).not.toContain("matchFound");
    expect(EVENTS.matchFound.sound).toBe("gong");
  });
});

describe("the preview button's route to the speakers", () => {
  it("obeys the three volumes but none of the three mutes", async () => {
    const { getAudioContext, setMasterLevel } = await import("./context");
    const { previewEvent, setEventLevel, setGroupLevel } = await import(
      "./play"
    );
    const ctx = getAudioContext() as unknown as FakeAudioContext;

    setMasterLevel(0.5, true);
    setGroupLevel("alerts", 0.5, true);
    setEventLevel("ring", 0.5, true);
    previewEvent("ring");

    // A slider sits beside the button, so a quiet preview explains itself. A
    // mute does not: the group's switch is in a different section of the page.
    const out = ctx.destination.inbound.at(-1) as FakeGain;
    expect(out.gain.value).toBeCloseTo(0.125);
  });

  it("goes to the speakers past the chain, not through it", async () => {
    // The mutes live on those nodes, so a preview routed through them would be
    // silenced by them however its own gain was set.
    const { getAudioContext, getMasterGain, setMasterLevel } = await import(
      "./context"
    );
    const { previewEvent } = await import("./play");
    const ctx = getAudioContext() as unknown as FakeAudioContext;
    const master = getMasterGain() as unknown as FakeGain;

    setMasterLevel(1, true);
    previewEvent("ring");

    expect(master.gain.value).toBe(0);
    const out = ctx.destination.inbound.at(-1) as FakeGain;
    expect(out).not.toBe(master);
    expect(master.inbound).toEqual([]);
  });

  it("swallows a failure the same way the real event does", async () => {
    const { getAudioContext } = await import("./context");
    const { previewEvent } = await import("./play");
    const ctx = getAudioContext() as unknown as FakeAudioContext;
    ctx.createGain = () => {
      throw new Error("audio context closed");
    };

    expect(() => previewEvent("ring")).not.toThrow();
  });
});
