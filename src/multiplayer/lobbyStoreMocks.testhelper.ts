/**
 * The mock pieces the `MultiplayerProvider` tests share. `vi.mock` calls are
 * hoisted per file and take a path literal, so each test file still writes its
 * own `vi.mock(path, factory)`. What lives here is the content of the factories
 * that did not differ between files. A factory loads it with
 * `await import("./lobbyStoreMocks.testhelper")`, and for `./bindings` spreads
 * `inertBindings()` first so the file's own entries win.
 *
 * A dynamic import is needed because the factory runs while `./store` is being
 * imported, which can be before a static import of this file has loaded. The
 * `.testhelper.ts` name keeps vitest from collecting it as a test file.
 */

import type { LobbyEvent, LobbyState } from "./bindings";

/** The event channel the Rust side is handed on each connect. */
export interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

/** `@tauri-apps/api/core`, as far as the provider uses it. */
export function tauriCoreStub() {
  return {
    Channel: class {
      onmessage?: (ev: LobbyEvent) => void;
    },
  };
}

/** `../lobby-servers/bindings`: a saved login for every server. */
export function lobbyServerBindings() {
  return { lsGetCredential: async () => ({ secret: "hunter2" }) };
}

/**
 * The `./bindings` commands that every provider test answers the same way, with
 * a bare success. A file adds its own `mpConnect`, `mpDisconnect` and whatever
 * else it records or varies after spreading these, so its entries win.
 */
export function inertBindings() {
  return {
    mpConnectTachyon: async () => ({ connected: true }),
    mpConnectZerok: async () => ({ connected: true }),
    mpWaitUntilReady: async () => ({ ready: true }),
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
  };
}

/** A snapshot of a freshly connected user called `AF`, with nothing in it. */
export function emptyLobbyState(): LobbyState {
  return {
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
  } as unknown as LobbyState;
}
