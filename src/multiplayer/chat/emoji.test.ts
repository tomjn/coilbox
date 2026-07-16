/**
 * These run against the real emojibase-data, so they're the check that we're
 * reading the dataset's actual shape - the pure tests in `emojiMenu.test.ts`
 * would pass just as happily against a wrong one.
 */

import { describe, expect, it } from "vitest";
import { EMOJI_GROUPS, emojiGroup, loadEmoji, shortcodeIndex } from "./emoji";
import { emojiMatches } from "./emojiMenu";

const entries = await loadEmoji();

describe("loadEmoji", () => {
  it("loads the dataset", () => {
    expect(entries.length).toBeGreaterThan(1000);
  });

  it("gives every entry a character and at least one shortcode", () => {
    for (const e of entries) {
      expect(e.unicode).not.toBe("");
      expect(e.shortcodes.length).toBeGreaterThan(0);
    }
  });

  it("keeps only the picker's groups", () => {
    const groups = new Set(EMOJI_GROUPS.map((g) => g.group));
    expect(new Set(entries.map((e) => e.group))).toEqual(groups);
  });

  it("caches the dataset rather than rebuilding it", async () => {
    expect(await loadEmoji()).toBe(entries);
  });
});

describe("shortcodeIndex", () => {
  const index = shortcodeIndex(entries);

  it("resolves the Slack shortcodes people actually type", () => {
    expect(index.get("tada")).toBe("🎉");
    expect(index.get("joy")).toBe("😂");
    // Emoji presentation, variation selector and all - what we insert should be
    // the character other clients expect to receive.
    expect(index.get("+1")).toBe("\u{1F44D}\u{FE0F}");
  });

  it("resolves an alias", () => {
    expect(index.get("hankey")).toBe(index.get("poop"));
  });

  it("has no entry for an unknown shortcode", () => {
    expect(index.get("definitely_not_an_emoji")).toBeUndefined();
  });
});

describe("emojiGroup", () => {
  it("fills every picker tab", () => {
    for (const { group, label } of EMOJI_GROUPS) {
      expect(emojiGroup(entries, group), label).not.toHaveLength(0);
    }
  });

  it("opens the smileys tab on the grinning face, as Unicode orders it", () => {
    expect(emojiGroup(entries, EMOJI_GROUPS[0].group)[0].unicode).toBe("😀");
  });
});

describe("emojiMatches against the real dataset", () => {
  it("puts the obvious match first", () => {
    expect(emojiMatches("smile", entries)[0].unicode).toBe("😄");
    expect(emojiMatches("tada", entries)[0].unicode).toBe("🎉");
  });
});
