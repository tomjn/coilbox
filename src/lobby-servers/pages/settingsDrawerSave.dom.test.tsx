// @vitest-environment happy-dom

/**
 * The login and server drawers on the lobby-servers settings page (issue
 * #2922). Adding edits a draft that is written only when the player presses
 * Add, editing says that it saves as the player goes, and renaming a login
 * carries its saved password over to the new name.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

/** A fake keychain, keyed the way the Rust side keys it. */
const keychain = vi.hoisted(() => new Map<string, string>());
const credKey = (serverId: string, username: string) =>
  `${serverId}:${username}`;

type Cred = { serverId: string; username: string };
const lsBindings = vi.hoisted(() => ({
  lsGetCredential: vi.fn(async ({ serverId, username }: Cred) => ({
    secret: keychain.get(`${serverId}:${username}`) ?? null,
  })),
  lsStoreCredential: vi.fn(
    async ({ serverId, username, secret }: Cred & { secret: string }) => {
      keychain.set(`${serverId}:${username}`, secret);
      return {};
    },
  ),
  lsDeleteCredential: vi.fn(async ({ serverId, username }: Cred) => {
    keychain.delete(`${serverId}:${username}`);
    return {};
  }),
}));
vi.mock("../bindings", () => lsBindings);

vi.mock("../../multiplayer/bindings", () => ({
  mpTachyonSignOut: vi.fn(async () => ({})),
}));
vi.mock("../../multiplayer/ConsoleDrawer", () => ({
  ConsoleDrawer: () => null,
}));
vi.mock("../RegisterForm", () => ({ RegisterForm: () => null }));

/** The recovery form, reduced to the one button that hands back a username. */
vi.mock("../PasswordRecoveryForm", () => ({
  PasswordRecoveryForm: ({
    onSignIn,
  }: {
    onSignIn: (serverId: string, username: string) => void;
  }) => (
    <button type="button" onClick={() => onSignIn("srv1", "recovered")}>
      Recovered sign in
    </button>
  ),
}));
vi.mock("./components/AutojoinChannels", () => ({
  AutojoinChannels: () => <p>Auto-join editor</p>,
}));

// Radix Select cannot be driven in happy-dom, so stand in a native one, the
// same way `ProjectsPage.dom.test.tsx` does.
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

vi.mock("../../multiplayer/store", () => ({
  serverKeyFor: (server: { host: string; port: number }, username: string) =>
    `${username}@${server.host}:${server.port}`,
  useConnection: () => null,
  useMultiplayer: () => ({
    signIn: vi.fn(async () => {}),
    busyKeys: new Set<string>(),
  }),
}));

// Built-in servers would crowd the server picker, and which ones ship is not
// what these tests are about.
vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof import("../config")>("../config");
  return {
    ...actual,
    allServers: (custom: import("../config").LobbyServer[]) => custom,
  };
});

const { PersistentStoreProvider } = await import("@picoframe/frame");
const { installSettingsStorage, memorySettingsStorage, readStoredSetting } =
  await import("@/lib/storedSetting");
const { default: LobbyServersSettings } = await import("./SettingsSection");
const { JOINED_CHANNELS_KEY } = await import("../../multiplayer/channels");
const { FAVOURITES_KEY } = await import("../../multiplayer/friends");
const { IGNORED_KEY } = await import("../../multiplayer/ignore");
const { NOTES_KEY } = await import("../../multiplayer/notes");
type LobbyAccount = import("../config").LobbyAccount;
type LobbyServer = import("../config").LobbyServer;

const ACCOUNTS_KEY = "lobbyServers.accounts";
const SERVERS_KEY = "lobbyServers.servers";

const SRV1: LobbyServer = {
  id: "srv1",
  name: "Test Server",
  host: "test.example",
  port: 8200,
  tls: false,
  allowSelfSigned: false,
};

let storage = memorySettingsStorage();

