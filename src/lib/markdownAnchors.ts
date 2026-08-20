/**
 * In-page links for the surfaces that render somebody else's markdown (issue
 * #1805).
 *
 * A long page reads better with a contents list at the top, and `[Installing](#installing)`
 * is how markdown spells one. Two things stop that working here. Markdown gives a
 * heading no `id`, so there is nothing to point at. Coilbox reads the address bar
 * hash as its route, so letting the webview follow a `#` link moves the app off
 * the page the reader was on. {@link remarkHeadingIds} supplies the first and
 * {@link scrollToAnchor} replaces the second.
 *
 * GFM footnotes (issue #1791) are the same link written by the parser rather than
 * by the author: a `[^1]` reference is a link to the definition's `id`, and the
 * `↩` beside the definition is a link back. Those ids already exist, so they only
 * needed the click.
 */

/** As much of an mdast node as this file looks at. */
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hProperties?: Record<string, unknown> };
}

/**
 * Everything a heading id drops: punctuation, symbols and emoji. Letters and
 * digits survive whatever alphabet they are written in, as do `_` and `-`, and
 * whitespace survives long enough to become a dash.
 *
 * This is GitHub's rule, near enough that `## Installing the game` gives
 * `#installing-the-game` in both places, which is what an author who has written
 * a README before will expect.
 */
const NOT_IN_SLUG = /[^\p{L}\p{N}\s_-]/gu;

/** The id a heading with this text gets. */
export function headingSlug(text: string): string {
  return text.toLowerCase().trim().replace(NOT_IN_SLUG, "").replace(/\s/g, "-");
}

/** The text of a heading, code spans and all, with the formatting flattened out. */
function nodeText(node: MdastNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(nodeText).join("");
}

/**
 * Give every heading the `id` its text slugifies to, so a `#` link can find it.
 *
 * A second heading with the same text gets `-1`, then `-2`, which is what GitHub
 * does and means a link at least lands on one of them. A heading of nothing but
 * punctuation slugifies to an empty string and is left without an id.
 */
export function remarkHeadingIds() {
  return (tree: unknown) => {
    const used = new Set<string>();
    const visit = (node: MdastNode) => {
      if (node.type === "heading") {
        const base = headingSlug(nodeText(node));
        if (base) {
          let slug = base;
          for (let n = 1; used.has(slug); n++) slug = `${base}-${n}`;
          used.add(slug);
          node.data = {
            ...node.data,
            hProperties: { ...node.data?.hProperties, id: slug },
          };
        }
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree as MdastNode);
  };
}

/** The element a `#` href points at, or null when the page has no such id. */
function findAnchor(doc: Document, href: string): HTMLElement | null {
  const raw = href.slice(1);
  if (!raw) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A stray `%` is not an escape. Read the href as written instead.
    decoded = raw;
  }
  return doc.getElementById(decoded) ?? doc.getElementById(raw);
}

/**
 * Scroll to what a `#` link points at, in place of the navigation the webview
 * would otherwise do. Reports whether it found anything.
 *
 * `from` is the link that was clicked, and is only used to reach the document it
 * is in. `source` names the surface in the console warning, so an author who
 * wrote a link to a heading that is not there can tell which of their files it
 * came from.
 */
export function scrollToAnchor(
  href: string,
  from: Element,
  source: string,
): boolean {
  const doc = from.ownerDocument;
  const target = findAnchor(doc, href);
  if (!target) {
    console.warn(
      `${source}: ignored a link to "${href}", because nothing on this page has that id.`,
    );
    return false;
  }
  const reduced = doc.defaultView?.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  target.scrollIntoView({
    behavior: reduced ? "auto" : "smooth",
    block: "start",
  });
  // Keyboard focus moves with the reader, as it would have if the webview had
  // followed the link. A heading takes focus only once it is given a tabindex,
  // and `preventScroll` leaves the smooth scroll above to do the moving.
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  return true;
}
