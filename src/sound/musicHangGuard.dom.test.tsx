// @vitest-environment happy-dom

/**
 * A launch that finds the attempt marker still set turned music off, and says
 * so in Sound settings until the player presses play. Driven through the real
 * provider and settings page so the wiring between them is what is tested.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => new Map<string, unknown>());
const listeners = vi.hoisted(() => new Set<() => void>());

vi.mock("@picoframe/frame", async () => {
  const React = await import("react");
  return {
    Button: ({
      variant: _variant,
      size: _size,
      ...props
    }: React.ComponentProps<"button"> & {
      variant?: string;
      size?: string;
    }) => <button type="button" {...props} />,
    useSetting: (key: string, fallback: unknown) => {
      const value = React.useSyncExternalStore(
        (cb: () => void) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
        () => (settings.has(key) ? settings.get(key) : fallback),
      );
      const set = React.useCallback(
        (next: unknown) => {
          settings.set(key, next);
          for (const cb of listeners) cb();
        },
        [key],
      );
      return [value, set];
    },
  };
});

vi.mock("./context", () => ({ setMasterLevel: () => {} }));
vi.mock("./GameMusic", () => ({ GameMusic: () => null }));
vi.mock("./LevelRow", () => ({ LevelRow: () => null }));
vi.mock("./MusicSource", () => ({ MusicSource: () => null }));
vi.mock("@/profile/profile", () => ({ getProfileSound: () => null }));
vi.mock("@/components/ui/slider", () => ({ Slider: () => null }));
vi.mock("@/components/ui/switch", () => ({ Switch: () => null }));
vi.mock("@/components/OptionSelect", () => ({ OptionSelect: () => null }));
vi.mock("./play", () => ({
  setEventLevel: () => {},
  setEventSound: () => {},
  setGroupLevel: () => {},
  previewEvent: () => 0,
  stopPreview: () => {},
}));

class FakeAudio {
  static made = 0;
  src = "";
  volume = 1;
  preload = "";
  paused = true;
  constructor() {
    FakeAudio.made += 1;
  }
  addEventListener() {}
  async play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
}

const LINE =
  "Music was turned off because the last attempt to play it stopped Coilbox responding.";

beforeEach(() => {
  settings.clear();
  FakeAudio.made = 0;
  (globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;
});
afterEach(cleanup);

describe("a boot after a hung playback attempt", () => {
  it("keeps music off, says why, and lets the player try again", async () => {
    const store = await import("@/lib/storedSetting");
    const data = new Map<string, string>([["sound.music.attempting", "true"]]);
    store.installSettingsStorage({
      get: (k) => data.get(k) ?? null,
      set: (k, v) => {
        data.set(k, v);
      },
    });
    settings.set("sound.music.playing", true);
    settings.set("sound.music.source", "nostalgia");

    const { SoundProvider } = await import("./SoundProvider");
    const { default: SoundSettings } = await import("./SoundSettings");
    render(
      <SoundProvider>
        <SoundSettings />
      </SoundProvider>,
    );

    expect(settings.get("sound.music.playing")).toBe(false);
    expect(data.get("sound.music.attempting")).toBe("false");
    expect(FakeAudio.made).toBe(0);
    expect(screen.getByText(LINE)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Play music" }));
    expect(screen.queryByText(LINE)).toBeNull();
    expect(settings.get("sound.music.playing")).toBe(true);
    // A new attempt, under the same guard.
    await waitFor(() => expect(FakeAudio.made).toBe(1));
  });
});
