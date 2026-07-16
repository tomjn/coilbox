/**
 * emojibase-data ships no types, and letting `resolveJsonModule` infer them
 * means TypeScript parses a 571k JSON literal on every check. Declaring the two
 * files we import gives them emojibase's own types for free instead.
 */

declare module "emojibase-data/en/compact.json" {
  import type { CompactEmoji } from "emojibase";

  const data: CompactEmoji[];
  export default data;
}

declare module "emojibase-data/en/shortcodes/iamcal.json" {
  import type { ShortcodesDataset } from "emojibase";

  const data: ShortcodesDataset;
  export default data;
}

declare module "emojibase-data/meta/groups.json" {
  import type { GroupKey } from "emojibase";

  const data: {
    /** Group number (as it appears in the emoji data) to group key. */
    groups: Record<string, GroupKey>;
  };
  export default data;
}
