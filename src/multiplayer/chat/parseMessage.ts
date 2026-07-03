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
  const codeRe = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(text)) !== null) {
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
  const urlRe = /https?:\/\/\S+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text)) !== null) {
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

/** Bold/italic pass (implemented in the next task). */
function parseEmphasis(text: string): Inline[] {
  return text === "" ? [] : [{ type: "text", value: text }];
}
