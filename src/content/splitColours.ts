import type { SplitBucket } from "./replayOpening";

/**
 * The kinds' colours: the first four slots of the data visualisation palette
 * in their fixed order, each mode's own steps, checked with its validator for
 * colour blind separation and contrast on that mode's surface. Unclassified is
 * the palette's muted grey, since it is the absence of a kind.
 */
export const SPLIT_COLOURS: Record<
  "light" | "dark",
  Record<SplitBucket, string>
> = {
  light: {
    economy: "#2a78d6",
    defence: "#eb6834",
    offence: "#1baf7a",
    other: "#eda100",
    unclassified: "#898781",
  },
  dark: {
    economy: "#3987e5",
    defence: "#d95926",
    offence: "#199e70",
    other: "#c98500",
    unclassified: "#898781",
  },
};
