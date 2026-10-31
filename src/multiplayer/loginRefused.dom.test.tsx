// @vitest-environment happy-dom

/**
 * A server refusing a login (issue #4184).
 *
 * The store raises one notification for every refusal, whichever way the login
 * started: the popover, the boot connect or the reconnect loop. It names the
 * server and the account and carries the server's reason. When the reason names
 * a password it also has a button to the login's password field. Any other
 * reason, such as being logged in already, is said neutrally with no button.
 * Nothing connects again until the player acts.
 *
 * `mpConnect` resolves once the socket is up, so a refusal normally arrives as
 * events after it. The wire below can also reject the connect, with or without
 * those events, because the Rust side's coded error (`multiplayer.login.refused`)
 * can reach `doConnect` before the denial event or without one.
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

/**
 * How a connect to a key ends.
 *
 * - `later`: the socket opens and the connect resolves. The test sends the
 *   denial itself, which is what happens against a real server.
 * - `events-then-reject`: the denial, the close, then a rejected connect.
 * - `events-then-resolve`: the denial and the close arrive before the connect
 *   returns to its caller.
 * - `code-only`: the connect rejects with the coded error and no denial event.
 * - `unreachable`: the connect rejects for any other reason.
 */
type Outcome =
  | "later"
  | "events-then-reject"
  | "events-then-resolve"
  | "code-only"
  | "unreachable";

