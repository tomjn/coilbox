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
  /** Keys `mp_disconnect` was called with, in call order. */
  disconnected: [] as string[],
  /** Arguments `mp_submit_recovery_code` was called with, in call order. */
  submitRecoveryCodeCalls: [] as { serverKey: string; code: string }[],
}));

// `vi.fn()` rather than a plain async function, so a test can make one send
// fail with `mockRejectedValueOnce` to prove the store cleans up its waiter
// rather than leaving it to block a retry or reject into nothing later.
const bindingMocks = vi.hoisted(() => ({
  changePassword: vi.fn(async () => ({ sent: true })),
  changeEmailRequest: vi.fn(async () => ({ sent: true })),
  changeEmail: vi.fn(async () => ({ sent: true })),
  resendVerification: vi.fn(async () => ({ sent: true })),
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
  mpDisconnect: async (args: { serverKey: string }) => {
    wire.disconnected.push(args.serverKey);
    return { disconnected: true };
  },
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
  mpRecoverPassword: async (args: {
    serverKey: string;
    onEvent: FakeChannel;
  }) => {
    wire.channels.set(args.serverKey, args.onEvent);
    return { connected: true };
  },
  mpSubmitRecoveryCode: async (args: { serverKey: string; code: string }) => {
    wire.submitRecoveryCodeCalls.push(args);
    return { sent: true };
  },
  mpChangePassword: bindingMocks.changePassword,
  mpChangeEmailRequest: bindingMocks.changeEmailRequest,
  mpChangeEmail: bindingMocks.changeEmail,
  mpResendVerification: bindingMocks.resendVerification,
  mpGetUserInfo: async () => ({ sent: true }),
  mpSetStatus: async () => ({}),
  mpTachyonSignedIn: async () => ({ signedIn: true }),
  mpTachyonSignIn: async () => ({}),
}));

vi.mock("../lobby-servers/bindings", () => ({
  lsGetCredential: async () => ({ secret: "hunter2" }),
}));

import {
  MultiplayerProvider,
  SERVER_REPLY_TIMEOUT_MS,
  useMultiplayer,
} from "./store";

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
const RECOVERY_EMAIL = "person@example.com";
const RECOVERY_KEY = `${RECOVERY_EMAIL}@server4.beyondallreason.info:8201`;

