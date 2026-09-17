// @vitest-environment happy-dom

/**
 * The agreement dialog, the boxed server message dialog and the debriefing
 * drawer with more than one connection open (issue #2847). Each used to read
 * one connection's state unconditionally, so a second connection's agreement
 * prompt, boxed message or match result had nowhere to show. All three now
 * queue by server key and name the connection they belong to once there is
 * more than one to tell apart. With one connection they look exactly as
 * before.
 *
 * The mock setup is `reattachAll.dom.test.tsx`'s, with the three dialogs left
 * real (rather than stubbed to `null`) since their content is the subject
 * here, and a MemoryRouter added because `DebriefingDrawer` calls
 * `useNavigate`.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "../lib/storedSetting";
import { BUILTIN_SERVERS } from "../lobby-servers/config";
import type { LobbyEvent, LobbyState } from "./bindings";

interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

const wire = vi.hoisted(() => ({
  channels: new Map<string, FakeChannel>(),
  activeKeys: [] as string[],
  /** Per-key snapshot state, mutated mid-test to answer the batched
   * `mpSnapshot` a delta schedules. */
  states: new Map<string, unknown>(),
}));

const settings = vi.hoisted(() => ({
  lastLogin: null as { serverId: string; username: string } | null,
  accounts: {
    accounts: [] as { id: string; serverId: string; username: string }[],
  },
  autoConnect: false,
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (ev: LobbyEvent) => void;
  },
}));

vi.mock("@picoframe/frame", async () => {
  const react = await import("react");
  return {
    useSetting: <T,>(key: string, initial: T) => {
      const preset: Record<string, unknown> = {
        "lobbyServers.lastLogin": settings.lastLogin,
        "lobbyServers.accounts": settings.accounts,
        "multiplayer.autoConnect": settings.autoConnect,
      };
      const seed = key in preset ? (preset[key] as T) : initial;
      return react.useState<T>(seed);
    },
    Button: ({
      children,
      ...props
    }: { children?: ReactNode } & Record<string, unknown>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Input: (props: Record<string, unknown>) => <input {...props} />,
  };
});

vi.mock("../notify/notify", () => ({ notify: async () => {} }));
vi.mock("./ringEffect", () => ({ triggerRing: () => {} }));
vi.mock("./ingameCue", () => ({ triggerIngameCue: () => {} }));
vi.mock("./chat/mentionCue", () => ({ triggerMentionCue: () => {} }));
vi.mock("./MatchFoundPanel", () => ({ MatchFoundPanel: () => null }));

function emptyState(username: string): LobbyState {
  return {
    myUsername: username,
    compflags: [],
    users: {},
    channels: {},
    dms: {},
    battles: {},
    currentBattle: null,
    lastBattle: null,
    hostPort: null,
    channelDirectory: [],
    currentVote: null,
    serverIgnores: [],
    friends: [],
    friendRequests: [],
    party: null,
    debriefing: null,
  } as unknown as LobbyState;
}

vi.mock("./bindings", () => ({
  mpConnect: async (args: { serverKey: string; onEvent: FakeChannel }) => {
    wire.channels.set(args.serverKey, args.onEvent);
    return { connected: true };
  },
  mpConnectTachyon: async () => ({ connected: true }),
  mpConnectZerok: async () => ({ connected: true }),
  mpSnapshot: async ({ serverKey }: { serverKey: string }) => ({
    state: wire.states.get(serverKey) ?? emptyState(serverKey.split("@")[0]),
  }),
  mpDisconnect: async () => ({ disconnected: true }),
  mpWaitUntilReady: async () => ({ ready: true }),
  mpActiveKeys: async () => ({ keys: wire.activeKeys }),
  mpReattach: async (args: { serverKey: string; onEvent: FakeChannel }) => {
    wire.channels.set(args.serverKey, args.onEvent);
    return { reattached: true };
  },
  mpCancelConnect: async () => ({ cancelled: true }),
  mpConfirmAgreement: async () => ({}),
  mpFriendList: async () => ({}),
  mpFriendRequestList: async () => ({}),
  mpIgnore: async () => ({}),
  mpIgnoreList: async () => ({}),
  mpJoinBattle: async () => ({}),
  mpJoinChannel: async () => ({}),
  mpRegister: async () => ({}),
  mpRegisterZerok: async () => ({}),
  mpSetStatus: async () => ({}),
  mpTachyonSignedIn: async () => ({ signedIn: true }),
  mpTachyonSignIn: async () => ({}),
}));

vi.mock("../lobby-servers/bindings", () => ({
  lsGetCredential: async () => ({ secret: "hunter2" }),
}));

import { MultiplayerProvider, serverNameFor } from "./store";

const KEY_A = "AF@server4.beyondallreason.info:8201"; // bar-ssl
const KEY_B = "Zeta@lobby.recoilengine.org:8200"; // recoil-official

const NAME_A = serverNameFor(KEY_A, BUILTIN_SERVERS);
const NAME_B = serverNameFor(KEY_B, BUILTIN_SERVERS);

async function fire(serverKey: string, ev: LobbyEvent) {
  const channel = wire.channels.get(serverKey);
  if (!channel?.onmessage) throw new Error(`no channel for ${serverKey}`);
  await act(async () => {
    channel.onmessage?.(ev);
  });
}

async function mount() {
  render(
    <MemoryRouter>
      <MultiplayerProvider>
        <div />
      </MultiplayerProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
  for (const key of wire.activeKeys) {
    await fire(key, { kind: "phase", phase: "ready", agreement: null });
  }
}

/** Waits out the snapshot-batch debounce (`SNAPSHOT_BATCH_MS`) so a delta's
 * queued `mpSnapshot` has resolved and the mirror has caught up. */
async function settleSnapshot() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });
}

