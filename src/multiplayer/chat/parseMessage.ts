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
  if (text === "") return [];
  return parseUrls(text);
}

function parseUrls(text: string): Inline[] {
  return text === "" ? [] : [{ type: "text", value: text }];
}