beforeEach(() => {
  wire.channels.clear();
  wire.disconnected.length = 0;
  wire.submitRecoveryCodeCalls.length = 0;
  bindingMocks.changePassword.mockClear();
  bindingMocks.changeEmailRequest.mockClear();
  bindingMocks.changeEmail.mockClear();
  bindingMocks.resendVerification.mockClear();
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

/**
 * The provider, mounted, with `recoverPassword` already parked at
 * `awaitRecoveryCode` on a throwaway connection to `RECOVERY_EMAIL`. Returns
 * the same `emit` shape as `renderProvider`, pushing events on the recovery
 * connection's channel rather than a logged-in one.
 */
async function renderRecovery() {
  const { result } = renderHook(() => useMultiplayer(), {
    wrapper: MultiplayerProvider,
  });
  await act(async () => {});
  let pending!: Promise<unknown>;
  // `recoverPassword` sets `busy` synchronously before its first await, so the
  // call itself needs to be inside `act`, but the returned promise is held
  // rather than awaited by it: it doesn't settle until the phase event below.
  act(() => {
    pending = result.current.recoverPassword(LOBBY, RECOVERY_EMAIL);
  });
  await act(async () => {});
  const channel = wire.channels.get(RECOVERY_KEY);
  if (!channel) throw new Error(`no channel for ${RECOVERY_KEY}`);
  await act(async () => {
    channel.onmessage?.({
      kind: "phase",
      phase: "awaitRecoveryCode",
      agreement: null,
    });
  });
  await expect(pending).resolves.toEqual({
    kind: "codeSent",
    serverKey: RECOVERY_KEY,
  });
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

  // CHANGEPASSWORD carries no token, so a single SERVERMSG resolves whichever
  // waiter is registered. Two pending calls would each register one and both
  // would be settled by the same message, so the second call has to be
  // refused outright rather than allowed to queue.
  it("rejects a second change password call while one is already in progress", async () => {
    const { result, emit } = await renderProvider();
    const first = result.current.changePassword("old", "new");
    await expect(
      result.current.changePassword("old", "different"),
    ).rejects.toThrow("A password change is already in progress.");

    await emit({
      kind: "delta",
      delta: {
        kind: "serverMessage",
        text: "Password changed successfully.",
        boxed: false,
      },
    });
    await expect(first).resolves.toEqual({
      message: "Password changed successfully.",
      succeeded: true,
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

  // uberserver allows three attempts at the recovery code and the login
  // machine stays parked in `AwaitRecoveryCode` on a wrong one, so
  // disconnecting on the first refusal would throw away two working
  // attempts. This is the one place this matters enough to prove directly:
  // a refusal must reject with the server's reason, must not disconnect, and
  // a second `submitRecoveryCode` call must still reach the binding rather
  // than fail with "Not awaiting a recovery code."
  it("leaves the connection open on a refused code so a retry still reaches the binding", async () => {
    const { result, emit } = await renderRecovery();

    let firstAttempt!: Promise<{ username: string }>;
    act(() => {
      firstAttempt = result.current.submitRecoveryCode(RECOVERY_KEY, "000000");
    });
    // Attach the rejection assertion before the delta that triggers the
    // reject, so the promise is never briefly unhandled between the two.
    const firstRejects = expect(firstAttempt).rejects.toThrow(
      "Wrong code entered too many times",
    );
    await emit({
      kind: "delta",
      delta: {
        kind: "recoveryDenied",
        reason: "Wrong code entered too many times",
      },
    });
    await firstRejects;
    expect(wire.disconnected).not.toContain(RECOVERY_KEY);

    let secondAttempt!: Promise<{ username: string }>;
    act(() => {
      secondAttempt = result.current.submitRecoveryCode(RECOVERY_KEY, "111111");
    });
    await act(async () => {});
    expect(wire.submitRecoveryCodeCalls).toContainEqual({
      serverKey: RECOVERY_KEY,
      code: "111111",
    });

    await emit({
      kind: "delta",
      delta: {
        kind: "passwordReset",
        email: RECOVERY_EMAIL,
        username: "AF",
      },
    });
    await expect(secondAttempt).resolves.toEqual({ username: "AF" });
    expect(wire.disconnected).toContain(RECOVERY_KEY);
  });

  it("cancelRecovery closes a connection a refused code left open", async () => {
    const { result, emit } = await renderRecovery();

    let attempt!: Promise<{ username: string }>;
    act(() => {
      attempt = result.current.submitRecoveryCode(RECOVERY_KEY, "000000");
    });
    const attemptRejects = expect(attempt).rejects.toThrow("Wrong code");
    await emit({
      kind: "delta",
      delta: { kind: "recoveryDenied", reason: "Wrong code" },
    });
    await attemptRejects;
    expect(wire.disconnected).not.toContain(RECOVERY_KEY);

    await act(async () => {
      await result.current.cancelRecovery(RECOVERY_KEY);
    });
    expect(wire.disconnected).toContain(RECOVERY_KEY);
  });
});

/**
 * `CHANGEEMAILREQUEST`, `CHANGEEMAIL` and `RESENDVERIFICATION` do have their
 * own accept/deny tokens, unlike `CHANGEPASSWORD` above. Before this, nothing
 * in `src/` read the five deltas those tokens landed as, so the store
 * resolved as soon as the command reached the wire and every one of these
 * three refusals read as a success in the interface.
 */
describe("change email and resend verification are paired against their own deltas", () => {
  it("resolves changeEmailRequest on changeEmailCodeSent", async () => {
    const { result, emit } = await renderProvider();
    const pending = result.current.changeEmailRequest("new@example.com");
    await emit({ kind: "delta", delta: { kind: "changeEmailCodeSent" } });
    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects changeEmailRequest with the server's reason on a refusal", async () => {
    const { result, emit } = await renderProvider();
    const pending = result.current.changeEmailRequest("new@example.com");
    const rejects = expect(pending).rejects.toThrow("already registered");
    await emit({
      kind: "delta",
      delta: { kind: "changeEmailDenied", reason: "already registered" },
    });
    await rejects;
  });

  it("resolves changeEmail on changeEmailAccepted", async () => {
    const { result, emit } = await renderProvider();
    const pending = result.current.changeEmail("new@example.com", "12345678");
    await emit({
      kind: "delta",
      delta: { kind: "changeEmailAccepted", email: "new@example.com" },
    });
    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects changeEmail with the server's reason on a wrong code", async () => {
    const { result, emit } = await renderProvider();
    const pending = result.current.changeEmail("new@example.com", "00000000");
    const rejects = expect(pending).rejects.toThrow("bad code");
    await emit({
      kind: "delta",
      delta: { kind: "changeEmailDenied", reason: "bad code" },
    });
    await rejects;
  });

  it("resolves resendVerification on resendVerificationAccepted", async () => {
    const { result, emit } = await renderProvider();
    const pending = result.current.resendVerification("alice@example.com");
    await emit({
      kind: "delta",
      delta: { kind: "resendVerificationAccepted" },
    });
    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects resendVerification with the server's reason on a refusal", async () => {
    const { result, emit } = await renderProvider();
    const pending = result.current.resendVerification("alice@example.com");
    const rejects = expect(pending).rejects.toThrow("verification is off");
    await emit({
      kind: "delta",
      delta: {
        kind: "resendVerificationDenied",
        reason: "verification is off",
      },
    });
    await rejects;
  });
});

/**
 * A command whose *send* fails never reaches the wire, so no reply is ever
 * coming for it. Before this, that path left the waiter and its timer live:
 * `changePassword` blocked every retry for `SERVER_REPLY_TIMEOUT_MS` behind a
 * false "already in progress", and the orphaned promise it never returned
 * rejected into nothing when its timer eventually fired.
 */
describe("a failed send cleans up its waiter rather than leaking it", () => {
  it("changePassword: a failed send does not block a retry with a false 'already in progress'", async () => {
    const { result, emit } = await renderProvider();
    bindingMocks.changePassword.mockRejectedValueOnce(
      new Error("not connected: AF_@server4.beyondallreason.info:8201"),
    );
    await expect(result.current.changePassword("old", "new")).rejects.toThrow(
      "not connected",
    );
    // A leaked waiter would make this call throw synchronously with "A
    // password change is already in progress." instead of reaching the
    // binding for a genuine second attempt.
    const retry = result.current.changePassword("old", "new2");
    await emit({
      kind: "delta",
      delta: {
        kind: "serverMessage",
        text: "Password changed successfully.",
        boxed: false,
      },
    });
    await expect(retry).resolves.toEqual({
      message: "Password changed successfully.",
      succeeded: true,
    });
    expect(bindingMocks.changePassword).toHaveBeenCalledTimes(2);
  });

  /**
   * The dispatch loop fires every registered waiter on a matching delta, not
   * just the first, so a second call's own waiter resolving correctly proves
   * nothing about whether the first call's waiter was also still there: both
   * would fire on the same delta either way. The only thing a leaked waiter
   * does that a cleaned-up one does not is sit registered for its deny kind
   * and reject its own orphaned promise, which nothing ever awaits, the
   * moment an unrelated delta of that kind arrives later. Nobody attaches a
   * handler to that promise, so Node reports it as an unhandled rejection,
   * caught here directly with a temporary listener rather than relied on to
   * surface through Vitest's own (approximate) attribution.
   */
  it("changeEmailRequest: a failed send removes its waiter, so a later unrelated delta settles nothing", async () => {
    const { result, emit } = await renderProvider();
    bindingMocks.changeEmailRequest.mockRejectedValueOnce(
      new Error("not connected"),
    );
    await expect(
      result.current.changeEmailRequest("new@example.com"),
    ).rejects.toThrow("not connected");

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);
    try {
      await emit({
        kind: "delta",
        delta: { kind: "changeEmailDenied", reason: "unrelated" },
      });
      // Node reports an unhandled rejection on a later tick than the one
      // that caused it, so give it one before checking.
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
    expect(unhandled).toEqual([]);
  });
});

describe("account delta waiters time out when the server never answers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects changeEmailRequest after SERVER_REPLY_TIMEOUT_MS with no reply", async () => {
    const { result } = await renderProvider();
    const pending = result.current.changeEmailRequest("new@example.com");
    const rejects = expect(pending).rejects.toThrow(
      "The server did not answer.",
    );
    await vi.advanceTimersByTimeAsync(SERVER_REPLY_TIMEOUT_MS);
    await rejects;
  });
});
