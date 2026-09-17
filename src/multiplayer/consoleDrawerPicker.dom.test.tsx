// @vitest-environment happy-dom

/**
 * The protocol console with more than one live connection (issue #2847). It
 * used to read the app's one focused connection unconditionally, so a second
 * login's console lines had nowhere to show. It now takes an optional
 * `serverKey` to open on (the account the drawer was opened from) and offers
 * a picker to switch once more than one connection is live. With one
 * connection there is nothing to pick, so it looks exactly as it always has.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// AccountPicker composes a Radix Select and is exercised on its own
// (`ignoreSettingsMultiAccount.dom.test.tsx`, `accountSettings.dom.test.tsx`).
// Here it's swapped for plain buttons so a test can pick a connection with a
// click.
vi.mock("./AccountPicker", () => ({
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

const bindings = vi.hoisted(() => ({
  mpSend: vi.fn(async () => ({})),
  mpTachyonRequest: vi.fn(async () => ({})),
}));
vi.mock("./bindings", () => bindings);

interface ConnEntry {
  serverKey: string;
  live: boolean;
  mirror: { consoleLines: string[] };
}

let connections: Record<string, ConnEntry> = {};
let activeKey: string | null = null;

vi.mock("./store", () => ({
  useMultiplayer: () => ({ connections, activeKey }),
  useConnection: (key: string | null) =>
    key ? (connections[key] ?? null) : null,
  useProtocolServers: () => [],
  liveConnectionKeys: (
    conns: Record<string, ConnEntry>,
    focusKey: string | null,
  ) => {
    const keys = Object.keys(conns).filter((k) => conns[k].live);
    if (focusKey == null || !keys.includes(focusKey)) return keys;
    return [focusKey, ...keys.filter((k) => k !== focusKey)];
  },
}));

import { ConsoleDrawer } from "./ConsoleDrawer";

const KEY_A = "alice@bar.example:8200";
const KEY_B = "bob@techa.example:8200";

function connectionFor(key: string, lines: string[]): ConnEntry {
  return { serverKey: key, live: true, mirror: { consoleLines: lines } };
}

beforeEach(() => {
  connections = {};
  activeKey = null;
  bindings.mpSend.mockClear();
});

afterEach(() => {
  cleanup();
});

it("shows the one connection's lines with no picker, unchanged from before #2847", () => {
  connections = { [KEY_A]: connectionFor(KEY_A, ["line from A"]) };
  activeKey = KEY_A;
  render(<ConsoleDrawer open onClose={() => {}} />);

  expect(screen.getByText("line from A")).toBeTruthy();
  expect(screen.queryByText(/^pick /)).toBeNull();
});

it("opens on the connection it was given, with a picker for the rest", () => {
  connections = {
    [KEY_A]: connectionFor(KEY_A, ["line from A"]),
    [KEY_B]: connectionFor(KEY_B, ["line from B"]),
  };
  activeKey = KEY_A;
  render(<ConsoleDrawer open onClose={() => {}} serverKey={KEY_B} />);

  expect(screen.getByText("line from B")).toBeTruthy();
  expect(screen.queryByText("line from A")).toBeNull();
  expect(screen.getByText(`pick ${KEY_A}`)).toBeTruthy();
  expect(screen.getByText(`pick ${KEY_B}`)).toBeTruthy();
});

it("falls back to the focused connection when it was not opened for a particular one", () => {
  connections = {
    [KEY_A]: connectionFor(KEY_A, ["line from A"]),
    [KEY_B]: connectionFor(KEY_B, ["line from B"]),
  };
  activeKey = KEY_B;
  render(<ConsoleDrawer open onClose={() => {}} />);

  expect(screen.getByText("line from B")).toBeTruthy();
});

it("switches to the picked connection's lines and sends on it", () => {
  connections = {
    [KEY_A]: connectionFor(KEY_A, ["line from A"]),
    [KEY_B]: connectionFor(KEY_B, ["line from B"]),
  };
  activeKey = KEY_A;
  render(<ConsoleDrawer open onClose={() => {}} serverKey={KEY_A} />);

  fireEvent.click(screen.getByText(`pick ${KEY_B}`));
  expect(screen.getByText("line from B")).toBeTruthy();
  expect(screen.queryByText("line from A")).toBeNull();

  fireEvent.change(screen.getByPlaceholderText("Send a raw command…"), {
    target: { value: "PING" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(bindings.mpSend).toHaveBeenCalledWith({
    serverKey: KEY_B,
    line: "PING",
  });
});

it("stops the raw command input auto-capitalising on macOS (issue #2924)", () => {
  connections = { [KEY_A]: connectionFor(KEY_A, ["line from A"]) };
  activeKey = KEY_A;
  render(<ConsoleDrawer open onClose={() => {}} />);

  const field = screen.getByPlaceholderText("Send a raw command…");
  expect(field.getAttribute("autocapitalize")).toBe("off");
});

it("re-opens on the given connection rather than remembering the last pick", () => {
  connections = {
    [KEY_A]: connectionFor(KEY_A, ["line from A"]),
    [KEY_B]: connectionFor(KEY_B, ["line from B"]),
  };
  activeKey = KEY_A;
  const { rerender } = render(
    <ConsoleDrawer open onClose={() => {}} serverKey={KEY_A} />,
  );
  fireEvent.click(screen.getByText(`pick ${KEY_B}`));
  expect(screen.getByText("line from B")).toBeTruthy();

  rerender(<ConsoleDrawer open={false} onClose={() => {}} serverKey={KEY_A} />);
  rerender(<ConsoleDrawer open onClose={() => {}} serverKey={KEY_A} />);

  expect(screen.getByText("line from A")).toBeTruthy();
});
