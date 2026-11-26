// @vitest-environment happy-dom

/**
 * The "Minutes before away" field on the lobby-servers settings page. It
 * saves only when the player leaves the field or presses Enter, clamped to
 * the allowed range, so clearing the field to retype it never saves a zero.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AUTO_AWAY_MINUTES_KEY,
  MAX_AUTO_AWAY_MINUTES,
} from "../../multiplayer/awayStatus";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../bindings", () => ({
  lsGetCredential: vi.fn(async () => ({ secret: null })),
  lsStoreCredential: vi.fn(async () => ({})),
  lsDeleteCredential: vi.fn(async () => ({})),
}));
vi.mock("../../multiplayer/bindings", () => ({
  mpTachyonSignOut: vi.fn(async () => ({})),
}));
vi.mock("../../multiplayer/ConsoleDrawer", () => ({
  ConsoleDrawer: () => null,
}));
vi.mock("../RegisterForm", () => ({ RegisterForm: () => null }));
vi.mock("../PasswordRecoveryForm", () => ({
  PasswordRecoveryForm: () => null,
}));
vi.mock("../../multiplayer/store", () => ({
  serverKeyFor: (server: { host: string; port: number }, username: string) =>
    `${username}@${server.host}:${server.port}`,
  useConnection: () => null,
  useMultiplayer: () => ({ signIn: vi.fn(), busyKeys: new Set() }),
}));

const writes = vi.hoisted(() => [] as Array<[string, unknown]>);
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (key: string, initial: unknown) => [
    key === "multiplayer.autoAwayMinutes" ? 10 : initial,
    (value: unknown) => writes.push([key, value]),
  ],
}));

import LobbyServersSettings from "./SettingsSection";

const minuteWrites = () =>
  writes.filter(([key]) => key === AUTO_AWAY_MINUTES_KEY).map(([, v]) => v);

const field = () =>
  screen.getByLabelText("Minutes before away") as HTMLInputElement;

beforeEach(() => {
  writes.length = 0;
});

afterEach(() => {
  cleanup();
});

it("saves nothing while the field is cleared and retyped", () => {
  render(<LobbyServersSettings />);
  fireEvent.change(field(), { target: { value: "" } });
  expect(field().value).toBe("");
  fireEvent.change(field(), { target: { value: "15" } });
  expect(minuteWrites()).toEqual([]);

  fireEvent.blur(field());
  expect(minuteWrites()).toEqual([15]);
});

it("keeps the saved value when the field is left empty", () => {
  render(<LobbyServersSettings />);
  fireEvent.change(field(), { target: { value: "" } });
  fireEvent.blur(field());
  expect(minuteWrites()).toEqual([]);
  expect(field().value).toBe("10");
});

it("clamps an out of range entry on Enter", () => {
  render(<LobbyServersSettings />);
  fireEvent.change(field(), { target: { value: "9999" } });
  fireEvent.keyDown(field(), { key: "Enter" });
  expect(minuteWrites()).toEqual([MAX_AUTO_AWAY_MINUTES]);
});
