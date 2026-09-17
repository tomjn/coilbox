// @vitest-environment happy-dom

/**
 * The auto-join channel list shows join failures for the connection matching
 * its own `serverKey`, not whichever connection the app happens to focus
 * (issue #2846). With one connection the two always coincide. With two, an
 * editor open on the second account must not show the first's failures.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const settings: Record<string, unknown> = {};

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (key: string, initial: unknown) => [
    key in settings ? settings[key] : initial,
    (next: unknown) => {
      settings[key] = next;
    },
  ],
}));

interface ConnEntry {
  channelJoinFailures: Record<string, string>;
}

let connections: Record<string, ConnEntry> = {};

vi.mock("../../../multiplayer/store", () => ({
  useConnection: (key: string | null) =>
    key ? (connections[key] ?? null) : null,
}));

import { AutojoinChannels } from "./AutojoinChannels";

const KEY_A = "alice@test.example:8200";
const KEY_B = "bob@test.example:8200";

beforeEach(() => {
  connections = {};
  for (const key of Object.keys(settings)) delete settings[key];
  settings["multiplayer.joinedChannels"] = {
    [KEY_A]: [{ name: "main" }],
    [KEY_B]: [{ name: "main" }],
  };
});

afterEach(() => {
  cleanup();
});

it("shows a join failure for the connection this editor's own key names", () => {
  connections = {
    [KEY_A]: { channelJoinFailures: { main: "banned" } },
    [KEY_B]: { channelJoinFailures: {} },
  };
  render(<AutojoinChannels serverKey={KEY_A} />);
  expect(screen.getByText(/Last join failed: banned/)).toBeTruthy();
});

it("does not show another connection's join failure", () => {
  connections = {
    [KEY_A]: { channelJoinFailures: { main: "banned" } },
    [KEY_B]: { channelJoinFailures: {} },
  };
  render(<AutojoinChannels serverKey={KEY_B} />);
  expect(screen.queryByText(/Last join failed/)).toBeNull();
});

it("stops the channel name field auto-capitalising on macOS (issue #2919)", () => {
  render(<AutojoinChannels serverKey={KEY_A} />);
  const field = screen.getByLabelText("Channel name");
  expect(field.getAttribute("autocapitalize")).toBe("off");
  expect(field.getAttribute("autocorrect")).toBe("off");
  expect(field.getAttribute("spellcheck")).toBe("false");
});