beforeEach(() => {
  // `seedJoinedChannels` reads through the storage singleton before seeding a
  // first connect's auto-join channels (issue #2920).
  installSettingsStorage(memorySettingsStorage());
  wire.channels.clear();
  wire.activeKeys = [];
  wire.states.clear();
});

afterEach(cleanup);

describe("the agreement dialog with two connections", () => {
  it("shows both prompts one at a time, each naming its server", async () => {
    wire.activeKeys = [KEY_A, KEY_B];
    await mount();

    await fire(KEY_A, {
      kind: "phase",
      phase: "awaitAgreement",
      agreement: "Terms for A",
    });
    await fire(KEY_B, {
      kind: "phase",
      phase: "awaitAgreement",
      agreement: "Terms for B",
    });

    // KEY_A is focused (first reattached key), so its prompt shows first.
    expect(screen.getByText("Terms for A")).toBeTruthy();
    expect(screen.getByText(NAME_A)).toBeTruthy();
    expect(screen.queryByText("Terms for B")).toBeNull();

    await act(async () => {
      screen.getByRole("button", { name: "Accept" }).click();
    });

    // B was queued behind A and now takes its place.
    expect(screen.getByText("Terms for B")).toBeTruthy();
    expect(screen.getByText(NAME_B)).toBeTruthy();
    expect(screen.queryByText("Terms for A")).toBeNull();
  });
});

describe("the agreement dialog with one connection", () => {
  it("shows the prompt with no server name, unchanged from before #2847", async () => {
    wire.activeKeys = [KEY_A];
    await mount();

    await fire(KEY_A, {
      kind: "phase",
      phase: "awaitAgreement",
      agreement: "Terms for A",
    });

    expect(screen.getByText("Terms for A")).toBeTruthy();
    expect(screen.queryByText(NAME_A)).toBeNull();
  });
});

describe("the boxed server message dialog with two connections", () => {
  it("shows a box from the unfocused connection, naming it", async () => {
    wire.activeKeys = [KEY_A, KEY_B];
    await mount();

    await fire(KEY_B, {
      kind: "delta",
      delta: { kind: "serverMessage", text: "Scheduled downtime", boxed: true },
    });

    expect(screen.getByText(`Server message from ${NAME_B}`)).toBeTruthy();
    expect(screen.getByText("Scheduled downtime")).toBeTruthy();
  });
});

describe("the boxed server message dialog with one connection", () => {
  it("shows the plain title, unchanged from before #2847", async () => {
    wire.activeKeys = [KEY_A];
    await mount();

    await fire(KEY_A, {
      kind: "delta",
      delta: { kind: "serverMessage", text: "Scheduled downtime", boxed: true },
    });

    expect(screen.getByText("Server message")).toBeTruthy();
    expect(screen.queryByText(`Server message from ${NAME_A}`)).toBeNull();
  });
});

describe("the debriefing drawer with two connections", () => {
  it("shows the unfocused connection's result once its snapshot catches up, naming it", async () => {
    wire.activeKeys = [KEY_A, KEY_B];
    wire.states.set(KEY_A, emptyState("AF"));
    wire.states.set(KEY_B, emptyState("Zeta"));
    await mount();

    wire.states.set(KEY_B, {
      ...emptyState("Zeta"),
      debriefing: {
        battleId: 42,
        url: null,
        message: null,
        ratingCategory: null,
        chatChannel: null,
        players: [],
      },
    });
    await fire(KEY_B, {
      kind: "delta",
      delta: { kind: "debriefingReceived", battleId: 42 },
    });
    await settleSnapshot();

    expect(screen.getByLabelText("Match result")).toBeTruthy();
    expect(screen.getByText(NAME_B)).toBeTruthy();
  });
});