function show({
  accounts = [],
  servers = [SRV1],
}: {
  accounts?: LobbyAccount[];
  servers?: LobbyServer[];
} = {}) {
  storage.set(ACCOUNTS_KEY, JSON.stringify({ accounts }));
  storage.set(SERVERS_KEY, JSON.stringify({ servers }));
  return render(
    <PersistentStoreProvider storage={storage}>
      <LobbyServersSettings />
    </PersistentStoreProvider>,
  );
}

const storedAccounts = () =>
  readStoredSetting<{ accounts: LobbyAccount[] }>(ACCOUNTS_KEY, {
    accounts: [],
  }).accounts;
const storedServers = () =>
  readStoredSetting<{ servers: LobbyServer[] }>(SERVERS_KEY, { servers: [] })
    .servers;

/** The per-`serverKey` record stored under one of the server-keyed settings. */
const storedKeyed = <T,>(key: string) =>
  readStoredSetting<Record<string, T>>(key, {});

/** The open drawer with this title, if there is one. Closed drawers stay in
 *  the page, marked inert, so the title alone does not say which is open. */
function openDrawer(title: string) {
  return screen
    .queryAllByRole("heading", { name: title })
    .map((h) => h.closest("aside"))
    .find((aside) => aside != null && !aside.hasAttribute("inert"));
}

function drawer(title: string) {
  const aside = openDrawer(title);
  if (!aside) throw new Error(`no open drawer titled ${title}`);
  return within(aside);
}

function openRow(text: string) {
  const button = screen.getByText(text).closest("button");
  if (!button) throw new Error(`no row button for ${text}`);
  fireEvent.click(button);
}

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

beforeEach(() => {
  storage = memorySettingsStorage();
  installSettingsStorage(storage);
  keychain.clear();
  lsBindings.lsGetCredential.mockClear();
  lsBindings.lsStoreCredential.mockClear();
  lsBindings.lsDeleteCredential.mockClear();
});

afterEach(cleanup);

