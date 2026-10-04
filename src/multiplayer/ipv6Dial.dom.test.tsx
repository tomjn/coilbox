// @vitest-environment happy-dom

/**
 * The host a connection hands to the Rust side (issues #3407 and #3420).
 *
 * An IPv6 address is written in brackets to show it and inside a `host:port`
 * string, and the dial takes none: `TcpStream::connect((host, port))` looks a
 * bracketed host up as a name. Every command that dials a TCP socket therefore
 * gets the bare address. A Tachyon server is the exception, because the Rust
 * side builds a URL from the host and a URL writes an IPv6 host in brackets.
 *
 * The mock setup is copied from `connectionState.dom.test.tsx`.
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "../lib/storedSetting";
import type { LobbyServer } from "../lobby-servers/config";
import type { LobbyEvent, LobbyState } from "./bindings";

interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

const wire = vi.hoisted(() => ({
  /** The `host` each dialling command was handed, in order, by command. */
  hosts: [] as { command: string; host: string }[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (ev: LobbyEvent) => void;
  },
}));

vi.mock("@picoframe/frame", async () => {
  const react = await import("react");
  return {
    useSetting: <T,>(_key: string, initial: T) => react.useState<T>(initial),
  };
});

vi.mock("../notify/notify", () => ({ notify: async () => {} }));
vi.mock("./ringEffect", () => ({ triggerRing: () => {} }));
vi.mock("./ingameCue", () => ({ triggerIngameCue: () => {} }));
vi.mock("./chat/mentionCue", () => ({ triggerMentionCue: () => {} }));
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

const dials = (command: string) => async (args: { host: string }) => {
  wire.hosts.push({ command, host: args.host });
  return { connected: true };
};

vi.mock("./bindings", () => ({
  mpConnect: async (args: { host: string }) => dials("mpConnect")(args),
  mpConnectTachyon: async (args: { host: string }) =>
    dials("mpConnectTachyon")(args),
  mpConnectZerok: async (args: { host: string }) =>
    dials("mpConnectZerok")(args),
  mpRegister: async (args: { host: string; onEvent: FakeChannel }) => {
    wire.hosts.push({ command: "mpRegister", host: args.host });
    args.onEvent.onmessage?.({ kind: "phase", phase: "registered" } as never);
    return { connected: true };
  },
  mpRegisterZerok: async (args: { host: string; onEvent: FakeChannel }) => {
    wire.hosts.push({ command: "mpRegisterZerok", host: args.host });
    args.onEvent.onmessage?.({ kind: "phase", phase: "registered" } as never);
    return { connected: true };
  },
  mpRecoverPassword: async (args: { host: string; onEvent: FakeChannel }) => {
    wire.hosts.push({ command: "mpRecoverPassword", host: args.host });
    args.onEvent.onmessage?.({
      kind: "delta",
      delta: { kind: "recoveryUrl", url: "https://example.test/" },
    } as never);
    return { connected: true };
  },
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
  mpSetStatus: async () => ({}),
  mpTachyonSignedIn: async () => ({ signedIn: true }),
  mpTachyonSignIn: async () => ({}),
}));

vi.mock("../lobby-servers/bindings", () => ({
  lsGetCredential: async () => ({ secret: "hunter2" }),
}));

import { MultiplayerProvider, useMultiplayer } from "./store";

let store: ReturnType<typeof useMultiplayer>;

function Probe() {
  store = useMultiplayer();
  return null;
}

function saved(host: string, protocol?: LobbyServer["protocol"]): LobbyServer {
  return {
    id: "mine",
    name: "Mine",
    host,
    port: 8200,
    tls: false,
    allowSelfSigned: false,
    ...(protocol ? { protocol } : {}),
  };
}

async function mount() {
  render(
    <MultiplayerProvider>
      <Probe />
    </MultiplayerProvider>,
  );
  await act(async () => {});
}

/** The hosts the dial was handed, after running `go`, with the store reset. */
async function dialled(go: () => Promise<unknown>) {
  wire.hosts.length = 0;
  await act(async () => {
    await go();
  });
  return wire.hosts.map((h) => h.host);
}

beforeEach(() => {
  installSettingsStorage(memorySettingsStorage());
  wire.hosts.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("joining a room at an IPv6 address", () => {
  it("dials a bracketed host bare, as a room link and the join form write it", async () => {
    await mount();
    for (const [written, bare] of [
      ["[::1]", "::1"],
      ["[2001:db8::1]", "2001:db8::1"],
      ["[::ffff:102:304]", "::ffff:102:304"],
    ]) {
      expect(
        await dialled(() => store.connectDirect(8200, "AF", written)),
        written,
      ).toEqual([bare]);
      await act(async () => {
        await store.disconnect(`AF@${written}:8200`);
      });
    }
  });

  it("dials a host typed without brackets as it is", async () => {
    await mount();
    expect(
      await dialled(() => store.connectDirect(8200, "AF", "2001:db8::1")),
    ).toEqual(["2001:db8::1"]);
  });

  it("leaves an IPv4 address and a hostname as they were", async () => {
    await mount();
    for (const host of ["192.168.1.45", "tomlaptop.local"]) {
      expect(
        await dialled(() => store.connectDirect(8200, "AF", host)),
        host,
      ).toEqual([host]);
      await act(async () => {
        await store.disconnect(`AF@${host}:8200`);
      });
    }
  });
});

describe("a lobby server saved under an IPv6 address", () => {
  it("is dialled bare whether the saved host has brackets or not", async () => {
    await mount();
    for (const host of ["::1", "[::1]", "2001:db8::1", "[2001:db8::1]"]) {
      const bare = host.replace(/^\[|\]$/g, "");
      expect(
        await dialled(() => store.connect(saved(host), "me")),
        host,
      ).toEqual([bare]);
      await act(async () => {
        await store.disconnect(`me@${host}:8200`);
      });
    }
  });

  it("is dialled bare by Zero-K, registration and recovery too", async () => {
    await mount();
    for (const host of ["::1", "[::1]"]) {
      expect(
        await dialled(() => store.connect(saved(host, "zerok"), "me")),
        host,
      ).toEqual(["::1"]);
      await act(async () => {
        await store.disconnect(`me@${host}:8200`);
      });
      expect(
        await dialled(() => store.register(saved(host), "me", "pw")),
        host,
      ).toEqual(["::1"]);
      expect(
        await dialled(() => store.register(saved(host, "zerok"), "me", "pw")),
        host,
      ).toEqual(["::1"]);
      expect(
        await dialled(() => store.recoverPassword(saved(host), "me@mail.test")),
        host,
      ).toEqual(["::1"]);
    }
  });

  it("hands a Tachyon server's host over in brackets, because the Rust side builds a URL from it", async () => {
    await mount();
    for (const host of ["::1", "[::1]"]) {
      const server = { ...saved(host, "tachyon"), tls: true };
      expect(await dialled(() => store.connect(server, "me")), host).toEqual([
        "[::1]",
      ]);
      await act(async () => {
        await store.disconnect(`me@${host}:8200`);
      });
    }
  });

  it("leaves an IPv4 address and a hostname as they were", async () => {
    await mount();
    for (const host of ["192.168.1.45", "lobby.example.com"]) {
      expect(
        await dialled(() => store.connect(saved(host), "me")),
        host,
      ).toEqual([host]);
      await act(async () => {
        await store.disconnect(`me@${host}:8200`);
      });
    }
  });
});
