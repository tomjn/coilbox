// @vitest-environment happy-dom

/**
 * A server refusing a login's password (issue #4184).
 *
 * The store raises one notification for every refusal, whichever way the login
 * started: the popover, the boot connect or the reconnect loop. It names the
 * server and the account, carries the server's reason and a button to the
 * login's password field, and nothing connects again until the player acts.
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "../lib/storedSetting";
import {
  registerDrawerNavigator,
  takeDrawerRequest,
} from "../lobby-servers/drawerRequest";

type Notified = {
  title: string;
  body?: string;
  to?: string;
  sticky?: boolean;
  action?: { label: string; onClick: () => void };
};

const wire = vi.hoisted(() => ({
  channels: new Map<string, FakeChannel>(),
  /** Every key a connect was opened for, in order, across both protocols. */
  attempts: [] as string[],
  /** Keys whose server refuses the password, with the reason it gives. */
  refuse: new Map<string, string>(),
  /** Keys whose connect fails for any other reason. */
  unreachable: new Set<string>(),
  notified: [] as Notified[],
}));

const settings = vi.hoisted(() => ({
  accounts: {
    accounts: [] as {
      id: string;
      serverId: string;
      username: string;
      openAtQuit?: boolean;
    }[],
  },
  autoConnect: false,
}));

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./lobbyStoreMocks.testhelper")).tauriCoreStub(),
);

vi.mock("@picoframe/frame", async () => {
  const react = await import("react");
  return {
    useSetting: <T,>(key: string, initial: T) => {
      const preset: Record<string, unknown> = {
        "lobbyServers.lastLogin": null,
        "lobbyServers.accounts": settings.accounts,
        "multiplayer.autoConnect": settings.autoConnect,
      };
      const seed = key in preset ? (preset[key] as T) : initial;
      return react.useState<T>(seed);
    },
  };
});

vi.mock("../notify/notify", () => ({
  notify: async (input: Notified) => {
    wire.notified.push(input);
  },
}));
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

/**
 * What both protocols do on a refused password: the denial delta, the close the
 * server follows it with, then a rejected connect.
 */
async function open(args: { serverKey: string; onEvent: FakeChannel }) {
  wire.attempts.push(args.serverKey);
  wire.channels.set(args.serverKey, args.onEvent);
  const reason = wire.refuse.get(args.serverKey);
  if (reason != null) {
    args.onEvent.onmessage?.({
      kind: "delta",
      delta: { kind: "loginDenied", reason },
    });
    args.onEvent.onmessage?.({
      kind: "disconnected",
      reason: "the server refused the login",
    });
    throw new Error("the server refused the login");
  }
  if (wire.unreachable.has(args.serverKey)) throw new Error("unreachable");
  return { connected: true };
}

vi.mock("./bindings", async () => ({
  ...(await import("./lobbyStoreMocks.testhelper")).inertBindings(),
  mpConnect: open,
  mpConnectZerok: open,
  mpSnapshot: async () => ({ state: emptyLobbyState() }),
  mpDisconnect: async () => ({ disconnected: true }),
  mpActiveKeys: async () => ({ keys: [] }),
  mpReattach: async () => ({ reattached: true }),
}));

vi.mock("../lobby-servers/bindings", async () =>
  (await import("./lobbyStoreMocks.testhelper")).lobbyServerBindings(),
);

import { BUILTIN_SERVERS } from "../lobby-servers/config";
import {
  emptyLobbyState,
  type FakeChannel,
} from "./lobbyStoreMocks.testhelper";
import { LoginRefusedError } from "./loginRefused";
import { MultiplayerProvider, useMultiplayer } from "./store";

const server = (id: string) => {
  const found = BUILTIN_SERVERS.find((s) => s.id === id);
  if (!found) throw new Error(`no built-in server ${id}`);
  return found;
};

const BAR = server("bar-ssl");
const ZEROK = server("zero-k");
const RECOIL = server("recoil-official");
const BAR_KEY = `AF@${BAR.host}:${BAR.port}`;
const ZEROK_KEY = `Tom@${ZEROK.host}:${ZEROK.port}`;
const RECOIL_KEY = `Zeta@${RECOIL.host}:${RECOIL.port}`;

let store: ReturnType<typeof useMultiplayer>;

function Probe() {
  store = useMultiplayer();
  return null;
}

async function mount() {
  render(
    <MultiplayerProvider>
      <Probe />
    </MultiplayerProvider>,
  );
  await act(async () => {});
}

const refusals = () =>
  wire.notified.filter((n) => n.title.includes("refused the password"));

beforeEach(() => {
  installSettingsStorage(memorySettingsStorage());
  wire.channels.clear();
  wire.attempts.length = 0;
  wire.refuse.clear();
  wire.unreachable.clear();
  wire.notified.length = 0;
  settings.accounts = { accounts: [] };
  settings.autoConnect = false;
});

afterEach(() => {
  cleanup();
  takeDrawerRequest();
  vi.useRealTimers();
});

