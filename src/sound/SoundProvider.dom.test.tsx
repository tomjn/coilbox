// @vitest-environment happy-dom

/**
 * The cues play from plain functions called out of the lobby event loop, which
 * cannot read a React setting. So the master volume only works if the Provider
 * copies the stored values into the audio graph. Nothing else in the app does
 * it, and a Provider that quietly stopped would leave the slider moving with no
 * effect on a single sound - which looks like working software.
 */

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, unknown>();
vi.mock("@picoframe/frame", () => ({
  useSetting: (key: string, fallback: unknown) => [
    settings.has(key) ? settings.get(key) : fallback,
    () => {},
  ],
}));

const setMasterLevel = vi.fn();
vi.mock("./context", () => ({
  setMasterLevel: (...a: unknown[]) => setMasterLevel(...a),
}));

beforeEach(() => {
  settings.clear();
  setMasterLevel.mockClear();
});

describe("SoundProvider", () => {
  it("hands the audio graph full volume when the player has set nothing", async () => {
    const { SoundProvider } = await import("./SoundProvider");
    render(<SoundProvider>ok</SoundProvider>);
    expect(setMasterLevel).toHaveBeenCalledWith(1, false);
  });

  it("converts the 0-100 the slider stores into the 0-1 the gain node wants", async () => {
    // The two scales differ on purpose: a percentage is what a player
    // understands, and a gain multiplier is what Web Audio takes. Passing 40
    // straight through would be 40x amplification, not 40%.
    settings.set("sound.volume", 40);
    const { SoundProvider } = await import("./SoundProvider");
    render(<SoundProvider>ok</SoundProvider>);
    expect(setMasterLevel).toHaveBeenCalledWith(0.4, false);
  });

  it("passes mute through without losing the volume behind it", async () => {
    settings.set("sound.volume", 60);
    settings.set("sound.muted", true);
    const { SoundProvider } = await import("./SoundProvider");
    render(<SoundProvider>ok</SoundProvider>);
    expect(setMasterLevel).toHaveBeenCalledWith(0.6, true);
  });
});