const wire = vi.hoisted(() => ({
  channels: new Map<string, FakeChannel>(),
  /** Every key a connect was opened for, in order, across both protocols. */
  attempts: [] as string[],
  /** How a connect to each key ends. Missing means it succeeds. */
  outcome: new Map<string, string>(),
  /** The reason the server gives when it refuses a key. */
  reason: new Map<string, string>(),
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

/** The error `wait_until_ready` in `conn.rs` rejects with, as the JSON it becomes. */
const REFUSED_CODE = JSON.stringify({
  code: "multiplayer.login.refused",
  params: {},
  fallback: "the server refused the login",
});

function sendDenial(key: string) {
  const channel = wire.channels.get(key);
  channel?.onmessage?.({
    kind: "delta",
    delta: { kind: "loginDenied", reason: wire.reason.get(key) ?? "" },
  });
  channel?.onmessage?.({
    kind: "disconnected",
    reason: "the server refused the login",
  });
}

async function open(args: { serverKey: string; onEvent: FakeChannel }) {
  const key = args.serverKey;
  wire.attempts.push(key);
  wire.channels.set(key, args.onEvent);
  switch (wire.outcome.get(key)) {
    case "events-then-reject":
      sendDenial(key);
      throw new Error("the server refused the login");
    case "events-then-resolve":
      sendDenial(key);
      return { connected: true };
    case "code-only":
      throw new Error(REFUSED_CODE);
    case "unreachable":
      throw new Error("unreachable");
    default:
      return { connected: true };
  }
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
import { MultiplayerProvider, useConnection, useMultiplayer } from "./store";

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
let bar: ReturnType<typeof useConnection>;

function Probe() {
  store = useMultiplayer();
  bar = useConnection(BAR_KEY);
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

function refuse(key: string, how: Outcome, reason?: string) {
  wire.outcome.set(key, how);
  if (reason != null) wire.reason.set(key, reason);
}

const refusals = () =>
  wire.notified.filter((n) => /refused the (password|login) for/.test(n.title));

beforeEach(() => {
  installSettingsStorage(memorySettingsStorage());
  wire.channels.clear();
  wire.attempts.length = 0;
  wire.outcome.clear();
  wire.reason.clear();
  wire.notified.length = 0;
  settings.accounts = { accounts: [] };
  settings.autoConnect = false;
});

afterEach(() => {
  cleanup();
  takeDrawerRequest();
  vi.useRealTimers();
});

describe("a login started from the popover, refused for its password", () => {
  it("raises a notification on a TASServer server", async () => {
    refuse(BAR_KEY, "events-then-reject", "Invalid username or password");
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
    expect(refusals()[0].body).toBe("Invalid username or password");
  });

  it("raises a notification on Zero-K", async () => {
    refuse(ZEROK_KEY, "events-then-reject", "invalid password");
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

  it("raises it when the denial arrives after the connect resolved, which is the real order", async () => {
    refuse(BAR_KEY, "later", "Invalid password");
    await mount();

    await act(async () => {
      await store.connect(BAR, "AF");
    });
    expect(bar?.live).toBe(true);
    expect(refusals()).toEqual([]);

    await act(async () => {
      sendDenial(BAR_KEY);
    });

    expect(refusals().map((n) => n.title)).toEqual([
      "Beyond All Reason refused the password for AF",
    ]);
    expect(bar?.live).toBe(false);
  });

  it("does not show the login as connected when the denial beat the connect back", async () => {
    refuse(BAR_KEY, "events-then-resolve", "Invalid password");
    await mount();

    await act(async () => {
      await expect(store.connect(BAR, "AF")).rejects.toBeInstanceOf(
        LoginRefusedError,
      );
    });

    expect(bar?.live).toBe(false);
    expect(refusals()).toHaveLength(1);
  });

  it("still raises it when the popover was closed before the refusal arrived", async () => {
    refuse(BAR_KEY, "later", "Invalid password");
    await mount();

    await act(async () => {
      store.openLoginPopover();
    });
    await act(async () => {
      await store.connect(BAR, "AF");
    });
    await act(async () => {
      store.closeLoginPopover();
    });
    await act(async () => {
      sendDenial(BAR_KEY);
    });

    expect(store.loginPopoverOpen).toBe(false);
    expect(refusals()).toHaveLength(1);
  });

  it("stays up until dismissed and offers one action to the login's password field", async () => {
    refuse(BAR_KEY, "events-then-reject", "Invalid password");
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
    refuse(BAR_KEY, "unreachable");
    await mount();

    await act(async () => {
      await expect(store.connect(BAR, "AF")).rejects.not.toBeInstanceOf(
        LoginRefusedError,
      );
    });

    expect(refusals()).toEqual([]);
  });
});

describe("a login refused for a reason that is not the password", () => {
  it("says so neutrally, with the server's words and no button", async () => {
    // uberserver's own text for a second login on one account.
    refuse(BAR_KEY, "events-then-reject", "Already logged in.");
    await mount();

    await act(async () => {
      await expect(store.connect(BAR, "AF")).rejects.toBeInstanceOf(
        LoginRefusedError,
      );
    });

    expect(refusals()).toHaveLength(1);
    expect(refusals()[0].title).toBe(
      "Beyond All Reason refused the login for AF",
    );
    expect(refusals()[0].body).toBe("Already logged in.");
    expect(refusals()[0].action).toBeUndefined();
    expect(refusals()[0].to).toBeUndefined();
  });

  it("does the same when the denial arrives after the connect resolved", async () => {
    refuse(ZEROK_KEY, "later", "banned, too many connection attempts");
    await mount();

    await act(async () => {
      await store.connect(ZEROK, "Tom");
    });
    await act(async () => {
      sendDenial(ZEROK_KEY);
    });

    expect(refusals().map((n) => n.title)).toEqual([
      "Zero-K refused the login for Tom",
    ]);
    expect(refusals()[0].action).toBeUndefined();
  });

  it("treats a connect rejected with the coded error and no denial as a refusal, neutrally", async () => {
    refuse(BAR_KEY, "code-only");
    await mount();

    await act(async () => {
      await expect(store.connect(BAR, "AF")).rejects.toBeInstanceOf(
        LoginRefusedError,
      );
    });

    expect(refusals().map((n) => n.title)).toEqual([
      "Beyond All Reason refused the login for AF",
    ]);
    expect(refusals()[0].body).toBeUndefined();
    expect(refusals()[0].action).toBeUndefined();
  });

  it("announces once when the denial event follows the coded rejection", async () => {
    refuse(BAR_KEY, "code-only");
    await mount();

    await act(async () => {
      await store.connect(BAR, "AF").catch(() => {});
    });
    wire.reason.set(BAR_KEY, "Invalid password");
    await act(async () => {
      sendDenial(BAR_KEY);
    });

    expect(refusals()).toHaveLength(1);
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
    refuse(BAR_KEY, "events-then-reject", "Invalid password");
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

  it("raises the refusal when the denial arrives after the connect resolved", async () => {
    refuse(BAR_KEY, "later", "Invalid password");
    await mount();
    expect(refusals()).toEqual([]);

    await act(async () => {
      sendDenial(BAR_KEY);
    });

    expect(refusals().map((n) => n.title)).toEqual([
      "Beyond All Reason refused the password for AF",
    ]);
  });

  it("keeps 'Couldn't connect' for a failure that is not a refusal", async () => {
    refuse(RECOIL_KEY, "unreachable");
    refuse(BAR_KEY, "events-then-reject", "Invalid password");
    await mount();

    expect(refusals()).toHaveLength(1);
    const unreachable = wire.notified.filter(
      (n) => n.title === "Couldn't connect to multiplayer",
    );
    expect(unreachable).toHaveLength(1);
    expect(unreachable[0].body).toContain("Zeta");
  });

  it("tries a refused password once", async () => {
    refuse(BAR_KEY, "events-then-reject", "Invalid password");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(wire.attempts.filter((k) => k === BAR_KEY)).toHaveLength(1);
  });
});

describe("a dropped connection", () => {
  /** Log in, reach ready, then drop the connection as a network blip would. */
  async function loginThenDrop(next: Outcome, reason?: string) {
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
    // What the next connect to the key does, set once the first has succeeded.
    refuse(BAR_KEY, next, reason);
    await act(async () => {
      wire.channels.get(BAR_KEY)?.onmessage?.({
        kind: "disconnected",
        reason: "connection reset",
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
  }

  it("is not retried once the server refuses the password it reconnects with", async () => {
    await loginThenDrop("events-then-reject", "Invalid password");

    // One reconnect, refused, and then nothing.
    expect(wire.attempts).toEqual([BAR_KEY, BAR_KEY]);
    expect(refusals().map((n) => n.title)).toEqual([
      "Beyond All Reason refused the password for AF",
    ]);
    expect(
      wire.notified.filter((n) => n.title === "Multiplayer login refused"),
    ).toEqual([]);
  });

  it("is not retried when the reconnect rejects with the coded error before any denial", async () => {
    await loginThenDrop("code-only");

    expect(wire.attempts).toEqual([BAR_KEY, BAR_KEY]);
    expect(refusals().map((n) => n.title)).toEqual([
      "Beyond All Reason refused the login for AF",
    ]);
    expect(refusals()[0].action).toBeUndefined();
  });

  it("is not retried when a late denial follows a reconnect that resolved", async () => {
    await loginThenDrop("later");
    await act(async () => {
      wire.reason.set(BAR_KEY, "Already logged in.");
      sendDenial(BAR_KEY);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(wire.attempts).toEqual([BAR_KEY, BAR_KEY]);
    expect(refusals().map((n) => n.title)).toEqual([
      "Beyond All Reason refused the login for AF",
    ]);
  });
});

describe("several logins", () => {
  it("names the one that was refused", async () => {
    refuse(ZEROK_KEY, "events-then-reject", "invalid password");
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
