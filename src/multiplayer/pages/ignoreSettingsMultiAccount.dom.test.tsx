// @vitest-environment happy-dom

/**
 * The ignore list settings page with more than one connected account (issue
 * #2846). Ignores are per-account. With two connections a picker chooses
 * which one the editor targets. With one, it targets it without asking.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mpBindings = vi.hoisted(() => ({
  mpIgnore: vi.fn(async () => ({})),
  mpUnignore: vi.fn(async () => ({})),
}));
vi.mock("../bindings", () => mpBindings);

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

vi.mock("../AccountPicker", () => ({
  AccountPicker: ({
    keys,
    onChange,
  }: {
    keys: string[];
    value: string;
    onChange: (key: string) => void;
  }) => (
    <div>
      {keys.map((key) => (
        <button key={key} type="button" onClick={() => onChange(key)}>
          pick {key}
        </button>
      ))}
    </div>
  ),
}));

interface ConnEntry {
  serverKey: string;
  live: boolean;
}

let connections: Record<string, ConnEntry> = {};
let activeKey: string | null = null;

vi.mock("../store", () => ({
  useMultiplayer: () => ({ connections, activeKey }),
  liveConnectionKeys: (
    conns: Record<string, ConnEntry>,
    focusKey: string | null,
  ) => {
    const keys = Object.keys(conns).filter((k) => conns[k].live);
    if (focusKey == null || !keys.includes(focusKey)) return keys;
    return [focusKey, ...keys.filter((k) => k !== focusKey)];
  },
}));

import IgnoreSettings from "./IgnoreSettings";

const KEY_A = "alice@test.example:8200";
const KEY_B = "bob@test.example:8200";

beforeEach(() => {
  connections = {};
  activeKey = null;
  for (const key of Object.keys(settings)) delete settings[key];
  mpBindings.mpIgnore.mockClear();
  mpBindings.mpUnignore.mockClear();
});

afterEach(() => {
  cleanup();
});

it("explains that a connection is required when nothing is connected", () => {
  render(<IgnoreSettings />);
  expect(screen.getByText(/Connect to a lobby server/)).toBeTruthy();
});

it("does not show an account picker with a single connection", () => {
  connections = { [KEY_A]: { serverKey: KEY_A, live: true } };
  activeKey = KEY_A;
  render(<IgnoreSettings />);
  expect(screen.queryByText(/^pick /)).toBeNull();
});

it("shows an account picker when more than one connection is live", () => {
  connections = {
    [KEY_A]: { serverKey: KEY_A, live: true },
    [KEY_B]: { serverKey: KEY_B, live: true },
  };
  activeKey = KEY_A;
  render(<IgnoreSettings />);
  expect(screen.getByText(`pick ${KEY_A}`)).toBeTruthy();
  expect(screen.getByText(`pick ${KEY_B}`)).toBeTruthy();
});

it("ignores a name against the picked connection, not only the focused one", () => {
  connections = {
    [KEY_A]: { serverKey: KEY_A, live: true },
    [KEY_B]: { serverKey: KEY_B, live: true },
  };
  activeKey = KEY_A;
  render(<IgnoreSettings />);

  fireEvent.click(screen.getByText(`pick ${KEY_B}`));
  fireEvent.change(screen.getByLabelText("Username to ignore"), {
    target: { value: "troll" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Ignore/ }));

  expect(mpBindings.mpIgnore).toHaveBeenCalledWith({
    serverKey: KEY_B,
    username: "troll",
  });
});
