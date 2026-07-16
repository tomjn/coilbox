export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "codeblock"; value: string; lang?: string }
  | { type: "command"; value: string }
  | { type: "url"; value: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "quote"; children: Inline[] }
  | { type: "mention"; value: string };

/**
 * Parse a chat message into inline formatting tokens. Pure and React-free so it
 * can be unit-tested directly. Rule order: leading command, then fenced code,
 * then quotes, then inline code, then URLs, then bold/italic; anything unmatched
 * falls through as literal text.
 */
export function parseMessage(text: string): Inline[] {
  const cmd = /^!\w+/.exec(text);
  if (cmd) {
    return [
      { type: "command", value: cmd[0] },
      ...parseFences(text.slice(cmd[0].length)),
    ];
  }
  return parseFences(text);
}

/**
 * Fenced code blocks. Must run before everything else: the inline-code pass
 * would otherwise match from a fence's third backtick and emit a bogus code span
 * bracketed by stray literal backticks.
 *
 * Non-greedy, so consecutive fences don't swallow the prose between them. An
 * unterminated fence matches nothing and falls through as literal text, the same
 * as an unclosed inline backtick does. A fence inside a `>` quote is not a case
 * we handle: the quote pass runs below this one and never sees the fence.
 */
function parseFences(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(/```(\w*)\n?([\s\S]*?)```/g)) {
    if (m.index > last) out.push(...parseBlocks(text.slice(last, m.index)));
    out.push({
      type: "codeblock",
      // The newline before the closing fence is the fence's, not the code's -
      // keeping it would render a trailing blank line inside the block.
      value: m[2].replace(/\n$/, ""),
      ...(m[1] ? { lang: m[1] } : {}),
    });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...parseBlocks(text.slice(last)));
  return out;
}

/**
 * Block-level pass for `>` quotes. Consecutive quote lines fold into one quote
 * token; runs of ordinary lines are handed to inline parsing untouched. When no
 * line is a quote we short-circuit so plain messages keep their exact tokens.
 */
function parseBlocks(text: string): Inline[] {
  const marker = /^\s*>\s?/;
  const lines = text.split("\n");
  if (!lines.some((l) => marker.test(l))) return parseInline(text);

  const out: Inline[] = [];
  let buf: string[] = [];
  let quoting = false;
  const flush = () => {
    if (buf.length === 0) return;
    const body = buf.join("\n");
    if (quoting) out.push({ type: "quote", children: parseInline(body) });
    else out.push(...parseInline(body));
    buf = [];
  };
  for (const line of lines) {
    const m = marker.exec(line);
    const lineQuotes = m !== null;
    if (lineQuotes !== quoting) {
      flush();
      quoting = lineQuotes;
    }
    buf.push(m ? line.slice(m[0].length) : line);
  }
  flush();
  return out;
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
    if (m.index > last) out.push(...parseMentions(text.slice(last, m.index)));
    if (m[1] !== undefined) {
      out.push({ type: "bold", children: parseEmphasis(m[1]) });
    } else {
      out.push({ type: "italic", children: parseEmphasis(m[2] ?? m[3]) });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...parseMentions(text.slice(last)));
  return out;
}

/**
 * `@nick` mentions in a plain-text run. The lookbehind excludes a preceding
 * word char (so an email local part like `a@b` is not a mention) and a second
 * `@`. The nick charset covers lobby/IRC names including clan tags like [ABC].
 */
function parseMentions(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(?<![\w@])@([A-Za-z0-9_[\]{}|^\\-]+)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) {
      out.push({ type: "text", value: text.slice(last, m.index) });
    }
    out.push({ type: "mention", value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}
