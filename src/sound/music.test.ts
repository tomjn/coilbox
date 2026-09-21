// @vitest-environment happy-dom

/**
 * Music pauses for two reasons that have nothing to do with each other: a game
 * is running, and you have tabbed away. They overlap constantly, because
 * launching a game is also how you stop looking at Coilbox.
 *
 * A single "suspended" flag gets this wrong in a way that is hard to notice and
 * annoying to live with: quit a game while reading something else, and the
 * soundtrack starts up in a window you cannot see.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const profileSound = vi.fn<() => unknown>();
vi.mock("@/profile/profile", () => ({
  getProfileSound: () => profileSound(),
}));
vi.mock("@/lib/assetUrl", () => ({
  assetUrl: (rel: string) => `coilbox://localhost/portable/${rel}`,
}));

/** Stands in for the one `HTMLAudioElement` the module builds. */
class FakeAudio {
  static last: FakeAudio | null = null;
  src = "";
  volume = 1;
  preload = "";
  paused = true;
  played: string[] = [];
  listeners = new Map<string, () => void>();
  constructor() {
    FakeAudio.last = this;
  }
  addEventListener(name: string, fn: () => void) {
    this.listeners.set(name, fn);
  }
  async play() {
    this.paused = false;
    this.played.push(this.src);
  }
  pause() {
    this.paused = true;
  }
}

beforeEach(() => {
  vi.resetModules();
  FakeAudio.last = null;
  profileSound.mockReturnValue({ tracks: ["sounds/a.ogg", "sounds/b.ogg"] });
  (globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;
});

async function load() {
  const music = await import("./music");
  music.initMusic();
  music.setMusicLevel(1, false);
  return music;
}

describe("background music", () => {
  it("plays nothing at all when the build ships no tracks", async () => {
    profileSound.mockReturnValue(null);
    const music = await load();
    music.setMusicWanted(true);
    expect(FakeAudio.last).toBeNull();
    expect(music.hasMusic()).toBe(false);
  });

  it("streams the track rather than inlining it", async () => {
    // A track runs for minutes. A data URI would hold all of it in memory and
    // could not seek, which is why this is not the profile asset command.
    const music = await load();
    music.setMusicWanted(true);
    expect(FakeAudio.last?.src).toBe(
      "coilbox://localhost/portable/sounds/a.ogg",
    );
  });

  it("stays quiet after a game ends if the window is still not focused", async () => {
    const music = await load();
    music.setMusicWanted(true);
    expect(FakeAudio.last?.paused).toBe(false);

    music.setMusicSuspended("unfocused", true);
    music.setMusicSuspended("game", true);
    expect(FakeAudio.last?.paused).toBe(true);

    // The game exits, but we are still looking at something else.
    music.setMusicSuspended("game", false);
    expect(FakeAudio.last?.paused).toBe(true);

    // Only coming back to the window starts it again.
    music.setMusicSuspended("unfocused", false);
    expect(FakeAudio.last?.paused).toBe(false);
  });

  it("does not start music the player had turned off, just because a game ended", async () => {
    const music = await load();
    music.setMusicWanted(false);
    music.setMusicSuspended("game", true);
    music.setMusicSuspended("game", false);
    expect(FakeAudio.last).toBeNull();
  });

  it("stops rather than playing silently when muted", async () => {
    // A muted track still costs a decode. Nobody is listening to it.
    const music = await load();
    music.setMusicWanted(true);
    music.setMusicLevel(0.8, true);
    expect(FakeAudio.last?.paused).toBe(true);
    expect(FakeAudio.last?.volume).toBe(0);
  });

  it("moves to the next track when one ends, and wraps at the end", async () => {
    const music = await load();
    music.setMusicWanted(true);
    const el = FakeAudio.last;
    if (!el) throw new Error("no audio element");

    el.listeners.get("ended")?.();
    expect(el.src).toBe("coilbox://localhost/portable/sounds/b.ogg");
    el.listeners.get("ended")?.();
    expect(el.src).toBe("coilbox://localhost/portable/sounds/a.ogg");
  });

  it("skips past a track that will not load", async () => {
    // One missing file in a distribution's list should cost that track, not
    // the whole soundtrack.
    const music = await load();
    music.setMusicWanted(true);
    const el = FakeAudio.last;
    el?.listeners.get("error")?.();
    expect(el?.src).toBe("coilbox://localhost/portable/sounds/b.ogg");
  });
});
