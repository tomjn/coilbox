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

/**
 * Starting a track is async, because an archive track has to be fetched before
 * it has a URL. Even a portable one therefore lands a microtask later.
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function load() {
  const music = await import("./music");
  music.initMusic();
  music.setMusicLevel(1, false);
  await flush();
  return music;
}

describe("background music", () => {
  it("plays nothing at all when the build ships no tracks", async () => {
    profileSound.mockReturnValue(null);
    const music = await load();
    music.setMusicWanted(true);
    await flush();
    expect(FakeAudio.last).toBeNull();
    expect(music.hasMusic()).toBe(false);
  });

  it("streams the track rather than inlining it", async () => {
    // A track runs for minutes. A data URI would hold all of it in memory and
    // could not seek, which is why this is not the profile asset command.
    const music = await load();
    music.setMusicWanted(true);
    await flush();
    expect(FakeAudio.last?.src).toBe(
      "coilbox://localhost/portable/sounds/a.ogg",
    );
  });

  it("stays quiet after a game ends if the window is still not focused", async () => {
    const music = await load();
    music.setMusicWanted(true);
    await flush();
    expect(FakeAudio.last?.paused).toBe(false);

    music.setMusicSuspended("unfocused", true);
    music.setMusicSuspended("game", true);
    await flush();
    expect(FakeAudio.last?.paused).toBe(true);

    // The game exits, but we are still looking at something else.
    music.setMusicSuspended("game", false);
    await flush();
    expect(FakeAudio.last?.paused).toBe(true);

    // Only coming back to the window starts it again.
    music.setMusicSuspended("unfocused", false);
    await flush();
    expect(FakeAudio.last?.paused).toBe(false);
  });

  it("does not start music the player had turned off, just because a game ended", async () => {
    const music = await load();
    music.setMusicWanted(false);
    await flush();
    music.setMusicSuspended("game", true);
    music.setMusicSuspended("game", false);
    await flush();
    expect(FakeAudio.last).toBeNull();
  });

  it("stops rather than playing silently when muted", async () => {
    // A muted track still costs a decode. Nobody is listening to it.
    const music = await load();
    music.setMusicWanted(true);
    await flush();
    music.setMusicLevel(0.8, true);
    await flush();
    expect(FakeAudio.last?.paused).toBe(true);
    expect(FakeAudio.last?.volume).toBe(0);
  });

  it("moves to the next track when one ends, and wraps at the end", async () => {
    const music = await load();
    music.setMusicWanted(true);
    await flush();
    const el = FakeAudio.last;
    if (!el) throw new Error("no audio element");

    el.listeners.get("ended")?.();
    await flush();
    expect(el.src).toBe("coilbox://localhost/portable/sounds/b.ogg");
    el.listeners.get("ended")?.();
    await flush();
    expect(el.src).toBe("coilbox://localhost/portable/sounds/a.ogg");
  });

  it("starts an archive track that arrived before the resolver did", async () => {
    // Reading a game's archive is two async steps that settle in whichever
    // order they please. When the track list wins, playback has no way to
    // fetch anything and stalls. Nothing retries on its own, so the music sat
    // there wanted, unsuspended and silent until the player hit pause and play
    // again. Caught on screen, not in a test, which is why this one exists.
    profileSound.mockReturnValue(null);
    const music = await import("./music");
    music.setMusicLevel(1, false);
    music.setMusicWanted(true);
    music.setTracks([{ kind: "archive", path: "Music/a.ogg", label: "a" }]);
    await flush();
    expect(FakeAudio.last?.paused ?? true).toBe(true);

    music.setArchiveResolver(async () => "blob:test");
    await flush();
    expect(FakeAudio.last?.src).toBe("blob:test");
    expect(FakeAudio.last?.paused).toBe(false);
  });

  it("stays paused when the player stops it while a track is still loading", async () => {
    // Fetching an archive track out of a .sdz is slow enough to press pause
    // during. The fetch then finishes and, without a re-check, plays anyway -
    // music with the button showing stopped, and no way to stop it that sticks.
    // Seen on screen before it was caught here.
    profileSound.mockReturnValue(null);
    const music = await import("./music");
    let release: (url: string) => void = () => {};
    music.setArchiveResolver(
      () =>
        new Promise<string | null>((resolve) => {
          release = resolve;
        }),
    );
    music.setMusicLevel(1, false);
    music.setTracks([{ kind: "archive", path: "Music/a.ogg", label: "a" }]);
    music.setMusicWanted(true);
    await flush();

    music.setMusicWanted(false);
    release("blob:late");
    await flush();

    expect(FakeAudio.last?.paused ?? true).toBe(true);
  });

  it("throws away a track that arrives after the player switched game", async () => {
    // Reading a track out of a .sdz is slow enough that switching game twice
    // leaves two loads in flight. Whichever finishes last used to win, so the
    // loser revoked the winner's blob URL out from under the audio element and
    // the music stopped dead with no error anywhere.
    profileSound.mockReturnValue(null);
    const revoked: string[] = [];
    URL.revokeObjectURL = (u: string) => revoked.push(u);

    const music = await import("./music");
    let releaseFirst: (url: string) => void = () => {};
    music.setArchiveResolver(
      () =>
        new Promise<string | null>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    music.setMusicLevel(1, false);
    music.setMusicWanted(true);
    music.setTracks([{ kind: "archive", path: "GameA/a.ogg", label: "a" }]);
    await flush();

    // The player picks a different game before the first track arrives. Each
    // call hands back a distinct URL, the way createObjectURL really does, so
    // the discarded load can be told from the one that wins.
    let nth = 0;
    music.setArchiveResolver(async () => `blob:from-game-b-${++nth}`);
    music.setTracks([{ kind: "archive", path: "GameB/b.ogg", label: "b" }]);
    await flush();
    const playing = FakeAudio.last?.src;
    expect(playing).toMatch(/^blob:from-game-b-/);

    // The abandoned one now turns up. It must not take the speaker.
    releaseFirst("blob:from-game-a");
    await flush();
    expect(FakeAudio.last?.src).toBe(playing);
    // And it must be freed rather than leaked, since nothing else holds it.
    expect(revoked).toContain("blob:from-game-a");
    // Whatever is actually playing is still owned by the element.
    expect(revoked).not.toContain(playing);
  });

  it("stops playing when handed an empty track list", async () => {
    // The contract `GameMusic` leans on. Picking a game with no music has to
    // clear the list rather than skip the call, or the previous game's tracks
    // keep looping against a resolver now pointed at a different archive. That
    // caller-side half is not covered here, only the guarantee it relies on.
    profileSound.mockReturnValue(null);
    const music = await import("./music");
    music.setArchiveResolver(async () => "blob:a");
    music.setMusicLevel(1, false);
    music.setMusicWanted(true);
    music.setTracks([{ kind: "archive", path: "GameA/a.ogg", label: "a" }]);
    await flush();
    expect(FakeAudio.last?.paused).toBe(false);

    music.setTracks([]);
    await flush();
    expect(FakeAudio.last?.paused).toBe(true);
  });

  it("skips past a track that will not load", async () => {
    // One missing file in a distribution's list should cost that track, not
    // the whole soundtrack.
    const music = await load();
    music.setMusicWanted(true);
    await flush();
    const el = FakeAudio.last;
    el?.listeners.get("error")?.();
    await flush();
    expect(el?.src).toBe("coilbox://localhost/portable/sounds/b.ogg");
  });
});
