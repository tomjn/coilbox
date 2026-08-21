import remarkGfm from "remark-gfm";
import type { HeadingIdPlugin } from "./markdownAnchors";
import { remarkHeadingIds } from "./markdownAnchors";

/**
 * GitHub Flavored Markdown for the three surfaces that render somebody else's
 * markdown: a game changelog, a mission briefing and a distribution's pages
 * (issue #1791).
 *
 * Plain `react-markdown` follows CommonMark, which has no autolinking, so a bare
 * URL is text. GitHub autolinks, and it writes the "Full Changelog" line it
 * appends to a generated release body as a bare URL, so the one link every
 * generated changelog carries used to lead nowhere. Text written for GitHub is
 * read here, so it should mean here what it meant there.
 *
 * Autolinking makes anchors out of text nobody wrote as a link, so a surface may
 * only turn this on once its `a` renderer refuses to let the webview follow a
 * link (see {@link ./MarkdownLink} and `../profile/CustomPage`). All three do.
 *
 * GFM also brings tables, strikethrough, task lists and footnotes. A footnote
 * reference is a `#` link, and so is the contents list at the top of a long
 * page, so {@link remarkHeadingIds} rides along here rather than as a list of
 * its own. It gives each heading the id such a link points at, and the `a`
 * renderers scroll to it (issue #1805).
 */
export const GFM_PLUGINS = gfmPlugins(remarkHeadingIds);

/**
 * The same plugins with somebody else's heading ids.
 *
 * A distribution page is rendered a segment at a time, so its headings are
 * numbered by a scope covering the whole page rather than by the plugin that
 * only sees one document (see {@link ./markdownAnchors#createHeadingScope}).
 * Every other surface renders in one pass and wants {@link GFM_PLUGINS}.
 */
export function gfmPlugins(headingIds: HeadingIdPlugin) {
  return [remarkGfm, headingIds];
}

/**
 * Typography for the elements only GFM can produce. Tailwind's reset leaves a
 * table with no borders and no padding, so an unstyled one reads as columns run
 * together. A task list keeps its checkbox and drops the bullet that would
 * otherwise sit beside it.
 */
export const GFM_PROSE_CLASSES = [
  "[&_table]:my-2 [&_table]:w-full [&_table]:text-left",
  "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:font-semibold",
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
  "[&_li:has(input)]:list-none [&_li_input]:mr-1.5 [&_li_input]:align-middle",
].join(" ");
