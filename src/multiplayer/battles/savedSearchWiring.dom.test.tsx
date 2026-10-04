// @vitest-environment happy-dom

/**
 * The parts of saved battle searches that `savedSearch.test.ts` cannot reach:
 * the connection raising a notification that opens the right row, the
 * Notifications settings switching one search off, and the list opening the
 * collapsed group a notified battle sits in.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Battle } from "../bindings";

const notified = vi.hoisted(
  () => [] as { title: string; body?: string; to?: string }[],
);

vi.mock("../../notify/notify", () => ({
  notify: async (n: { title: string; body?: string; to?: string }) => {
    notified.push(n);
  },
}));
vi.mock("../bindings", () => ({
  mpFriendList: async () => {},
  mpFriendRequestList: async () => {},
  mpIgnore: async () => {},
  mpIgnoreList: async () => {},
  mpJoinBattle: async () => {},
}));
vi.mock("../useAwayStatus", () => ({
  useAwayStatus: () => ({
    status: { ingame: false, away: false },
    setIngame: () => {},
    manualAway: false,
    setManualAway: () => {},
  }),
}));
vi.mock("../../lobby-servers/config", () => ({
  profileOfficialServer: () => null,
}));
vi.mock("./BattleRowMapThumb", () => ({ BattleRowMapThumb: () => null }));
vi.mock("../admin/adminRequest", () => ({
  sendAdminCommand: async () => ({}),
}));

const { PersistentStoreProvider } = await import("@picoframe/frame");
const { installSettingsStorage, memorySettingsStorage, readStoredSetting } =
  await import("../../lib/storedSetting");
const { ConnectionSession } = await import("../ConnectionSession");
const { BattleList } = await import("./BattleList");
const { SavedSearchSettings } = await import("./SavedSearchSettings");
const { SAVED_BATTLE_SEARCHES_KEY } = await import("./savedSearch");

import type { ComponentProps } from "react";
import type { SavedBattleSearch } from "./savedSearch";

function battle(id: number, p: Partial<Battle> = {}): Battle {
  return {
    id,
    tachyonId: null,
    host: `host${id}`,
    ip: "",
    port: "",
    natType: "0",
    relayed: false,
    map: "Tabula",
    maphash: "",
    modname: "Beyond All Reason",
    engine: "",
    version: "",
    maxPlayers: 8,
    playerCount: 2,
    passworded: false,
    locked: false,
    spectatorCount: 0,
    title: `Battle ${id}`,
    channel: null,
    members: {},
    bots: {},
    scriptTags: {},
    startRects: {},
    bosses: [],
    bossesEnabled: false,
    inProgress: false,
    runningSince: null,
    mode: null,
    ...p,
  };
}

const SEARCH: SavedBattleSearch = {
  id: "s1",
  game: "Beyond All",
  map: "",
  minPlayers: 0,
  freeSlot: false,
  noPassword: false,
  enabled: true,
};

function session(
  battles: Battle[],
  searches: SavedBattleSearch[],
): ComponentProps<typeof ConnectionSession> {
  return {
    entry: {
      serverKey: "me@lobby.example:8200",
      live: true,
      mirror: {
        phase: "ready",
        serverIgnoreListSeq: 0,
        serverIgnoreList: [],
        state: {
          battles: Object.fromEntries(battles.map((b) => [String(b.id), b])),
          currentBattle: null,
          channels: {},
          dms: {},
          users: {},
          myUsername: "me",
          friends: [],
        },
      },
    },
    runtime: { seen: {}, baselineDone: false, rejoinBattle: null },
    servers: [],
    joinedChannels: {},
    setJoinedChannels: () => {},
    ignored: {},
    setIgnored: () => {},
    favourites: {},
    savedSearches: searches,
    serverName: "Lobby",
    requestJoinChannel: async () => {},
    update: () => {},
    onSeenChange: () => {},
    ingame: false,
    manualAway: false,
  } as unknown as ComponentProps<typeof ConnectionSession>;
}

beforeEach(() => {
  installSettingsStorage(memorySettingsStorage());
  notified.length = 0;
});
afterEach(cleanup);

describe("a connection with a saved search", () => {
  it("notifies once for a new matching battle, linking to its row", () => {
    const { rerender } = render(
      <PersistentStoreProvider storage={memorySettingsStorage()}>
        <ConnectionSession {...session([battle(1)], [SEARCH])} />
      </PersistentStoreProvider>,
    );
    expect(notified).toEqual([]);
    const next = session([battle(1), battle(2)], [SEARCH]);
    rerender(
      <PersistentStoreProvider storage={memorySettingsStorage()}>
        <ConnectionSession {...next} />
      </PersistentStoreProvider>,
    );
    expect(notified).toHaveLength(1);
    expect(notified[0].body).toContain("Battle 2 on Lobby");
    expect(notified[0].to).toBe(
      "/battles?server=me%40lobby.example%3A8200&battle=2",
    );
    // A player joining the battle changes it but does not notify again.
    const busier = session(
      [battle(1), battle(2, { playerCount: 5 })],
      [SEARCH],
    );
    rerender(
      <PersistentStoreProvider storage={memorySettingsStorage()}>
        <ConnectionSession {...busier} />
      </PersistentStoreProvider>,
    );
    expect(notified).toHaveLength(1);
  });
});

describe("the Notifications settings list", () => {
  it("switches one search off and keeps it stored", () => {
    const storage = memorySettingsStorage();
    installSettingsStorage(storage);
    storage.set(SAVED_BATTLE_SEARCHES_KEY, JSON.stringify([SEARCH]));
    render(
      <PersistentStoreProvider storage={storage}>
        <SavedSearchSettings />
      </PersistentStoreProvider>,
    );
    fireEvent.click(screen.getByRole("switch", { name: /Alert for/ }));
    expect(
      readStoredSetting<SavedBattleSearch[]>(SAVED_BATTLE_SEARCHES_KEY, []),
    ).toEqual([{ ...SEARCH, enabled: false }]);
  });

  it("deletes a search", () => {
    const storage = memorySettingsStorage();
    installSettingsStorage(storage);
    storage.set(SAVED_BATTLE_SEARCHES_KEY, JSON.stringify([SEARCH]));
    render(
      <PersistentStoreProvider storage={storage}>
        <SavedSearchSettings />
      </PersistentStoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Delete the alert/ }));
    expect(
      readStoredSetting<SavedBattleSearch[]>(SAVED_BATTLE_SEARCHES_KEY, []),
    ).toEqual([]);
  });
});

describe("the battle list for a notification", () => {
  const props = {
    totalCount: 2,
    joinedBattle: undefined,
    joinedId: null,
    canJoin: true,
    linkable: true,
    onJoin: () => {},
    onLeave: () => {},
  };

  it("opens the collapsed group holding the focused battle", () => {
    const pw = battle(2, { passworded: true });
    const { rerender } = render(
      <BattleList
        {...props}
        battles={[battle(1), pw]}
        inProgressIds={new Set()}
      />,
    );
    expect(screen.queryByText("Battle 2")).toBeNull();
    rerender(
      <BattleList
        {...props}
        battles={[battle(1), pw]}
        inProgressIds={new Set()}
        focusId={2}
      />,
    );
    expect(screen.getByText("Battle 2")).toBeTruthy();
    expect(
      screen.getByText("Battle 2").closest("li")?.getAttribute("aria-current"),
    ).toBe("true");
  });
});
