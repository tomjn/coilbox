import { describe, expect, it } from "vitest";
import type { ChannelState, ChatMsg, LobbyState } from "../bindings";
import { backfilledCounts, conversationCounts } from "./conversation";

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
