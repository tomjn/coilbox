import { describe, expect, it } from "vitest";
import type { EmojiEntry } from "./emoji";
import {
  applyEmoji,
  closedShortcode,
  emojiMatches,
  emojiQuery,
  MAX_EMOJI_MATCHES,
} from "./emojiMenu";

const entry = (
  unicode: string,
  shortcodes: string[],
  order = 0,
): EmojiEntry => ({
  unicode,
  label: shortcodes[0],
  shortcodes,
  group: "smileys-emotion",
  order,
});

const ENTRIES = [
  entry("😄", ["smile"]),
  entry("😃", ["smiley"]),
  entry("😸", ["smile_cat"]),
  entry("😈", ["smiling_imp"]),
  entry("💩", ["poop", "hankey", "shit"]),
  entry("🎉", ["tada"]),
];

describe("emojiQuery", () => {
  it("finds a query at the start of the input", () => {
    expect(emojiQuery(":sm", 3)).toEqual({ start: 0, query: "sm" });
  });

  it("finds a query after a space", () => {
    expect(emojiQuery("hey :sm", 7)).toEqual({ start: 4, query: "sm" });
  });

  it("keeps shortcode punctuation in the query", () => {
    expect(emojiQuery(":smile_c", 8)).toEqual({ start: 0, query: "smile_c" });
    expect(emojiQuery(":+1", 3)).toEqual({ start: 0, query: "+1" });
  });

  it("stays closed until the query is long enough to search on", () => {
    expect(emojiQuery(":", 1)).toBeNull();
    expect(emojiQuery(":s", 2)).toBeNull();
    expect(emojiQuery(":sm", 3)).toEqual({ start: 0, query: "sm" });
  });

  it("ignores a colon inside a word", () => {
    expect(emojiQuery("note:sm", 7)).toBeNull();
  });

  it("ignores a time", () => {
    expect(emojiQuery("at 12:30", 8)).toBeNull();
  });

  it("ignores a URL scheme", () => {
    expect(emojiQuery("http://ex", 9)).toBeNull();
  });

  it("ignores a token the caret has moved past", () => {
    expect(emojiQuery(":smile hi", 9)).toBeNull();
  });
});

describe("emojiMatches", () => {
  it("puts the plainest prefix match first", () => {
    expect(emojiMatches("smi", ENTRIES).map((e) => e.unicode)).toEqual([
      "😄",
      "😃",
      "😸",
      "😈",
    ]);
  });

  it("matches an alias, not just the primary shortcode", () => {
    expect(emojiMatches("hank", ENTRIES).map((e) => e.unicode)).toEqual(["💩"]);
  });

  it("falls back to substring matches after prefix ones", () => {
    expect(emojiMatches("cat", ENTRIES).map((e) => e.unicode)).toEqual(["😸"]);
  });

  it("is case-insensitive", () => {
    expect(emojiMatches("TADA", ENTRIES).map((e) => e.unicode)).toEqual(["🎉"]);
  });

  it("returns nothing for an unknown query", () => {
    expect(emojiMatches("zzz", ENTRIES)).toEqual([]);
  });

  it("caps the menu", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      entry(`${i}`, [`smile${i}`]),
    );
    expect(emojiMatches("smile", many)).toHaveLength(MAX_EMOJI_MATCHES);
  });
});

describe("applyEmoji", () => {
  it("replaces the token with the emoji", () => {
    expect(applyEmoji("hey :sm", 4, 7, "😄")).toEqual({
      value: "hey 😄",
      cursor: 4 + "😄".length,
    });
  });

  it("keeps what follows the token", () => {
    expect(applyEmoji(":sm there", 0, 3, "😄")).toEqual({
      value: "😄 there",
      cursor: "😄".length,
    });
  });

  it("adds no trailing space, so emoji can be run together", () => {
    const first = applyEmoji(":tada", 0, 5, "🎉");
    expect(
      applyEmoji(first.value, first.cursor, first.cursor, "🎉").value,
    ).toBe("🎉🎉");
  });
});

describe("closedShortcode", () => {
  it("finds a shortcode the caret just closed", () => {
    expect(closedShortcode(":tada:", 6)).toEqual({ start: 0, name: "tada" });
  });

  it("finds one mid-sentence", () => {
    expect(closedShortcode("nice :tada:", 11)).toEqual({
      start: 5,
      name: "tada",
    });
  });

  it("ignores an opening colon", () => {
    expect(closedShortcode(":tada", 5)).toBeNull();
  });

  it("ignores an empty pair", () => {
    expect(closedShortcode("::", 2)).toBeNull();
  });

  it("ignores a time range", () => {
    expect(closedShortcode("12:30:", 6)).toBeNull();
  });

  it("ignores a caret that isn't after the closing colon", () => {
    expect(closedShortcode(":tada: hi", 9)).toBeNull();
  });
});
