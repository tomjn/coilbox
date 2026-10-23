// @vitest-environment happy-dom

/**
 * The server page inside the real wizard shell, with the real login and
 * register forms. The keychain commands and the lobby connection are stubbed
 * because both reach Tauri. The profile names an official server so the tests
 * can see it listed first.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LobbyServer } from "@/lobby-servers/config";

vi.mock("@/profile/profile", async (original) => ({
  ...(await original<typeof import("@/profile/profile")>()),
  getProfile: () => ({
    lobby: { official: { name: "Our Server", host: "lobby.example" } },
  }),
}));

const lsStoreCredential = vi.fn(async (_: unknown) => ({}));
vi.mock("@/lobby-servers/bindings", () => ({
  lsStoreCredential: (args: unknown) => lsStoreCredential(args),
  lsDeleteCredential: async () => ({}),
  lsGetCredential: async () => ({ secret: null }),
}));

const register = vi.fn();
vi.mock("@/multiplayer/store", () => ({
  useMultiplayer: () => ({ register, busyKeys: new Set<string>() }),
  serverKeyFor: (server: LobbyServer, username: string) =>
    `${username}@${server.host}:${server.port}`,
}));

// Radix Select cannot be driven in happy-dom, so stand in a native one, the
// same way the lobby settings tests do.
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select
      aria-label="Server"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const { PersistentStoreProvider, ThemeProvider } = await import(
  "@picoframe/frame"
);
const { installSettingsStorage, memorySettingsStorage, readStoredSetting } =
  await import("@/lib/storedSetting");
const { describeError } = await import("@/i18n/uiError");
const { Wizard } = await import("../Wizard");

const ACCOUNTS_KEY = "lobbyServers.accounts";
const onSettle = vi.fn();
let storage = memorySettingsStorage();

function show() {
  return render(
    <PersistentStoreProvider storage={storage}>
      <ThemeProvider>
        <Wizard
          pages={["server", "done"]}
          newPagesRun={false}
          onSettle={onSettle}
          onClose={() => {}}
          downloads={[]}
          onCancelDownload={() => {}}
          onRetryDownload={() => {}}
        />
      </ThemeProvider>
    </PersistentStoreProvider>,
  );
}

const storedAccounts = () =>
  readStoredSetting<{ accounts: { serverId: string; username: string }[] }>(
    ACCOUNTS_KEY,
    { accounts: [] },
  ).accounts;

function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function openRegister() {
  const tab = screen.getByRole("tab", { name: "Register" });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
}

beforeEach(() => {
  storage = memorySettingsStorage();
  installSettingsStorage(storage);
  storage.set(
    ACCOUNTS_KEY,
    JSON.stringify({
      accounts: [{ id: "old", serverId: "elsewhere", username: "Before" }],
    }),
  );
  onSettle.mockReset();
  register.mockReset();
  lsStoreCredential.mockClear();
});

afterEach(() => {
  cleanup();
  installSettingsStorage(null);
});

it("lists the profile's official server first on the Log in tab", () => {
  show();
  const select = screen.getByRole("combobox", {
    name: "Server",
  }) as HTMLSelectElement;
  const options = within(select).getAllByRole("option");
  expect(options[0].textContent).toBe("Our Server");
  expect(select.selectedOptions[0].textContent).toBe("Our Server");
  expect(screen.getByRole("button", { name: "Add login" })).toBeTruthy();
});

it("saves the login to the lobby accounts and moves on", async () => {
  show();
  type("Username", "Player");
  // The hint under the field is part of its label.
  type(/^Password/, "secret");
  fireEvent.click(screen.getByRole("button", { name: "Add login" }));
  await waitFor(() => expect(onSettle).toHaveBeenCalledWith("server"));
  expect(lsStoreCredential).toHaveBeenCalledWith({
    serverId: "profile-official",
    username: "Player",
    secret: "secret",
  });
  expect(storedAccounts().map((a) => [a.serverId, a.username])).toStrictEqual([
    ["elsewhere", "Before"],
    ["profile-official", "Player"],
  ]);
  expect(screen.getByText("You're ready")).toBeTruthy();
});

it("registers on the Register tab and moves on", async () => {
  register.mockResolvedValue(undefined);
  show();
  openRegister();
  type("Username", "Newcomer");
  type("Password", "secret");
  fireEvent.click(screen.getByRole("button", { name: "Register" }));
  await waitFor(() => expect(onSettle).toHaveBeenCalledWith("server"));
  expect(register).toHaveBeenCalledTimes(1);
  expect(register.mock.calls[0][1]).toBe("Newcomer");
  expect(lsStoreCredential).toHaveBeenCalledWith({
    serverId: "profile-official",
    username: "Newcomer",
    secret: "secret",
  });
  expect(storedAccounts().map((a) => [a.serverId, a.username])).toStrictEqual([
    ["elsewhere", "Before"],
    ["profile-official", "Newcomer"],
  ]);
  expect(screen.getByText("You're ready")).toBeTruthy();
});

it("shows the server's message when registering fails and stays", async () => {
  const error = new Error("That name is already taken");
  register.mockRejectedValue(error);
  show();
  openRegister();
  type("Username", "Taken");
  type("Password", "secret");
  fireEvent.click(screen.getByRole("button", { name: "Register" }));
  expect(await screen.findByText(describeError(error))).toBeTruthy();
  expect(onSettle).not.toHaveBeenCalled();
});

it("skips the page from Cancel on the Log in tab", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onSettle).toHaveBeenCalledWith("server");
  expect(screen.getByText("You're ready")).toBeTruthy();
});

it("skips the page from Cancel on the Register tab", () => {
  show();
  openRegister();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onSettle).toHaveBeenCalledWith("server");
  expect(screen.getByText("You're ready")).toBeTruthy();
});
