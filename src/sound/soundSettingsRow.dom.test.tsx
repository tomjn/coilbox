// @vitest-environment happy-dom

/**
 * The Sounds table on the Sound settings page: putting a changed sound back,
 * the preview button, and which group each row sits under.
 *
 * The preview used to play through the real gain chain, so the two Interface
 * rows made no sound on a fresh install because that group ships muted. Playing
 * is now an explicit ask to hear something and outranks every mute.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
      const set = (next: unknown) => {
        settings.set(key, next);
        for (const cb of listeners) cb();
      };
      return [value, set];
    },
  };
});

/** Radix sliders and switches need a layout engine. The rows under test do not. */
vi.mock("./LevelRow", () => ({ LevelRow: () => null }));
vi.mock("./MusicSource", () => ({ MusicSource: () => null }));
vi.mock("./useGameMusic", () => ({ useGameMusic: () => ({ tracks: [] }) }));
vi.mock("@/profile/profile", () => ({ getProfileSound: () => null }));
vi.mock("@/components/ui/slider", () => ({ Slider: () => null }));
vi.mock("@/components/ui/switch", () => ({ Switch: () => null }));

/**
 * One button per option, rather than the real Radix listbox, so a test can pick
 * a sound and read back which option the page marked as the default.
 */
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    onValueChange,
    options,
    ariaLabel,
  }: {
    onValueChange: (v: string) => void;
    options: { value: string; label: string; trailing?: unknown }[];
    ariaLabel?: string;
  }) => (
    <>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-label={`${ariaLabel}: ${o.label}`}
          data-default={o.trailing ? "yes" : undefined}
          onClick={() => onValueChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </>
  ),
}));

/** Returns a duration the way the real one does, so the row can time the icon. */
const previewEvent = vi.fn((_id: string) => 1.85);
const stopPreview = vi.fn();
vi.mock("./play", () => ({
  previewEvent: (id: string) => previewEvent(id),
  stopPreview: (id: string) => stopPreview(id),
}));

beforeEach(() => {
  settings.clear();
  previewEvent.mockClear();
  stopPreview.mockClear();
});
afterEach(cleanup);

async function renderPage() {
  const { default: SoundSettings } = await import("./SoundSettings");
  render(<SoundSettings />);
}

describe("the Sounds table", () => {
  it("previews a sound whose group is muted", async () => {
    // Interface sounds ship muted, so on a fresh install these two are the ones
    // a player finds. Their group's switch is in a different section, which is
    // what made a preview that obeyed it look like a broken button.
    await renderPage();
    const preview = screen.getByRole("button", {
      name: "Preview Something finished",
    });
    expect((preview as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(preview);
    expect(previewEvent).toHaveBeenCalledWith("uiSuccess");
  });

  it("previews a sound with everything muted", async () => {
    settings.set("sound.muted", true);
    settings.set("sound.groups.alerts.muted", true);
    settings.set("sound.events.ring.muted", true);
    await renderPage();
    const preview = screen.getByRole("button", {
      name: "Preview Rung by the host",
    });
    expect((preview as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(preview);
    expect(previewEvent).toHaveBeenCalledWith("ring");
  });

  it("offers to stop a sound while it is still playing", async () => {
    vi.useFakeTimers();
    try {
      await renderPage();
      fireEvent.click(
        screen.getByRole("button", { name: "Preview Rung by the host" }),
      );
      // The gong runs for 1.85s, so the button is a stop button until then.
      const stop = screen.getByRole("button", {
        name: "Stop Rung by the host",
      });
      fireEvent.click(stop);
      expect(stopPreview).toHaveBeenCalledWith("ring");
      expect(
        screen.getByRole("button", { name: "Preview Rung by the host" }),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes back to a play button once the sound has finished on its own", async () => {
    vi.useFakeTimers();
    try {
      await renderPage();
      fireEvent.click(
        screen.getByRole("button", { name: "Preview Rung by the host" }),
      );
      expect(
        screen.getByRole("button", { name: "Stop Rung by the host" }),
      ).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(1850);
      });
      expect(
        screen.getByRole("button", { name: "Preview Rung by the host" }),
      ).toBeTruthy();
      // Nothing to stop: it ended by itself.
      expect(stopPreview).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts each event under the group that controls it", async () => {
    await renderPage();
    const headings = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headings).toEqual([
      "When",
      "Sound",
      "Volume",
      "Alerts",
      "Interface",
    ]);
  });

  it("puts a changed sound back to the one it started as", async () => {
    settings.set("sound.events.ring.sound", "ping");
    await renderPage();
    const reset = screen.getByRole("button", {
      name: "Reset Rung by the host to Gong",
    });
    expect((reset as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(reset);
    // Cleared, not set to "gong": unset is what means "the default".
    expect(settings.get("sound.events.ring.sound")).toBe(null);
    expect((reset as HTMLButtonElement).disabled).toBe(true);
  });

  it("clears the setting when the default is picked from the list", async () => {
    settings.set("sound.events.ring.sound", "ping");
    await renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: "Sound for Rung by the host: Gong" }),
    );
    expect(settings.get("sound.events.ring.sound")).toBe(null);
  });

  it("marks the default in the list, so it can be found without being known", async () => {
    await renderPage();
    const gong = screen.getByRole("button", {
      name: "Sound for Rung by the host: Gong",
    });
    const ping = screen.getByRole("button", {
      name: "Sound for Rung by the host: Ping",
    });
    expect(gong.getAttribute("data-default")).toBe("yes");
    expect(ping.getAttribute("data-default")).toBe(null);
  });
});
