import { describe, expect, it } from "vitest";
import type {
  Battle,
  ChannelState,
  ChatMsg,
  LobbyState,
  User,
} from "../bindings";
import {
  battleBadgeCount,
  battleLive,
  chatBadgeCount,
  unreadNews,
} from "./unreadSummary";

const msg = (from: string, text: string): ChatMsg => ({
  channel: null,
  from,
  text,
  kind: "said",
  at: 1_718_300_000_000,
  id: null,
});

const channel = (name: string, messages: ChatMsg[]): ChannelState => ({
  name,
  topic: null,
  users: [],
  messages,
  founder: null,
  operators: [],
});

const user = (name: string, ingame: boolean): User =>
  ({
    name,
    status: { ingame, away: false, rank: 0, access: false, bot: false },
  }) as unknown as User;

const battle = (id: number, host: string, chan: string | null): Battle =>
  ({ id, host, channel: chan, title: "Room" }) as unknown as Battle;

interface StateParts {
  me?: string | null;
  channels?: ChannelState[];
  dms?: Record<string, ChatMsg[]>;
  battles?: Battle[];
  users?: User[];
  currentBattle?: number | null;
}

const stateWith = (p: StateParts): LobbyState =>
  ({
    myUsername: p.me ?? "me",
    channels: Object.fromEntries((p.channels ?? []).map((c) => [c.name, c])),
    dms: p.dms ?? {},
    battles: Object.fromEntries(
      (p.battles ?? []).map((b) => [String(b.id), b]),
    ),
    users: Object.fromEntries((p.users ?? []).map((u) => [u.name, u])),
    currentBattle: p.currentBattle ?? null,
  }) as unknown as LobbyState;

/** `unreadOf` matching the store: everything unseen unless listed in `seen`. */
const unreadOfWith =
  (seen: Record<string, number> = {}) =>
  (id: string, total: number) =>
    Math.max(0, total - (seen[id] ?? 0));

const hl = { words: [] as string[], ownEnabled: true };
const notIgnored = () => false;

describe("unreadNews", () => {
  it("counts unseen messages, excluding the user's own lines", () => {
    const msgs = [msg("bob", "hi"), msg("me", "hey"), msg("carol", "yo")];
    expect(unreadNews(msgs, 0, "me")).toBe(2);
  });

  it("counts only messages after the seen index", () => {
    const msgs = [msg("bob", "1"), msg("carol", "2"), msg("dave", "3")];
    expect(unreadNews(msgs, 2, "me")).toBe(1);
  });

  it("applies the predicate filter when given", () => {
    const msgs = [msg("bob", "metal here"), msg("carol", "nothing")];
    expect(unreadNews(msgs, 0, "me", (m) => m.text.includes("metal"))).toBe(1);
  });

  it("clamps a seen index past the end to zero unread", () => {
    expect(unreadNews([msg("bob", "1")], 5, "me")).toBe(0);
  });
});

describe("chatBadgeCount", () => {
  it("counts unread DMs but not general channel chatter", () => {
    const state = stateWith({
      dms: { bob: [msg("bob", "hey"), msg("bob", "you there?")] },
      channels: [channel("main", [msg("carol", "hello all")])],
    });
    expect(chatBadgeCount(state, unreadOfWith(), hl, notIgnored)).toBe(2);
  });

  it("counts channel messages only when they hit a highlight word", () => {
    const state = stateWith({
      channels: [
        channel("main", [msg("carol", "watch the metal"), msg("dave", "gg")]),
      ],
    });
    const cfg = { words: ["metal"], ownEnabled: true };
    expect(chatBadgeCount(state, unreadOfWith(), cfg, notIgnored)).toBe(1);
  });

  it("counts your own username as a highlight in channels", () => {
    const state = stateWith({
      me: "alice",
      channels: [channel("main", [msg("bob", "hi alice welcome")])],
    });
    expect(chatBadgeCount(state, unreadOfWith(), hl, notIgnored)).toBe(1);
  });

  it("excludes battle channels from the chat count", () => {
    const state = stateWith({
      me: "alice",
      channels: [channel("__battle__7", [msg("bob", "alice go")])],
    });
    expect(chatBadgeCount(state, unreadOfWith(), hl, notIgnored)).toBe(0);
  });

  it("skips DMs from ignored peers", () => {
    const state = stateWith({ dms: { troll: [msg("troll", "spam")] } });
    const isIgnored = (p: string) => p === "troll";
    expect(chatBadgeCount(state, unreadOfWith(), hl, isIgnored)).toBe(0);
  });

  it("respects the seen mark, dropping already-read DMs", () => {
    const state = stateWith({
      dms: { bob: [msg("bob", "1"), msg("bob", "2")] },
    });
    const seen = unreadOfWith({ "dm:bob": 2 });
    expect(chatBadgeCount(state, seen, hl, notIgnored)).toBe(0);
  });
});

describe("battleBadgeCount", () => {
  it("counts unread messages in the current battle's channel", () => {
    const state = stateWith({
      currentBattle: 7,
      battles: [battle(7, "host", "__battle__7")],
      channels: [channel("__battle__7", [msg("bob", "hi"), msg("me", "yo")])],
    });
    expect(battleBadgeCount(state, unreadOfWith())).toBe(1);
  });

  it("is zero when not in a battle", () => {
    expect(battleBadgeCount(stateWith({}), unreadOfWith())).toBe(0);
  });

  it("is zero when the battle channel has no bucket yet", () => {
    const state = stateWith({
      currentBattle: 7,
      battles: [battle(7, "host", "__battle__7")],
    });
    expect(battleBadgeCount(state, unreadOfWith())).toBe(0);
  });
});

describe("battleLive", () => {
  it("is true when the current battle's host is in-game", () => {
    const state = stateWith({
      currentBattle: 7,
      battles: [battle(7, "host", "__battle__7")],
      users: [user("host", true)],
    });
    expect(battleLive(state)).toBe(true);
  });

  it("is false when the host is not in-game", () => {
    const state = stateWith({
      currentBattle: 7,
      battles: [battle(7, "host", "__battle__7")],
      users: [user("host", false)],
    });
    expect(battleLive(state)).toBe(false);
  });

  it("is false when not in a battle", () => {
    expect(battleLive(stateWith({}))).toBe(false);
  });
});
