import { describe, expect, it } from "vitest";
import type { ChatMsg, LobbyState } from "../bindings";
import { moderatorAnnouncements, parseAnnouncement } from "./moderatorFeed";

function msg(from: string, text: string, channel = "moderator"): ChatMsg {
  return { channel, from, text, kind: "said", at: 0, id: null };
}

function stateWithModerator(messages: ChatMsg[]): LobbyState {
  return {
    channels: {
      moderator: {
        name: "moderator",
        topic: null,
        users: [],
        messages,
        founder: null,
        operators: [],
      },
    },
  } as unknown as LobbyState;
}

describe("moderatorAnnouncements", () => {
  it("keeps only ChanServ's own lines from #moderator", () => {
    const state = stateWithModerator([
      msg("ChanServ", "Alice banned <Bob> for 7 days (spam)"),
      msg("Alice", "watch this one closely"),
      msg("ChanServ", "Alice unbanned <Bob>"),
    ]);
    const out = moderatorAnnouncements(state);
    expect(out.map((m) => m.text)).toEqual([
      "Alice banned <Bob> for 7 days (spam)",
      "Alice unbanned <Bob>",
    ]);
  });

  it("does not leak a second connection's #moderator into the first", () => {
    const stateA = stateWithModerator([
      msg("ChanServ", "Alice banned <Bob> for 7 days (spam)"),
    ]);
    const stateB = stateWithModerator([
      msg("ChanServ", "Carol banned <Dave> for 1 days (evasion)"),
    ]);
    expect(moderatorAnnouncements(stateA).map((m) => m.text)).toEqual([
      "Alice banned <Bob> for 7 days (spam)",
    ]);
    expect(moderatorAnnouncements(stateB).map((m) => m.text)).toEqual([
      "Carol banned <Dave> for 1 days (evasion)",
    ]);
  });

  it("returns nothing when #moderator has not been joined yet", () => {
    const state = { channels: {} } as unknown as LobbyState;
    expect(moderatorAnnouncements(state)).toEqual([]);
  });

  it("returns nothing for a null state", () => {
    expect(moderatorAnnouncements(null)).toEqual([]);
  });
});

describe("parseAnnouncement", () => {
  it("parses a BAN announcement", () => {
    expect(
      parseAnnouncement("Alice banned <Bob> for 7 days (spamming #main)"),
    ).toEqual({
      kind: "ban",
      actor: "Alice",
      target: "Bob",
      duration: "7",
      reason: "spamming #main",
    });
  });

  it("parses a BANSPECIFIC announcement", () => {
    expect(
      parseAnnouncement(
        "Alice banned-specific <203.0.113.7> for 3 days (ban evasion)",
      ),
    ).toEqual({
      kind: "banSpecific",
      actor: "Alice",
      target: "203.0.113.7",
      duration: "3",
      reason: "ban evasion",
    });
  });

  it("parses an UNBAN announcement", () => {
    expect(parseAnnouncement("Alice unbanned <Bob>")).toEqual({
      kind: "unban",
      actor: "Alice",
      target: "Bob",
    });
  });

  it("parses a BLACKLIST announcement", () => {
    expect(
      parseAnnouncement("Alice blacklisted 'spam.example' (throwaway signups)"),
    ).toEqual({
      kind: "blacklist",
      actor: "Alice",
      domain: "spam.example",
      reason: "throwaway signups",
    });
  });

  it("parses an UNBLACKLIST announcement", () => {
    expect(parseAnnouncement("Alice un-blacklisted 'spam.example'")).toEqual({
      kind: "unblacklist",
      actor: "Alice",
      domain: "spam.example",
    });
  });

  it("parses a CREATEBOTACCOUNT announcement with a from-client", () => {
    expect(
      parseAnnouncement(
        "New bot: <SpringieBot> created by <Alice> from <Alice_alt>",
      ),
    ).toEqual({
      kind: "newBot",
      target: "SpringieBot",
      actor: "Alice",
      from: "Alice_alt",
    });
  });

  it("parses a SETBOTMODE-on announcement (no from-client)", () => {
    expect(
      parseAnnouncement("New bot: <SpringieBot> created by <Alice>"),
    ).toEqual({
      kind: "newBot",
      target: "SpringieBot",
      actor: "Alice",
      from: null,
    });
  });

  it("parses a SETBOTMODE-off announcement", () => {
    expect(
      parseAnnouncement("User <SpringieBot> had botflag removed by <Alice>"),
    ).toEqual({
      kind: "botflagRemoved",
      target: "SpringieBot",
      actor: "Alice",
    });
  });

  it("parses a RELOAD announcement", () => {
    expect(parseAnnouncement("Reload initiated by <Alice>")).toEqual({
      kind: "reload",
      actor: "Alice",
    });
  });

  it("parses a CLEANUP announcement started by an admin", () => {
    expect(parseAnnouncement("Cleanup initiated by <Alice>")).toEqual({
      kind: "cleanup",
      actor: "Alice",
    });
  });

  it("falls back to unparsed for a line with no known shape", () => {
    expect(parseAnnouncement("New: Newbie 203.0.113.9 GB")).toEqual({
      kind: "unparsed",
      text: "New: Newbie 203.0.113.9 GB",
    });
  });

  it("falls back to unparsed for a system cleanup with no staff actor", () => {
    expect(parseAnnouncement("Cleanup initiated by server error")).toEqual({
      kind: "unparsed",
      text: "Cleanup initiated by server error",
    });
  });

  it("falls back to unparsed for an agreement-accepted line", () => {
    const text = "Agr: Newbie 203.0.113.9 abc123 def456 SpringLobby 0.270";
    expect(parseAnnouncement(text)).toEqual({ kind: "unparsed", text });
  });
});
