export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "command"; value: string }
  | { type: "url"; value: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] };

/**
 * Parse a chat message into inline formatting tokens. Pure and React-free so it
 * can be unit-tested directly. Rule order: leading command, then inline code,
 * then URLs, then bold/italic; anything unmatched falls through as literal text.
 */
export function parseMessage(text: string): Inline[] {
  const cmd = /^!\w+/.exec(text);
  if (cmd) {
    return [
      { type: "command", value: cmd[0] },
      ...parseInline(text.slice(cmd[0].length)),
    ];
  }
  return parseInline(text);
}

/** Code spans first (literal), remaining runs handed to URL/emphasis parsing. */
function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    if (m.index > last) out.push(...parseUrls(text.slice(last, m.index)));
    out.push({ type: "code", value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...parseUrls(text.slice(last)));
  return out;
}

/** Extract bare http(s) URLs; remaining runs handed to bold/italic parsing. */
function parseUrls(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/\S+/g)) {
    if (m.index > last) out.push(...parseEmphasis(text.slice(last, m.index)));
    const url = m[0];
    const trail = /[.,!?)\]}:;]+$/.exec(url);
    out.push({
      type: "url",
      value: trail ? url.slice(0, -trail[0].length) : url,
    });
    if (trail) out.push({ type: "text", value: trail[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...parseEmphasis(text.slice(last)));
  return out;
}

/**
 * Bold (`**x**`) then italic (`*x*` / `_x_`). Content cannot span the same
 * marker, so an unmatched or lone marker simply falls through as literal text.
 * Matched content is parsed recursively to allow one level of nesting.
 */
function parseEmphasis(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) {
      out.push({ type: "text", value: text.slice(last, m.index) });
    }
    if (m[1] !== undefined) {
      out.push({ type: "bold", children: parseEmphasis(m[1]) });
    } else {
      out.push({ type: "italic", children: parseEmphasis(m[2] ?? m[3]) });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}