describe("adding a login", () => {
  it("writes nothing when the drawer opens", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Add login" }));
    expect(drawer("New login")).toBeTruthy();
    expect(storedAccounts()).toEqual([]);
  });

  it("keeps Add disabled until there is a username", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Add login" }));
    const d = drawer("New login");
    const add = d.getByRole("button", { name: "Add login" });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    type(d.getByLabelText("Username"), "   ");
    expect((add as HTMLButtonElement).disabled).toBe(true);
    type(d.getByLabelText("Username"), "alice");
    expect((add as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps Add disabled when that login already exists", () => {
    show({
      accounts: [
        { id: "1", serverId: SRV1.id, username: "alice", hasSecret: false },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Add login" }));
    const d = drawer("New login");
    type(d.getByLabelText("Username"), "alice");
    expect(
      (d.getByRole("button", { name: "Add login" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(d.getByText(/already have this login/i)).toBeTruthy();
  });

  it("does not store the password before Add is pressed", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Add login" }));
    const d = drawer("New login");
    type(d.getByLabelText("Username"), "alice");
    const password = d.getByLabelText(/^Password/);
    type(password, "hunter2");
    fireEvent.blur(password);
    expect(lsBindings.lsStoreCredential).not.toHaveBeenCalled();
    expect(storedAccounts()).toEqual([]);
  });

  it("adds the login and stores its password when Add is pressed", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Add login" }));
    const d = drawer("New login");
    type(d.getByLabelText("Username"), "alice");
    type(d.getByLabelText(/^Password/), "hunter2");
    fireEvent.click(d.getByRole("button", { name: "Add login" }));

    await waitFor(() => expect(storedAccounts()).toHaveLength(1));
    expect(storedAccounts()[0]).toMatchObject({
      serverId: SRV1.id,
      username: "alice",
      hasSecret: true,
    });
    expect(keychain.get(credKey(SRV1.id, "alice"))).toBe("hunter2");

    // The drawer stays open on the new login and says the password is kept.
    const edit = drawer("alice");
    expect(edit.getByText("Login added")).toBeTruthy();
    expect(edit.getByText("Saved in keychain")).toBeTruthy();
    expect(edit.getByText("Auto-join editor")).toBeTruthy();
  });

  it("adds nothing when the keychain refuses the password", async () => {
    lsBindings.lsStoreCredential.mockRejectedValueOnce("denied");
    show();
    fireEvent.click(screen.getByRole("button", { name: "Add login" }));
    const d = drawer("New login");
    type(d.getByLabelText("Username"), "alice");
    type(d.getByLabelText(/^Password/), "hunter2");
    fireEvent.click(d.getByRole("button", { name: "Add login" }));

    await waitFor(() =>
      expect(d.getByText(/could not save the password/i)).toBeTruthy(),
    );
    expect(storedAccounts()).toEqual([]);
  });

  it("leaves nothing behind on Cancel", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Add login" }));
    const d = drawer("New login");
    type(d.getByLabelText("Username"), "alice");
    type(d.getByLabelText(/^Password/), "hunter2");
    fireEvent.click(d.getByRole("button", { name: "Cancel" }));

    expect(openDrawer("New login")).toBeUndefined();
    expect(storedAccounts()).toEqual([]);
    expect(lsBindings.lsStoreCredential).not.toHaveBeenCalled();
  });

  it("leaves nothing behind when the drawer is closed", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Add login" }));
    const d = drawer("New login");
    type(d.getByLabelText("Username"), "alice");
    fireEvent.click(d.getByRole("button", { name: "Close" }));

    expect(openDrawer("New login")).toBeUndefined();
    expect(storedAccounts()).toEqual([]);
  });
});

describe("password recovery", () => {
  it("opens a draft for a login that does not exist yet", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Forgot password" }));
    fireEvent.click(screen.getByRole("button", { name: "Recovered sign in" }));

    const d = drawer("New login");
    expect((d.getByLabelText("Username") as HTMLInputElement).value).toBe(
      "recovered",
    );
    expect(storedAccounts()).toEqual([]);
  });

  it("opens the existing login for editing", () => {
    show({
      accounts: [
        {
          id: "1",
          serverId: SRV1.id,
          username: "recovered",
          hasSecret: false,
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Forgot password" }));
    fireEvent.click(screen.getByRole("button", { name: "Recovered sign in" }));
    expect(drawer("recovered").getByText(/save automatically/i)).toBeTruthy();
  });
});

describe("editing a login", () => {
  const alice: LobbyAccount = {
    id: "1",
    serverId: SRV1.id,
    username: "alice",
    hasSecret: true,
  };

  it("says changes save automatically and closes on Done", () => {
    keychain.set(credKey(SRV1.id, "alice"), "hunter2");
    show({ accounts: [alice] });
    openRow("alice");
    const d = drawer("alice");
    expect(d.getByText("Changes save automatically.")).toBeTruthy();
    fireEvent.click(d.getByRole("button", { name: "Done" }));
    expect(openDrawer("alice")).toBeUndefined();
    expect(storedAccounts()).toEqual([alice]);
  });

  it("shows Saved once a new password is stored", async () => {
    show({ accounts: [{ ...alice, hasSecret: false }] });
    openRow("alice");
    const d = drawer("alice");
    const password = d.getByLabelText(/^Password/);
    type(password, "hunter3");
    fireEvent.blur(password);

    await waitFor(() => expect(d.getByText("Password saved")).toBeTruthy());
    expect(keychain.get(credKey(SRV1.id, "alice"))).toBe("hunter3");
    expect(storedAccounts()[0].hasSecret).toBe(true);
  });

  it("moves the saved password when the login is renamed", async () => {
    keychain.set(credKey(SRV1.id, "alice"), "hunter2");
    show({ accounts: [alice] });
    openRow("alice");
    const username = drawer("alice").getByLabelText("Username");
    type(username, "alice2");
    fireEvent.blur(username);

    await waitFor(() =>
      expect(storedAccounts()[0]).toMatchObject({
        username: "alice2",
        hasSecret: true,
      }),
    );
    expect(keychain.get(credKey(SRV1.id, "alice2"))).toBe("hunter2");
    expect(keychain.has(credKey(SRV1.id, "alice"))).toBe(false);
    expect(drawer("alice2").getByText("Saved")).toBeTruthy();
  });

  it("asks for the password again when it cannot be moved", async () => {
    keychain.set(credKey(SRV1.id, "alice"), "hunter2");
    show({ accounts: [alice] });
    openRow("alice");
    // Let the drawer's own keychain check settle before the move is refused.
    await act(async () => {});
    lsBindings.lsStoreCredential.mockRejectedValueOnce("denied");
    const username = drawer("alice").getByLabelText("Username");
    type(username, "alice2");
    fireEvent.blur(username);

    await waitFor(() =>
      expect(storedAccounts()[0]).toMatchObject({
        username: "alice2",
        hasSecret: false,
      }),
    );
    expect(
      drawer("alice2").getByText(/enter the password again/i),
    ).toBeTruthy();
  });

  it("refuses a rename onto another saved login", async () => {
    show({
      accounts: [
        alice,
        { id: "2", serverId: SRV1.id, username: "bob", hasSecret: true },
      ],
    });
    openRow("alice");
    const username = drawer("alice").getByLabelText("Username");
    type(username, "bob");
    fireEvent.blur(username);

    expect(drawer("alice").getByText(/already have this login/i)).toBeTruthy();
    expect((username as HTMLInputElement).value).toBe("alice");
    expect(storedAccounts().map((a) => a.username)).toEqual(["alice", "bob"]);
    expect(lsBindings.lsStoreCredential).not.toHaveBeenCalled();
  });

  it("moves auto-join channels, favourites, ignores and notes when the login is renamed", async () => {
    const oldKey = "alice@test.example:8200";
    const newKey = "alice2@test.example:8200";
    storage.set(
      JOINED_CHANNELS_KEY,
      JSON.stringify({ [oldKey]: [{ name: "general" }] }),
    );
    storage.set(FAVOURITES_KEY, JSON.stringify({ [oldKey]: ["carol"] }));
    storage.set(IGNORED_KEY, JSON.stringify({ [oldKey]: ["troll"] }));
    storage.set(
      NOTES_KEY,
      JSON.stringify({ [oldKey]: { "name:carl": "friendly" } }),
    );
    keychain.set(credKey(SRV1.id, "alice"), "hunter2");
    show({ accounts: [alice] });
    openRow("alice");
    const username = drawer("alice").getByLabelText("Username");
    type(username, "alice2");
    fireEvent.blur(username);

    await waitFor(() =>
      expect(storedAccounts()[0]).toMatchObject({ username: "alice2" }),
    );
    expect(storedKeyed(JOINED_CHANNELS_KEY)[newKey]).toEqual([
      { name: "general" },
    ]);
    expect(storedKeyed(FAVOURITES_KEY)[newKey]).toEqual(["carol"]);
    expect(storedKeyed(IGNORED_KEY)[newKey]).toEqual(["troll"]);
    expect(storedKeyed(NOTES_KEY)[newKey]).toEqual({ "name:carl": "friendly" });
    expect(storedKeyed(JOINED_CHANNELS_KEY)[oldKey]).toBeUndefined();
    expect(storedKeyed(FAVOURITES_KEY)[oldKey]).toBeUndefined();
    expect(storedKeyed(IGNORED_KEY)[oldKey]).toBeUndefined();
    expect(storedKeyed(NOTES_KEY)[oldKey]).toBeUndefined();
  });

  it("does not overwrite server-key data already stored under the new key", async () => {
    const oldKey = "alice@test.example:8200";
    const newKey = "alice2@test.example:8200";
    storage.set(
      FAVOURITES_KEY,
      JSON.stringify({
        [oldKey]: ["carol"],
        [newKey]: ["dave"],
      }),
    );
    keychain.set(credKey(SRV1.id, "alice"), "hunter2");
    show({ accounts: [alice] });
    openRow("alice");
    const username = drawer("alice").getByLabelText("Username");
    type(username, "alice2");
    fireEvent.blur(username);

    await waitFor(() =>
      expect(storedAccounts()[0]).toMatchObject({ username: "alice2" }),
    );
    expect(storedKeyed(FAVOURITES_KEY)[oldKey]).toEqual(["carol"]);
    expect(storedKeyed(FAVOURITES_KEY)[newKey]).toEqual(["dave"]);
  });
});

describe("adding a server", () => {
  it("keeps Add disabled until there is a host and a valid port", () => {
    show({ servers: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add custom server" }));
    const d = drawer("New server");
    const add = d.getByRole("button", {
      name: "Add server",
    }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    type(d.getByLabelText("Host"), "lobby.example.org");
    expect(add.disabled).toBe(false);
    type(d.getByLabelText("Port"), "0");
    expect(add.disabled).toBe(true);
  });

  it("adds the server when Add is pressed", () => {
    show({ servers: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add custom server" }));
    const d = drawer("New server");
    type(d.getByLabelText("Name"), "Mine");
    type(d.getByLabelText("Host"), "lobby.example.org");
    expect(storedServers()).toEqual([]);
    fireEvent.click(d.getByRole("button", { name: "Add server" }));

    expect(storedServers()).toHaveLength(1);
    expect(storedServers()[0]).toMatchObject({
      name: "Mine",
      host: "lobby.example.org",
      port: 8200,
    });
    expect(drawer("Mine").getByText("Server added")).toBeTruthy();
  });

  it("leaves nothing behind on Cancel", () => {
    show({ servers: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add custom server" }));
    const d = drawer("New server");
    type(d.getByLabelText("Host"), "lobby.example.org");
    fireEvent.click(d.getByRole("button", { name: "Cancel" }));

    expect(openDrawer("New server")).toBeUndefined();
    expect(storedServers()).toEqual([]);
    expect(screen.queryByText("lobby.example.org:8200")).toBeNull();
  });
});

describe("editing a server", () => {
  it("shows Saved after a change and closes on Done", () => {
    show();
    openRow("Test Server");
    const d = drawer("Test Server");
    expect(d.getByText("Changes save automatically.")).toBeTruthy();
    expect(d.queryByText("Saved")).toBeNull();
    type(d.getByLabelText("Host"), "other.example");

    expect(storedServers()[0].host).toBe("other.example");
    expect(d.getByText("Saved")).toBeTruthy();
    fireEvent.click(d.getByRole("button", { name: "Done" }));
    expect(openDrawer("Test Server")).toBeUndefined();
  });

  it("moves server-key data for every login on the server when its port changes", () => {
    const aliceOldKey = "alice@test.example:8200";
    const bobOldKey = "bob@test.example:8200";
    const aliceNewKey = "alice@test.example:8201";
    const bobNewKey = "bob@test.example:8201";
    storage.set(
      JOINED_CHANNELS_KEY,
      JSON.stringify({
        [aliceOldKey]: [{ name: "general" }],
        [bobOldKey]: [{ name: "help" }],
      }),
    );
    show({
      accounts: [
        { id: "1", serverId: SRV1.id, username: "alice", hasSecret: false },
        { id: "2", serverId: SRV1.id, username: "bob", hasSecret: false },
      ],
    });
    // "Test Server" also names each account row, so scope the click to the
    // Servers section's own row rather than the ambiguous `openRow` helper.
    const serversSection = screen
      .getByRole("heading", { name: "Servers" })
      .closest("section");
    if (!serversSection) throw new Error("no Servers section");
    const serverButton = within(serversSection)
      .getByText("Test Server")
      .closest("button");
    if (!serverButton) throw new Error("no row button for Test Server");
    fireEvent.click(serverButton);
    const d = drawer("Test Server");
    type(d.getByLabelText("Port"), "8201");

    expect(storedServers()[0].port).toBe(8201);
    const channels = storedKeyed<{ name: string }[]>(JOINED_CHANNELS_KEY);
    expect(channels[aliceNewKey]).toEqual([{ name: "general" }]);
    expect(channels[bobNewKey]).toEqual([{ name: "help" }]);
    expect(channels[aliceOldKey]).toBeUndefined();
    expect(channels[bobOldKey]).toBeUndefined();
  });
});
