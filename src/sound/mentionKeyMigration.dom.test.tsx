// @vitest-environment happy-dom

/**
 * "Play a sound on mention" used to live in chat highlights as its own boolean.
 * It is now one row of the events table, stored inverted as a mute. Anyone who
 * had turned it off did so because the ping annoyed them, and having it come
 * back on after an update is the kind of thing that gets an app muted for good.
 *
 * The inversion is the trap: read the old key wrong and every player who left
 * it alone gets silence instead.
 */

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, unknown>();
const writes: Array<[string, unknown]> = [];

vi.mock("@picoframe/frame", () => ({
  useSetting: (key: string, fallback: unknown) => [
    settings.has(key) ? settings.get(key) : fallback,
    (value: unknown) => {
      settings.set(key, value);
      writes.push([key, value]);
    },
  ],
}));
vi.mock("./context", () => ({ setMasterLevel: () => {} }));
vi.mock("./play", () => ({
  setEventLevel: () => {},
  setEventSound: () => {},
  setGroupLevel: () => {},
}));

const MUTED = "sound.events.mention.muted";
const OLD = "multiplayer.highlight.sound";

beforeEach(() => {
  settings.clear();
  writes.length = 0;
});

async function mount() {
  const { SoundProvider } = await import("./SoundProvider");
  render(<SoundProvider>ok</SoundProvider>);
}

describe("the mention sound setting", () => {
  it("mutes the event for someone who had the old sound switched off", async () => {
    settings.set(OLD, false);
    await mount();
    expect(settings.get(MUTED)).toBe(true);
  });

  it("leaves the event audible for someone who had it switched on", async () => {
    settings.set(OLD, true);
    await mount();
    expect(settings.get(MUTED)).toBe(false);
  });

  it("writes nothing at all for a player who never touched either", async () => {
    await mount();
    expect(writes).toEqual([]);
    expect(settings.has(MUTED)).toBe(false);
  });

  it("does not undo a new choice that disagrees with the old key", async () => {
    // Someone migrated, then unmuted the event. The old key still says "off".
    // Re-applying it on every startup would fight them forever.
    settings.set(OLD, false);
    settings.set(MUTED, false);
    await mount();
    expect(settings.get(MUTED)).toBe(false);
    expect(writes).toEqual([]);
  });
});
