# Chat message formatting — design

Add lightweight inline formatting to multiplayer chat messages: autohost command highlighting, inline code, bold, italic, and URL auto-linking. No new dependencies; no block-level markdown.

## Goal

Messages currently render as a single raw `font-mono` span (`ChatPane.tsx:185-187`). Replace that with parsed, styled inline content while leaving the surrounding bubble/grouping logic untouched.

Supported inline rules:

1. **Autohost command** — a leading `!command` token.
2. **Inline code** — `` `code` ``.
3. **Bold** — `**text**`.
4. **Italic** — `*text*` or `_text_`.
5. **URL** — bare `http://` / `https://` links, opened in the system browser.

Explicitly out of scope (YAGNI): links other than http(s), lists, headings, blockquotes, strikethrough, code fences, images, tables, and any multi-line / block construct.

## Shape: pure parser + presentational renderer

Two units, so parsing is testable without React:

- **`src/multiplayer/chat/parseMessage.ts`** — pure `parseMessage(text): Inline[]`. No React import. Fully unit-tested.
- **`src/multiplayer/chat/FormattedText.tsx`** — maps `Inline[]` → styled `<span>`s / link. Replaces the raw `{m.text}` at `ChatPane.tsx:186`.

### Token model

```ts
export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }        // `code`
  | { type: "command"; value: string }     // leading !cmd only, incl. the "!"
  | { type: "url"; value: string }         // http(s) link
  | { type: "bold"; children: Inline[] }   // **x**
  | { type: "italic"; children: Inline[] }; // *x* or _x_
```

## Parsing rules & precedence

Applied in this order so each rule's scope is unambiguous:

1. **Leading command.** If `text` matches `^!\w+` (a `!` immediately followed by word chars at the very start of the message), that `!word` becomes a `command` token. Only the command token itself is highlighted; arguments and the rest of the line are parsed by the remaining rules as normal text. A `!` anywhere other than position 0 is plain text.
2. **Inline code.** Backtick spans are matched next and are **literal**: content between a matched pair of `` ` `` becomes a `code` token with no further parsing inside it (no bold/italic/url/command). Backticks split the text into code tokens and plain runs.
3. **URL.** Within each plain run, bare `https?://\S+` sequences become `url` tokens. Trailing sentence punctuation (`. , ! ? ) ] } : ;`) is trimmed off the match and left as following text so `see https://x.com.` links `x.com` not `x.com.`. URLs are literal — no bold/italic applied inside. (A URL inside `**...**` is an accepted edge case: the surrounding `**` render literally.)
4. **Bold then italic.** On the remaining plain text, match `**...**` first, then `*...*` / `_..._`. Inner content is parsed recursively (same parser, minus the leading-command rule), so one level of nesting like `**_x_**` falls out naturally.
5. **Unmatched markers pass through.** A lone `*`, `_`, `` ` ``, or an unclosed pair renders as literal text and never consumes the rest of the message.

## Rendering / styling (`FormattedText.tsx`)

- Body stays `font-mono` (unchanged decision).
- `text` → bare string.
- `command` → `text-primary font-medium`. On own (right-aligned) bubbles the text colour is already `text-primary-foreground`; verify the command still reads clearly there and fall back to `font-semibold underline` emphasis if the accent is illegible on that background.
- `code` → subtle chip: `rounded bg-foreground/10 px-1` so it separates from the already-mono body.
- `bold` → `font-semibold`; `italic` → `italic` (recurse into children).
- `url` → `<a href={value}>` styled `underline`, with `onClick={(e) => { e.preventDefault(); openUrl(value).catch(() => {}); }}` using `openUrl` from `@tauri-apps/plugin-opener` (matches `BrandingLinks.tsx:28`). Keeping the real `href` gives keyboard focus, hover-preview, and right-click copy.
- Output is React nodes only — no `dangerouslySetInnerHTML`, so no injection surface.

`FormattedText` takes `{ text: string }` and internally calls `parseMessage`. ChatPane passes the raw `m.text`; notices (join/leave/system) are left as plain text — formatting applies to regular chat messages only.

## Testing

`src/multiplayer/chat/parseMessage.test.ts` (Vitest, matching existing `src/multiplayer/**/*.test.ts`) covering:

- plain text → single `text` token
- leading `!start map` → `command` + text; arguments not highlighted
- mid-text `foo !bar` → **no** command token
- `` `a *b*` `` → `code` token with markers inside left literal
- `**bold**`, `*it*`, `_it_` → correct tokens, markers stripped
- nesting `**_x_**`
- URL trimming: `see https://x.com.` → text + `url(https://x.com)` + `text(".")`
- unclosed / lone markers pass through as literal text
- combined message exercising several rules at once

Renderer is presentational; covered by the parser tests plus manual smoke in `bun tauri dev`.

## Files touched

- new: `src/multiplayer/chat/parseMessage.ts`
- new: `src/multiplayer/chat/parseMessage.test.ts`
- new: `src/multiplayer/chat/FormattedText.tsx`
- edit: `src/multiplayer/chat/ChatPane.tsx` (swap raw `{m.text}` for `<FormattedText text={m.text} />`)
