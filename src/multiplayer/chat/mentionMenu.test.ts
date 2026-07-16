import { describe, expect, it } from "vitest";
import { applyMention, mentionMatches, mentionQuery } from "./mentionMenu";

describe("mentionQuery", () => {
  it("finds a query at the start of the input", () => {
    expect(mentionQuery("@bo", 3)).toEqual({ start: 0, query: "bo" });
  });

  it("finds a query after a space", () => {
    expect(mentionQuery("hey @bo", 7)).toEqual({ start: 4, query: "bo" });
  });

  it("reports an empty query for a bare @", () => {
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("keeps clan-tag characters in the query", () => {
    expect(mentionQuery("@[ABC]bo", 8)).toEqual({ start: 0, query: "[ABC]bo" });
  });

  it("ignores an email local part", () => {
    expect(mentionQuery("mail a@b", 8)).toBeNull();
  });

  it("ignores a plain word", () => {
    expect(mentionQuery("bob", 3)).toBeNull();
  });

  it("ignores an @ token the caret has moved past", () => {
    expect(mentionQuery("@bob hi", 7)).toBeNull();
  });

  it("uses the caret, not the end of the value", () => {
    expect(mentionQuery("@bo hi", 3)).toEqual({ start: 0, query: "bo" });
  });
});

describe("mentionMatches", () => {
  const names = ["alice", "Bob", "[ABC]bob", "bobby", "carol"];

  it("returns every candidate for an empty query", () => {
    expect(mentionMatches("", names)).toEqual([
      "[ABC]bob",
      "alice",
      "Bob",
      "bobby",
      "carol",
    ]);
  });

  it("ranks prefix matches above substring matches", () => {
    expect(mentionMatches("bo", names)).toEqual(["Bob", "bobby", "[ABC]bob"]);
  });

  it("matches case-insensitively", () => {
    expect(mentionMatches("BOB", names)).toEqual(["Bob", "bobby", "[ABC]bob"]);
  });

  it("returns nothing when no candidate matches", () => {
    expect(mentionMatches("zz", names)).toEqual([]);
  });
});

describe("applyMention", () => {
  it("replaces the query and appends a space", () => {
    expect(applyMention("hey @bo", 4, 7, "bobby")).toEqual({
      value: "hey @bobby ",
      cursor: 11,
    });
  });

  it("does not double a space that already follows the query", () => {
    expect(applyMention("@bo there", 0, 3, "bobby")).toEqual({
      value: "@bobby there",
      cursor: 6,
    });
  });
});
