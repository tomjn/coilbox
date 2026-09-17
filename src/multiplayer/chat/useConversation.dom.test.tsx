// @vitest-environment happy-dom

/**
 * A conversation is bound to one connection's own `serverKey` (issue #2843):
 * `#main` on server A and `#main` on server B are different rooms, so a
 * message typed into one has to reach only that server's `mp_say`, never the
 * other's, even though both connections hold a channel of the same name.
 */

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LobbyState } from "../bindings";
import { useConversation } from "./useConversation";

vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, vi.fn()],
}));

const sent: { serverKey: string; channel: string; message: string }[] = [];
vi.mock("../bindings", () => ({
  mpSay: async (args: {
    serverKey: string;
    channel: string;
    message: string;
  }) => {
    sent.push(args);
    return { sent: true };
  },
  mpSayBattle: async () => ({ sent: true }),
  mpSayBattleEx: async () => ({ sent: true }),
  mpSayEx: async () => ({ sent: true }),
  mpSayPrivate: async () => ({ sent: true }),
  mpSayPrivateEx: async () => ({ sent: true }),
}));

function stateWithChannel(serverKey: string): LobbyState {
  return {
    myUsername: serverKey.split("@")[0],
    channels: {
      main: {
        name: "main",
        topic: null,
        users: [],
        messages: [],
        founder: null,
        operators: [],
      },
    },
    dms: {},
    users: {},
    battles: {},
  } as unknown as LobbyState;
}

const KEY_A = "AF@bar.example:8200";
const KEY_B = "Zeta@techa.example:8200";

vi.mock("../store", () => ({
  useConnection: (serverKey: string | null) => {
    if (!serverKey) return null;
    return { mirror: { state: stateWithChannel(serverKey) } };
  },
  useProtocolServers: () => [],
}));

afterEach(() => {
  sent.length = 0;
});

describe("useConversation: send reaches only its own connection", () => {
  it("sends a channel message to the connection it was opened for", async () => {
    const { result } = renderHook(() =>
      useConversation({ kind: "channel", name: "main" }, KEY_A),
    );
    await result.current.send("hello");

    expect(sent).toEqual([
      { serverKey: KEY_A, channel: "main", message: "hello" },
    ]);
  });

  it("sends the same channel name on a different connection to that connection only", async () => {
    const { result } = renderHook(() =>
      useConversation({ kind: "channel", name: "main" }, KEY_B),
    );
    await result.current.send("hi there");

    expect(sent).toEqual([
      { serverKey: KEY_B, channel: "main", message: "hi there" },
    ]);
  });

  it("does nothing when no connection is given", async () => {
    const { result } = renderHook(() =>
      useConversation({ kind: "channel", name: "main" }, null),
    );
    await result.current.send("nobody hears this");

    expect(sent).toEqual([]);
  });
});
