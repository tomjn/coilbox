import { describe, expect, it } from "vitest";
import type { ChannelState, ChatMsg, LobbyState } from "../bindings";
import {
  backfilledCounts,
  conversationCounts,
  conversationHref,
  convId,
  resolveConversationRequest,
} from "./conversation";

/** A live chat line: no history id. */
const live = (from: string, text: string): ChatMsg => ({
  channel: "main",
  from,
  text,
  kind: "said",
  at: 1_718_300_000_000,
  id: null,
});

/** A line replayed from the server's channel history. */
const history = (from: string, text: string, id: number): ChatMsg => ({
  channel: "main",
  from,
  text,
  kind: "said",
  at: 1_718_200_000_000,
  id,
});

const channel = (name: string, messages: ChatMsg[]): ChannelState => ({
  name,
  topic: null,
  users: [],
  messages,
  founder: null,
  operators: [],
});

const stateWith = (channels: ChannelState[]): LobbyState =>
  ({
    channels: Object.fromEntries(channels.map((c) => [c.name, c])),
    dms: {},
  }) as unknown as LobbyState;

describe("convId", () => {
  it("names a channel and a direct message by what they are", () => {
    expect(convId({ kind: "channel", name: "main" })).toBe("channel:main");
    expect(convId({ kind: "dm", peer: "bob" })).toBe("dm:bob");
  });

  // A battle used to have an id of its own, which nothing else wrote to: the
  // seen baseline, the backlog discount and the nav badge all key battle chat
  // by its channel. So a room's chat could never be marked read, and the badge
  // counted on while you sat there reading it.
  it("names a battle by the channel its chat actually lives in", () => {
    expect(convId({ kind: "battle", id: 42, channel: "__battle__42" })).toBe(
      "channel:__battle__42",
    );
  });

  it("agrees with the id the counts are keyed by", () => {
    const state = stateWith([channel("__battle__42", [live("bob", "hi")])]);
    const id = convId({ kind: "battle", id: 42, channel: "__battle__42" });
    expect(conversationCounts(state)[id]).toBe(1);
  });
});

describe("backfilledCounts", () => {
  it("counts only messages replayed from history", () => {
    const state = stateWith([
      channel("main", [
        history("bob", "old", 1),
        history("carol", "older", 2),
        live("dave", "new"),
      ]),
    ]);
    expect(backfilledCounts(state)).toEqual({ "channel:main": 2 });
  });

  it("counts a backlog that a live message landed in the middle of", () => {
    // The server answers GETCHANNELMESSAGES off its DB thread, so live chat can
    // interleave with the burst. Counting doesn't care where they land.
    const state = stateWith([
      channel("main", [
        history("bob", "old", 1),
        live("dave", "interrupts"),
        history("carol", "also old", 2),
      ]),
    ]);
    expect(backfilledCounts(state)).toEqual({ "channel:main": 2 });
  });

  it("omits channels with no history rather than reporting zero", () => {
    const state = stateWith([channel("main", [live("dave", "new")])]);
    expect(backfilledCounts(state)).toEqual({});
  });

  it("keys channels the way conversationCounts does, so marks line up", () => {
    const state = stateWith([channel("main", [history("bob", "old", 1)])]);
    expect(Object.keys(backfilledCounts(state))).toEqual(
      Object.keys(conversationCounts(state)),
    );
  });
});

describe("conversationHref", () => {
  it("addresses a channel by its name", () => {
    expect(conversationHref({ kind: "channel", name: "main" })).toBe(
      "/chat?channel=main",
    );
  });

  it("addresses a DM by its peer", () => {
    expect(conversationHref({ kind: "dm", peer: "bob" })).toBe("/chat?dm=bob");
  });

  // A battle has no address of its own to reuse, so this points at the same
  // channel `convId` keys its unread counters by.
  it("addresses a battle by its underlying channel", () => {
    expect(
      conversationHref({ kind: "battle", id: 42, channel: "__battle__42" }),
    ).toBe("/chat?channel=__battle__42");
  });
});

describe("resolveConversationRequest", () => {
  it("opens a channel that is in the snapshot", () => {
    const state = stateWith([channel("debriefing_1", [])]);
    const requested = { kind: "channel" as const, name: "debriefing_1" };
    expect(resolveConversationRequest(requested, state)).toEqual({
      ok: true,
      descriptor: requested,
    });
  });

  // Scope discipline for issue #2406: an address is not permission to join on
  // the reader's behalf, so a channel this session never joined is a clean
  // rejection rather than an autojoin.
  it("rejects a channel that is not in the snapshot", () => {
    const state = stateWith([channel("main", [])]);
    const result = resolveConversationRequest(
      { kind: "channel", name: "debriefing_1" },
      state,
    );
    expect(result).toEqual({
      ok: false,
      reason: "You have not joined debriefing_1.",
    });
  });

  it("waits for the mirror before judging a channel it hasn't loaded yet", () => {
    const result = resolveConversationRequest(
      { kind: "channel", name: "debriefing_1" },
      null,
    );
    expect(result).toBeNull();
  });

  // A DM has no "joined" state to check, so there is nothing to wait for.
  it("opens a DM without consulting state at all", () => {
    const requested = { kind: "dm" as const, peer: "bob" };
    expect(resolveConversationRequest(requested, null)).toEqual({
      ok: true,
      descriptor: requested,
    });
  });
});