describe("a login started from the popover", () => {
  it("raises a notification on a TASServer server", async () => {
    wire.refuse.set(BAR_KEY, "invalid password");
    await mount();

    await act(async () => {
      await expect(store.connect(BAR, "AF")).rejects.toBeInstanceOf(
        LoginRefusedError,
      );
    });

    expect(refusals()).toHaveLength(1);
    expect(refusals()[0].title).toBe(
      "Beyond All Reason refused the password for AF",
    );
    expect(refusals()[0].body).toBe("invalid password");
  });

  it("raises a notification on Zero-K", async () => {
    wire.refuse.set(ZEROK_KEY, "invalid password");
    await mount();

    await act(async () => {
      await expect(store.connect(ZEROK, "Tom")).rejects.toBeInstanceOf(
        LoginRefusedError,
      );
    });

    expect(refusals().map((n) => n.title)).toEqual([
      "Zero-K refused the password for Tom",
    ]);
  });

  it("still raises it when the popover was closed before the refusal arrived", async () => {
    wire.refuse.set(BAR_KEY, "invalid password");
    await mount();

    await act(async () => {
      store.openLoginPopover();
    });
    const login = act(async () => {
      await store.connect(BAR, "AF").catch(() => {});
    });
    await act(async () => {
      store.closeLoginPopover();
    });
    await login;

    expect(store.loginPopoverOpen).toBe(false);
    expect(refusals()).toHaveLength(1);
  });

  it("stays up until dismissed and offers one action to the login's password field", async () => {
    wire.refuse.set(BAR_KEY, "invalid password");
    const navigated: string[] = [];
    const stop = registerDrawerNavigator((to) => navigated.push(to));
    await mount();

    await act(async () => {
      await store.connect(BAR, "AF").catch(() => {});
    });

    const [refusal] = refusals();
    expect(refusal.sticky).toBe(true);
    expect(refusal.to).toBe("/settings/lobby-servers");
    expect(refusal.action?.label).toBe("Change password");

    refusal.action?.onClick();

    expect(navigated).toEqual(["/settings/lobby-servers"]);
    expect(takeDrawerRequest()).toEqual({
      kind: "password",
      serverId: "bar-ssl",
      username: "AF",
    });
    stop();
  });

  it("says nothing of a refusal when the connect failed for another reason", async () => {
    wire.unreachable.add(BAR_KEY);
    await mount();

    await act(async () => {
      await expect(store.connect(BAR, "AF")).rejects.not.toBeInstanceOf(
        LoginRefusedError,
      );
    });

    expect(refusals()).toEqual([]);
  });
});

describe("a saved login at boot", () => {
  beforeEach(() => {
    settings.autoConnect = true;
    settings.accounts = {
      accounts: [
        { id: "a1", serverId: "bar-ssl", username: "AF", openAtQuit: true },
        {
          id: "a2",
          serverId: "recoil-official",
          username: "Zeta",
          openAtQuit: true,
        },
      ],
    };
  });

  it("raises the refusal, not 'Couldn't connect'", async () => {
    wire.refuse.set(BAR_KEY, "invalid password");
    await mount();

    expect(refusals().map((n) => n.title)).toEqual([
      "Beyond All Reason refused the password for AF",
    ]);
    expect(
      wire.notified.filter(
        (n) => n.title === "Couldn't connect to multiplayer",
      ),
    ).toEqual([]);
  });

  it("keeps 'Couldn't connect' for a failure that is not a refusal", async () => {
    wire.unreachable.add(RECOIL_KEY);
    wire.refuse.set(BAR_KEY, "invalid password");
    await mount();

    expect(refusals()).toHaveLength(1);
    const unreachable = wire.notified.filter(
      (n) => n.title === "Couldn't connect to multiplayer",
    );
    expect(unreachable).toHaveLength(1);
    expect(unreachable[0].body).toContain("Zeta");
  });

  it("tries a refused password once", async () => {
    wire.refuse.set(BAR_KEY, "invalid password");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(wire.attempts.filter((k) => k === BAR_KEY)).toHaveLength(1);
  });
});

describe("a dropped connection", () => {
  it("is not retried once the server refuses the password it reconnects with", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    await mount();
    await act(async () => {
      await store.connect(BAR, "AF");
    });
    await act(async () => {
      wire.channels
        .get(BAR_KEY)
        ?.onmessage?.({ kind: "phase", phase: "ready", agreement: null });
    });
    expect(wire.attempts).toEqual([BAR_KEY]);

    // The password changed on the server while the connection was up.
    wire.refuse.set(BAR_KEY, "invalid password");
    await act(async () => {
      wire.channels.get(BAR_KEY)?.onmessage?.({
        kind: "disconnected",
        reason: "connection reset",
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    // One reconnect, refused, and then nothing.
    expect(wire.attempts).toEqual([BAR_KEY, BAR_KEY]);
    expect(refusals()).toHaveLength(1);
    expect(
      wire.notified.filter((n) => n.title === "Multiplayer login refused"),
    ).toEqual([]);
  });
});

describe("several logins", () => {
  it("names the one that was refused", async () => {
    wire.refuse.set(ZEROK_KEY, "invalid password");
    await mount();

    await act(async () => {
      await store.connect(BAR, "AF");
      await store.connect(ZEROK, "Tom").catch(() => {});
    });

    expect(wire.attempts).toEqual([BAR_KEY, ZEROK_KEY]);
    expect(refusals().map((n) => n.title)).toEqual([
      "Zero-K refused the password for Tom",
    ]);
  });
});
