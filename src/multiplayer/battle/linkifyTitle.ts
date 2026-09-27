/**
 * Splits a battle title into plain text and `http`/`https` links (issue
 * #3195). Hosts often paste a download or rules link straight into the
 * title, e.g. `MC:L Testing (https://tinyurl.com/MCLpackage)`, and a player
 * currently has to copy it out by hand.
 *
 * Only `http:` and `https:` are recognised. A title is untrusted, user
 * supplied text, so a scheme like `javascript:` must never become a link.
 */

export interface TitlePart {
  text: string;
  /** The URL to open, or `undefined` for a plain text run. */
  url?: string;
}

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

/**
 * A URL run swallows trailing punctuation the regex has no way to know is
 * part of the surrounding sentence rather than the link, e.g. the closing
 * `)` in `(https://tinyurl.com/MCLpackage)`. Strip trailing punctuation, but
 * only a bracket that is not balanced by one earlier in the same match, so a
 * URL that genuinely ends in `)` (because it opened one) keeps it.
 */
function trimTrailingPunctuation(url: string): {
  url: string;
  trailing: string;
} {
  const closers: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let trailing = "";
  let rest = url;
  for (;;) {
    const last = rest[rest.length - 1];
    if (!last) break;
    const opener = closers[last];
    if (opener) {
      const opens = rest.split(opener).length - 1;
      const closes = rest.split(last).length - 1;
      if (closes > opens) {
        trailing = last + trailing;
        rest = rest.slice(0, -1);
        continue;
      }
      break;
    }
    if (".,!?;:'\"".includes(last)) {
      trailing = last + trailing;
      rest = rest.slice(0, -1);
      continue;
    }
    break;
  }
  return { url: rest, trailing };
}

/** Split `text` into an alternating run of plain text and linkable URLs. */
export function linkifyTitle(text: string): TitlePart[] {
  const parts: TitlePart[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(URL_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, index) });
    }
    const { url, trailing } = trimTrailingPunctuation(match[0]);
    if (url) {
      parts.push({ text: url, url });
    }
    if (trailing) {
      parts.push({ text: trailing });
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex) });
  }
  return parts;
}
