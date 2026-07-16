export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "codeblock"; value: string; lang?: string }
  | { type: "command"; value: string }
  | { type: "url"; value: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "strike"; children: Inline[] }
  | { type: "quote"; children: Inline[] }
  | { type: "list"; items: Inline[][] }
  | { type: "mention"; value: string };

/**
 * Parse a chat message into inline formatting tokens. Pure and React-free so it
 * can be unit-tested directly. Rule order: leading command, then fenced code,
 * then quotes and lists, then inline code, then URLs, then emphasis; anything
 * unmatched falls through as literal text.
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

/** A quoted line. The space after the marker is optional. */
const QUOTE = /^\s*>\s?/;

/**
 * A bullet. The space after the dash is required, so a negative number or an
 * em-dash-ish `-foo` isn't a bullet, and leading indent is allowed so ` - item`
 * is one.
 */
const BULLET = /^\s*-\s+/;

type LineKind = "quote" | "bullet" | "text";

function classify(line: string): LineKind {
  // Quote first: `> - x` is a quote of a dash, not a list inside a quote. Lists
  // don't nest in quotes here, the same way fences don't.
  if (QUOTE.test(line)) return "quote";
  if (BULLET.test(line)) return "bullet";
  return "text";
}

/**
 * A `- ` line with no bullet above or below it is a dash, not a list: people
 * start a line with one all the time ("- yeah, that"). Two in a row is
 * deliberate enough to render as a list.
 */
function demoteLoneBullets(kinds: LineKind[]): void {
  for (const [i, kind] of kinds.entries()) {
    if (kind !== "bullet") continue;
    // Safe against a neighbour this loop already demoted: that could only have
    // happened if this line weren't a bullet.
    if (kinds[i - 1] !== "bullet" && kinds[i + 1] !== "bullet") {
      kinds[i] = "text";
    }
  }
}

/**
 * Block-level pass for `>` quotes and `-` lists. Consecutive lines of a kind
 * fold into one token; runs of ordinary lines are handed to inline parsing
 * untouched. When no line is either we short-circuit so plain messages keep
 * their exact tokens.
 */
function parseBlocks(text: string): Inline[] {
  const lines = text.split("\n");
  const kinds = lines.map(classify);
  demoteLoneBullets(kinds);
  if (kinds.every((k) => k === "text")) return parseInline(text);

  const out: Inline[] = [];
  for (let i = 0; i < lines.length; ) {
    const kind = kinds[i];
    let end = i;
    while (end < lines.length && kinds[end] === kind) end++;
    const run = lines.slice(i, end);

    if (kind === "quote") {
      out.push({
        type: "quote",
        children: parseInline(run.map((l) => l.replace(QUOTE, "")).join("\n")),
      });
    } else if (kind === "bullet") {
      out.push({
        type: "list",
        items: run.map((l) => parseInline(l.replace(BULLET, ""))),
      });
    } else {
      out.push(...parseInline(run.join("\n")));
    }
    i = end;
  }
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
 * Bold (`**x**`), strikethrough (`~~x~~` / `~x~`) then italic (`*x*` / `_x_`).
 * Content cannot span the same marker, so an unmatched or lone marker simply
 * falls through as literal text. Matched content is parsed recursively to allow
 * one level of nesting.
 *
 * Both strike markers are accepted because both are in the wild - `~~x~~` is
 * Discord and GitHub, `~x~` is Slack - and italic already takes either of its
 * two. The doubled form has to be tried first or it would match as an empty
 * `~x~` bracketed by stray tildes.
 */
function parseEmphasis(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|~~([^~]+)~~|~([^~]+)~|\*([^*]+)\*|_([^_]+)_/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(...parseMentions(text.slice(last, m.index)));
    if (m[1] !== undefined) {
      out.push({ type: "bold", children: parseEmphasis(m[1]) });
    } else if (m[2] !== undefined || m[3] !== undefined) {
      out.push({ type: "strike", children: parseEmphasis(m[2] ?? m[3]) });
    } else {
      out.push({ type: "italic", children: parseEmphasis(m[4] ?? m[5]) });
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
