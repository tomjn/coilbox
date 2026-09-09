// @vitest-environment happy-dom

/**
 * `CHANGEPASSWORD` has no reply of its own, only a bare `SERVERMSG`. Pairing
 * that announcement with the request is only possible where the request was
 * made, so it happens here, and the saved password is only overwritten when the
 * server actually said it changed.
 *
 * Modelled on `oneLobbyConnection.dom.test.tsx`: these drive the real provider
 * rather than a copy of its logic, so the mocking setup for
 * `@tauri-apps/api/core` and the fake `Channel` wiring is copied from there.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyServer } from "../lobby-servers/config";
import type { LobbyEvent, LobbyState } from "./bindings";

interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

const wire = vi.hoisted(() => ({
  /** The event channel each connect handed the Rust side, by server key. */
  channels: new Map<string, FakeChannel>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (ev: LobbyEvent) => void;
  },
}));

// The settings store, as much of it as the provider reads: a value per key that
// starts at the default and can be set. Every list the provider keeps (channels,
// favourites, ignores, accounts) goes through this.
vi.mock("@picoframe/frame", async () => {
  const react = await import("react");
  return {
    useSetting: <T,>(_key: string, initial: T) => react.useState<T>(initial),
  };
});

vi.mock("../notify/notify", () => ({
  notify: async () => {},
}));

// Audio and taskbar cues all touch `window` at module scope for their unlock
// listeners, and nothing here rings or flashes.
vi.mock("./ringEffect", () => ({ triggerRing: () => {} }));
vi.mock("./ingameCue", () => ({ triggerIngameCue: () => {} }));
vi.mock("./chat/mentionCue", () => ({ triggerMentionCue: () => {} }));

// The provider renders four of its own dialogs. They read the context this is
// testing and drag in the whole component library with them.
vi.mock("./DebriefingDrawer", () => ({ DebriefingDrawer: () => null }));
vi.mock("./MatchFoundPanel", () => ({ MatchFoundPanel: () => null }));
vi.mock("./ServerMessageBoxDialog", () => ({
  ServerMessageBoxDialog: () => null,
}));
vi.mock("./VerificationCodeDialog", () => ({
  VerificationCodeDialog: () => null,
}));

const emptyState = (): LobbyState =>
  ({
    myUsername: "AF",
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
  }) as unknown as LobbyState;

vi.mock("./bindings", () => ({
  mpConnect: async (args: { serverKey: string; onEvent: FakeChannel }) => {
    wire.channels.set(args.serverKey, args.onEvent);
    return { connected: true };
  },
  mpConnectTachyon: async () => ({ connected: true }),
  mpConnectZerok: async () => ({ connected: true }),
  mpSnapshot: async () => ({ state: emptyState() }),
  mpDisconnect: async () => ({ disconnected: true }),
  mpWaitUntilReady: async () => ({ ready: true }),
  mpActiveKeys: async () => ({ keys: [] as string[] }),
  mpReattach: async () => ({ reattached: true }),
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
  mpRecoverPassword: async () => ({ connected: true }),
  mpSubmitRecoveryCode: async () => ({ sent: true }),
  mpChangePassword: async () => ({ sent: true }),
  mpChangeEmailRequest: async () => ({ sent: true }),
  mpChangeEmail: async () => ({ sent: true }),
  mpResendVerification: async () => ({ sent: true }),
  mpGetUserInfo: async () => ({ sent: true }),
  mpSetStatus: async () => ({}),
  mpTachyonSignedIn: async () => ({ signedIn: true }),
  mpTachyonSignIn: async () => ({}),
}));

vi.mock("../lobby-servers/bindings", () => ({
  lsGetCredential: async () => ({ secret: "hunter2" }),
}));

import { MultiplayerProvider, useMultiplayer } from "./store";

const LOBBY: LobbyServer = {
  id: "bar-ssl",
  name: "Beyond All Reason",
  host: "server4.beyondallreason.info",
  port: 8201,
  tls: true,
  tlsStyle: "direct",
  allowSelfSigned: false,
};
const LOBBY_KEY = "AF_@server4.beyondallreason.info:8201";

beforeEach(() => {
  wire.channels.clear();
});

afterEach(() => {
  cleanup();
});

/**
 * The provider, mounted and connected, with a way to push events up the
 * channel the connection was opened with. Every test needs a live connection
 * before it can push a delta at all, because a delta only ever arrives over a
 * channel a connect handed out.
 */
async function renderProvider() {
  const { result } = renderHook(() => useMultiplayer(), {
    wrapper: MultiplayerProvider,
  });
  await act(async () => {});
  await act(async () => {
    await result.current.connect(LOBBY, "AF_");
  });
  const channel = wire.channels.get(LOBBY_KEY);
  if (!channel) throw new Error(`no channel for ${LOBBY_KEY}`);
  const emit = async (ev: LobbyEvent) => {
    await act(async () => {
      channel.onmessage?.(ev);
    });
  };
  return { result, emit };
}

describe("account commands", () => {
  it("resolves change password from the next server message", async () => {
    const { result, emit } = await renderProvider();
    const pending = result.current.changePassword("old", "new");
    await emit({
      kind: "delta",
      delta: {
        kind: "serverMessage",
        text: "Password changed successfully.",
        boxed: false,
      },
    });
    await expect(pending).resolves.toEqual({
      message: "Password changed successfully.",
      succeeded: true,
    });
  });

  it("reports a refusal as a failure without claiming success", async () => {
    const { result, emit } = await renderProvider();
    const pending = result.current.changePassword("old", "new");
    await emit({
      kind: "delta",
      delta: {
        kind: "serverMessage",
        text: "New password must be different to current password.",
        boxed: false,
      },
    });
    await expect(pending).resolves.toEqual({
      message: "New password must be different to current password.",
      succeeded: false,
    });
  });

  it("merges the three account info lines into one record", async () => {
    const { result, emit } = await renderProvider();
    await emit({
      kind: "delta",
      delta: {
        kind: "accountInfo",
        registrationDate: null,
        email: "a@b.c",
        ingameHours: null,
      },
    });
    await emit({
      kind: "delta",
      delta: {
        kind: "accountInfo",
        registrationDate: "Jan 01, 2020",
        email: null,
        ingameHours: null,
      },
    });
    expect(result.current.accountInfo).toEqual({
      registrationDate: "Jan 01, 2020",
      email: "a@b.c",
      ingameHours: null,
    });
  });
});
