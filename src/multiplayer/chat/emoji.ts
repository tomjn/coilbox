/**
 * The emoji dataset behind the composer's `:shortcode:` autocomplete and picker
 * (issue #283), from emojibase-data.
 *
 * Shortcodes come from the `iamcal` preset, which is the set Slack uses, so a
 * `:shrug:` typed here is the same `:shrug:` people know from every other chat
 * client. The data is ~600k of JSON and nothing needs it until the user reaches
 * for an emoji, so it loads on first use rather than at app start.
 */

import {
  GROUP_KEY_ACTIVITIES,
  GROUP_KEY_ANIMALS_NATURE,
  GROUP_KEY_FLAGS,
  GROUP_KEY_FOOD_DRINK,
  GROUP_KEY_OBJECTS,
  GROUP_KEY_PEOPLE_BODY,
  GROUP_KEY_SMILEYS_EMOTION,
  GROUP_KEY_SYMBOLS,
  GROUP_KEY_TRAVEL_PLACES,
  type GroupKey,
} from "emojibase";

/** One emoji as the composer needs it: what to insert, what to match on, and
 * where it sits in the picker. */
export interface EmojiEntry {
  /** The character to insert. */
  unicode: string;
  /** Human name, used as the accessible label / tooltip. */
  label: string;
  /** Shortcodes without their colons, primary first. */
  shortcodes: string[];
  group: GroupKey;
  /** Position within the group, as Unicode orders them. */
  order: number;
}

/**
 * The picker's tabs, in the order they're shown. Keyed by group name rather than
 * by the number the emoji data stores, because those numbers are not stable
 * across Unicode releases - the meta dataset that ships alongside the data is
 * what maps one to the other, and `build` resolves it there.
 *
 * Labels are hard-coded rather than pulled from emojibase's messages dataset:
 * that would be a fourth JSON to ship for nine strings, in a GUI with no
 * translations to feed them into. `icon` is the tab's glyph - nine text labels
 * don't fit the width of a popover, so each tab is shown as an emoji from the
 * group it opens (the label stays as its accessible name).
 */
export const EMOJI_GROUPS: { group: GroupKey; label: string; icon: string }[] =
  [
    { group: GROUP_KEY_SMILEYS_EMOTION, label: "Smileys", icon: "😀" },
    { group: GROUP_KEY_PEOPLE_BODY, label: "People", icon: "👋" },
    { group: GROUP_KEY_ANIMALS_NATURE, label: "Nature", icon: "🐻" },
    { group: GROUP_KEY_FOOD_DRINK, label: "Food", icon: "🍔" },
    { group: GROUP_KEY_TRAVEL_PLACES, label: "Travel", icon: "🚀" },
    { group: GROUP_KEY_ACTIVITIES, label: "Activities", icon: "⚽" },
    { group: GROUP_KEY_OBJECTS, label: "Objects", icon: "💡" },
    { group: GROUP_KEY_SYMBOLS, label: "Symbols", icon: "❤️" },
    { group: GROUP_KEY_FLAGS, label: "Flags", icon: "🏁" },
  ];

let pending: Promise<EmojiEntry[]> | null = null;

/** The dataset, loaded and shaped on first call and reused after. Concurrent
 * callers share the one in-flight load. */
export function loadEmoji(): Promise<EmojiEntry[]> {
  pending ??= build();
  return pending;
}

async function build(): Promise<EmojiEntry[]> {
  const [emojis, shortcodes, meta] = await Promise.all([
    import("emojibase-data/en/compact.json").then((m) => m.default),
    import("emojibase-data/en/shortcodes/iamcal.json").then((m) => m.default),
    import("emojibase-data/meta/groups.json").then((m) => m.default),
  ]);

  const shown = new Set<GroupKey>(EMOJI_GROUPS.map((g) => g.group));
  const entries: EmojiEntry[] = [];
  for (const emoji of emojis) {
    // Skip anything outside the nine display groups: `component` is skin-tone
    // and hair modifiers, which nobody sends on their own, and an undefined
    // group means uncategorized (the regional indicators flags are built from).
    if (emoji.group === undefined) continue;
    const group = meta.groups[String(emoji.group)];
    if (group === undefined || !shown.has(group)) continue;
    // No shortcode means nothing to type and nothing to match on. The picker
    // could still show it, but an emoji it can't name isn't worth the split.
    const codes = shortcodes[emoji.hexcode];
    if (!codes) continue;
    entries.push({
      unicode: emoji.unicode,
      label: emoji.label,
      shortcodes: typeof codes === "string" ? [codes] : codes,
      group,
      order: emoji.order ?? 0,
    });
  }
  return entries;
}

/** Shortcode (no colons) to emoji, for exact `:name:` substitution. The first
 * entry wins a collision, which the ordering of the dataset makes the more
 * common emoji. */
export function shortcodeIndex(entries: EmojiEntry[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of entries) {
    for (const code of entry.shortcodes) {
      if (!index.has(code)) index.set(code, entry.unicode);
    }
  }
  return index;
}

/** Entries of one picker group, in Unicode order. */
export function emojiGroup(
  entries: EmojiEntry[],
  group: GroupKey,
): EmojiEntry[] {
  return entries
    .filter((e) => e.group === group)
    .sort((a, b) => a.order - b.order);
}
