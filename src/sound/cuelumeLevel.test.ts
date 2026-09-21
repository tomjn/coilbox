// @vitest-environment happy-dom

/**
 * cuelume owns its own AudioContext and connects straight to the speakers, so
 * it is the one thing in the app the master gain node cannot reach. It takes a
 * volume multiplier instead, and we have to compute what the gain chain would
 * have done and hand it the answer.
 *
 * That is a second implementation of the same rule, which is exactly the kind
 * of thing that drifts. If it does, the Interface group's slider silently stops
 * working while every other slider keeps working, which is a bug nobody would
 * think to look for.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const cuelumePlay = vi.fn();
const setCuelumeVolume = vi.fn();
vi.mock("cuelume", () => ({
  play: (...a: unknown[]) => cuelumePlay(...a),
  setVolume: (v: number) => setCuelumeVolume(v),
  sounds: ["success", "error", "tick"],
}));

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
class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = new FakeNode();
  async resume() {}
  createGain() {
    return new FakeGain();
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), {
      type: "",
      frequency: new FakeParam(),
    });
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    });
  }
  createOscillator() {
    return Object.assign(new FakeNode(), {
      frequency: new FakeParam(),
      type: "",
      start() {},
      stop() {},
    });
  }
}

beforeEach(() => {
  vi.resetModules();
  cuelumePlay.mockClear();
  setCuelumeVolume.mockClear();
  (window as unknown as { AudioContext: unknown }).AudioContext =
    FakeAudioContext;
});

describe("a cuelume sound", () => {
  it("is handed the master, group and event levels multiplied together", async () => {
    const { setMasterLevel } = await import("./context");
    const { playEvent, setEventLevel, setGroupLevel } = await import("./play");

    setMasterLevel(0.5, false);
    setGroupLevel("ui", 0.5, false);
    setEventLevel("uiSuccess", 0.5, false);
    playEvent("uiSuccess");

    expect(setCuelumeVolume).toHaveBeenCalledWith(0.125);
    expect(cuelumePlay).toHaveBeenCalledWith("success");
  });

  it("goes silent when any one of the three is muted", async () => {
    const { setMasterLevel } = await import("./context");
    const { playEvent, setEventLevel, setGroupLevel } = await import("./play");

    setMasterLevel(1, true);
    playEvent("uiSuccess");
    expect(setCuelumeVolume).toHaveBeenLastCalledWith(0);

    setMasterLevel(1, false);
    setGroupLevel("ui", 1, true);
    playEvent("uiSuccess");
    expect(setCuelumeVolume).toHaveBeenLastCalledWith(0);

    setGroupLevel("ui", 1, false);
    setEventLevel("uiSuccess", 1, true);
    playEvent("uiSuccess");
    expect(setCuelumeVolume).toHaveBeenLastCalledWith(0);
  });

  it("sets the volume before playing, never after", async () => {
    // cuelume reads its volume when the sound starts. Setting it afterwards
    // would leave every sound one change behind the slider.
    const order: string[] = [];
    setCuelumeVolume.mockImplementation(() => order.push("volume"));
    cuelumePlay.mockImplementation(() => order.push("play"));

    const { playEvent } = await import("./play");
    playEvent("uiSuccess");
    expect(order).toEqual(["volume", "play"]);
  });

  it("is still audible from the preview button with all three muted", async () => {
    // The two Interface events are cuelume's, and the Interface group ships
    // muted, so this is the pair a player finds on a fresh install. Obeying the
    // mute here is what made the button look broken.
    const { setMasterLevel } = await import("./context");
    const { previewEvent, setEventLevel, setGroupLevel } = await import(
      "./play"
    );

    setMasterLevel(0.5, true);
    setGroupLevel("ui", 0.5, true);
    setEventLevel("uiSuccess", 0.5, true);
    previewEvent("uiSuccess");

    expect(setCuelumeVolume).toHaveBeenLastCalledWith(0.125);
    expect(cuelumePlay).toHaveBeenCalledWith("success");
  });

  it("leaves coilbox's own sounds on the gain chain, not on cuelume", async () => {
    const { playEvent } = await import("./play");
    playEvent("ring");
    expect(cuelumePlay).not.toHaveBeenCalled();
  });
});
