const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

/**
 * Count the emoji in a message that is made up of ONLY emoji (plus whitespace),
 * returning 0 as soon as any non-emoji text appears. Grapheme segmentation keeps
 * multi-codepoint emoji (skin-tone and ZWJ sequences) as a single unit. Callers
 * gate on the count (e.g. enlarge only 1-3) - this just reports it.
 */
export function jumbojiCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let count = 0;
  for (const { segment } of segmenter.segment(trimmed)) {
    if (/^\s+$/.test(segment)) continue;
    if (!PICTOGRAPHIC.test(segment)) return 0;
    count++;
  }
  return count;
}
