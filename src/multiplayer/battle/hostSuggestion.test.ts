import { describe, expect, it } from "vitest";
import {
  hostSuggestionActionLabel,
  hostSuggestionText,
  matchHostSuggestion,
} from "./hostSuggestion";

describe("matchHostSuggestion", () => {
  it("recognises !balance", () => {
    expect(matchHostSuggestion("!balance")).toEqual({ kind: "balance" });
  });

  it("recognises !lock and !unlock", () => {
    expect(matchHostSuggestion("!lock")).toEqual({ kind: "lock" });
    expect(matchHostSuggestion("!unlock")).toEqual({ kind: "unlock" });
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(matchHostSuggestion("  !BALANCE  ")).toEqual({ kind: "balance" });
  });

  it("does not match !fixcolors or !ring, which have no founder-direct equivalent", () => {
    expect(matchHostSuggestion("!fixcolors")).toBeNull();
    expect(matchHostSuggestion("!ring")).toBeNull();
  });

  it("does not match a !balance line with anything else on it", () => {
    expect(matchHostSuggestion("!balance please")).toBeNull();
  });

  it("does not match ordinary chat", () => {
    expect(matchHostSuggestion("anyone want to balance teams?")).toBeNull();
  });
});

describe("hostSuggestionText", () => {
  it("describes each kind in a full sentence", () => {
    expect(hostSuggestionText("balance")).toBe("Asked to balance the teams.");
    expect(hostSuggestionText("lock")).toBe("Asked to lock the room.");
    expect(hostSuggestionText("unlock")).toBe("Asked to unlock the room.");
  });
});

describe("hostSuggestionActionLabel", () => {
  it("names the action for each kind", () => {
    expect(hostSuggestionActionLabel("balance")).toBe("balance the teams");
    expect(hostSuggestionActionLabel("lock")).toBe("lock the room");
    expect(hostSuggestionActionLabel("unlock")).toBe("unlock the room");
  });
});
