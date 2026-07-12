import { describe, expect, it } from "vitest";
import type { ChannelState } from "./bindings";
import {
  canChannelModerate,
  chanServBan,
  chanServInfo,
  chanServKick,
  chanServMute,
  chanServSetOp,
  chanServTopic,
  modBan,
  modGetIp,
  modKick,
} from "./moderation";

const channel = (p: Partial<ChannelState> = {}): ChannelState => ({
  name: "lobby",
  topic: null,
  users: [],
  messages: [],
  founder: null,
  operators: [],
  ...p,
});

describe("ChanServ command builders", () => {
  it("targets ChanServ by private message with a colon-prefixed command", () => {
    expect(chanServInfo("lobby")).toBe("SAYPRIVATE ChanServ :info lobby");
    expect(chanServSetOp("lobby", "bob", true)).toBe(
      "SAYPRIVATE ChanServ :op lobby bob",
    );
    expect(chanServSetOp("lobby", "bob", false)).toBe(
      "SAYPRIVATE ChanServ :deop lobby bob",
    );
    expect(chanServKick("lobby", "bob")).toBe(
      "SAYPRIVATE ChanServ :kick lobby bob",
    );
    expect(chanServTopic("lobby", "hello world")).toBe(
      "SAYPRIVATE ChanServ :topic lobby hello world",
    );
  });

  it("includes duration + reason for timed actions, trimming an empty reason", () => {
    expect(chanServMute("lobby", "bob", "10m", "spamming")).toBe(
      "SAYPRIVATE ChanServ :mute lobby bob 10m spamming",
    );
    expect(chanServBan("lobby", "bob", "1d", "")).toBe(
      "SAYPRIVATE ChanServ :ban lobby bob 1d",
    );
  });
});

describe("moderator verb builders", () => {
  it("build first-class protocol lines", () => {
    expect(modGetIp("bob")).toBe("GETIP bob");
    expect(modKick("bob", "rude")).toBe("KICK bob rude");
    expect(modKick("bob", "")).toBe("KICK bob");
    expect(modBan("bob", "7d", "cheating")).toBe("BAN bob 7d cheating");
  });
});

describe("canChannelModerate", () => {
  it("lets any server moderator moderate", () => {
    expect(canChannelModerate(channel(), "me", true)).toBe(true);
    expect(canChannelModerate(undefined, "me", true)).toBe(true);
  });

  it("lets the founder and operators moderate", () => {
    expect(canChannelModerate(channel({ founder: "me" }), "me", false)).toBe(
      true,
    );
    expect(
      canChannelModerate(channel({ operators: ["me"] }), "me", false),
    ).toBe(true);
  });

  it("denies everyone else", () => {
    expect(canChannelModerate(channel({ founder: "alice" }), "me", false)).toBe(
      false,
    );
    expect(canChannelModerate(channel(), null, false)).toBe(false);
    expect(canChannelModerate(undefined, "me", false)).toBe(false);
  });
});
