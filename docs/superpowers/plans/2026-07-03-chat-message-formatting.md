# Chat Message Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render multiplayer chat messages with inline formatting — leading `!command` highlight, inline `` `code` ``, `**bold**`, `*italic*`/`_italic_`, and auto-linked `http(s)` URLs.

**Architecture:** A pure parser (`parseMessage`) turns a raw string into an `Inline[]` token tree; a presentational component (`FormattedText`) maps tokens to styled spans and an external-opening link. ChatPane swaps its raw `{m.text}` for `<FormattedText text={m.text} />`. No new dependencies.

**Tech Stack:** TypeScript, React, Vitest, Tailwind utility classes, `@tauri-apps/plugin-opener` (already used in `BrandingLinks.tsx`).

---

## File Structure

- **Create `src/multiplayer/chat/parseMessage.ts`** — pure parsing logic + `Inline` type. No React import.
- **Create `src/multiplayer/chat/parseMessage.test.ts`** — Vitest unit tests for the parser.
- **Create `src/multiplayer/chat/FormattedText.tsx`** — token → JSX renderer.
- **Modify `src/multiplayer/chat/ChatPane.tsx`** — import and use `FormattedText` in the message bubble (currently `ChatPane.tsx:185-187`).

## Parsing rules (reference)

Order of application (each layer hands leftover plain text to the next):

1. **Leading command** — `^!\w+` at position 0 only → `command` token; remainder parsed normally.
2. **Inline code** — `` `([^`]+)` `` → literal `code` token (no inner parsing).
3. **URL** — `https?://\S+` → `url` token; trailing `.,!?)]}:;` trimmed off into following text.
4. **Bold then italic** — `**x**`, then `*x*` / `_x_`; inner content recursively parsed (nesting like `**_x_**`).
5. **Unmatched markers** pass through as literal text.

---

### Task 1: Parser types + leading command + plain text

**Files:**
- Create: `src/multiplayer/chat/parseMessage.ts`
- Test: `src/multiplayer/chat/parseMessage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/multiplayer/chat/parseMessage.test.ts
import { describe, expect, it } from "vitest";
import { parseMessage } from "./parseMessage";

describe("parseMessage", () => {
  it("returns a single text token for plain text", () => {
    expect(parseMessage("hello world")).toEqual([
      { type: "text", value: "hello world" },
    ]);
  });

  it("highlights only a leading command token", () => {
    expect(parseMessage("!start now")).toEqual([
      { type: "command", value: "!start" },
      { type: "text", value: " now" },
    ]);
  });

  it("does not treat a mid-text ! as a command", () => {
    expect(parseMessage("no way !nope")).toEqual([
      { type: "text", value: "no way !nope" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/multiplayer/chat/parseMessage.test.ts`
Expected: FAIL — cannot find module `./parseMessage`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/multiplayer/chat/parseMessage.ts
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

/** Code spans first (literal), remaining runs handed to emphasis/URL parsing. */
function parseInline(text: string): Inline[] {
  if (text === "") return [];
  return parseUrls(text);
}

function parseUrls(text: string): Inline[] {
  return text === "" ? [] : [{ type: "text", value: text }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/multiplayer/chat/parseMessage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/multiplayer/chat/parseMessage.ts src/multiplayer/chat/parseMessage.test.ts
git commit -m "feat(multiplayer): parse leading autohost command in chat text"
```

---

### Task 2: Inline code spans

**Files:**
- Modify: `src/multiplayer/chat/parseMessage.ts`
- Test: `src/multiplayer/chat/parseMessage.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the `describe`)

```ts
  it("parses inline code and ignores markers inside it", () => {
    expect(parseMessage("run `!foo *bar*` please")).toEqual([
      { type: "text", value: "run " },
      { type: "code", value: "!foo *bar*" },
      { type: "text", value: " please" },
    ]);
  });

  it("leaves an unclosed backtick as literal text", () => {
    expect(parseMessage("a ` b")).toEqual([{ type: "text", value: "a ` b" }]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/multiplayer/chat/parseMessage.test.ts`
Expected: FAIL — code not split out; whole string returned as one text token.

- [ ] **Step 3: Update `parseInline` to split code spans first**

Replace the `parseInline` function body:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/multiplayer/chat/parseMessage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/multiplayer/chat/parseMessage.ts src/multiplayer/chat/parseMessage.test.ts
git commit -m "feat(multiplayer): parse inline code spans in chat text"
```

---

### Task 3: URL auto-linking with trailing-punctuation trim

**Files:**
- Modify: `src/multiplayer/chat/parseMessage.ts`
- Test: `src/multiplayer/chat/parseMessage.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the `describe`)

```ts
  it("auto-links a bare URL", () => {
    expect(parseMessage("see https://example.com yo")).toEqual([
      { type: "text", value: "see " },
      { type: "url", value: "https://example.com" },
      { type: "text", value: " yo" },
    ]);
  });

  it("trims trailing sentence punctuation off a URL", () => {
    expect(parseMessage("go https://example.com.")).toEqual([
      { type: "text", value: "go " },
      { type: "url", value: "https://example.com" },
      { type: "text", value: "." },
    ]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/multiplayer/chat/parseMessage.test.ts`
Expected: FAIL — URLs still returned as plain text.

- [ ] **Step 3: Replace the stub `parseUrls` with the real implementation**

```ts
/** Extract bare http(s) URLs; remaining runs handed to bold/italic parsing. */
function parseUrls(text: string): Inline[] {
  const out: Inline[] = [];
  const urlRe = /https?:\/\/\S+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text)) !== null) {
    if (m.index > last) out.push(...parseEmphasis(text.slice(last, m.index)));
    let url = m[0];
    const trail = /[.,!?)\]}:;]+$/.exec(url);
    out.push({ type: "url", value: trail ? url.slice(0, -trail[0].length) : url });
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/multiplayer/chat/parseMessage.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/multiplayer/chat/parseMessage.ts src/multiplayer/chat/parseMessage.test.ts
git commit -m "feat(multiplayer): auto-link URLs in chat text"
```

---

### Task 4: Bold and italic (with nesting)

**Files:**
- Modify: `src/multiplayer/chat/parseMessage.ts`
- Test: `src/multiplayer/chat/parseMessage.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the `describe`)

```ts
  it("parses bold and both italic markers, stripping the markers", () => {
    expect(parseMessage("a **b** c *d* e _f_")).toEqual([
      { type: "text", value: "a " },
      { type: "bold", children: [{ type: "text", value: "b" }] },
      { type: "text", value: " c " },
      { type: "italic", children: [{ type: "text", value: "d" }] },
      { type: "text", value: " e " },
      { type: "italic", children: [{ type: "text", value: "f" }] },
    ]);
  });

  it("nests italic inside bold", () => {
    expect(parseMessage("**_x_**")).toEqual([
      {
        type: "bold",
        children: [{ type: "italic", children: [{ type: "text", value: "x" }] }],
      },
    ]);
  });

  it("leaves a lone asterisk as literal text", () => {
    expect(parseMessage("2 * 3")).toEqual([{ type: "text", value: "2 * 3" }]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/multiplayer/chat/parseMessage.test.ts`
Expected: FAIL — emphasis not parsed; bold/italic returned as literal text.

- [ ] **Step 3: Replace the stub `parseEmphasis` with the real implementation**

```ts
/**
 * Bold (`**x**`) then italic (`*x*` / `_x_`). Content cannot span the same
 * marker, so an unmatched or lone marker simply falls through as literal text.
 * Matched content is parsed recursively to allow one level of nesting.
 */
function parseEmphasis(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/multiplayer/chat/parseMessage.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/multiplayer/chat/parseMessage.ts src/multiplayer/chat/parseMessage.test.ts
git commit -m "feat(multiplayer): parse bold and italic in chat text"
```

---

### Task 5: FormattedText renderer

**Files:**
- Create: `src/multiplayer/chat/FormattedText.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/multiplayer/chat/FormattedText.tsx
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";
import { type Inline, parseMessage } from "./parseMessage";

/**
 * Render a chat message string with inline formatting: leading autohost command,
 * inline code, bold, italic, and auto-linked URLs. Output is React nodes only -
 * no HTML injection. The command chip inherits its text colour (rather than
 * forcing an accent) so it stays legible on both the muted and primary bubbles.
 */
export function FormattedText({ text }: { text: string }) {
  return <>{render(parseMessage(text))}</>;
}

function render(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return <span key={i}>{n.value}</span>;
      case "code":
        return (
          <code key={i} className="rounded bg-foreground/10 px-1">
            {n.value}
          </code>
        );
      case "command":
        return (
          <span key={i} className="rounded bg-primary/20 px-1 font-medium">
            {n.value}
          </span>
        );
      case "url":
        return (
          <a
            key={i}
            href={n.value}
            className="underline"
            onClick={(e) => {
              e.preventDefault();
              openUrl(n.value).catch(() => {});
            }}
          >
            {n.value}
          </a>
        );
      case "bold":
        return (
          <strong key={i} className="font-semibold">
            {render(n.children)}
          </strong>
        );
      case "italic":
        return (
          <em key={i} className="italic">
            {render(n.children)}
          </em>
        );
    }
  });
}
```

- [ ] **Step 2: Typecheck the new component**

Run: `bun run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/multiplayer/chat/FormattedText.tsx
git commit -m "feat(multiplayer): FormattedText renderer for chat inline formatting"
```

---

### Task 6: Wire FormattedText into ChatPane

**Files:**
- Modify: `src/multiplayer/chat/ChatPane.tsx` (import + message bubble at `ChatPane.tsx:185-187`)

- [ ] **Step 1: Add the import**

At the top of `ChatPane.tsx`, after the existing `import type { ChatMsg } from "../bindings";` line, add:

```tsx
import { FormattedText } from "./FormattedText";
```

- [ ] **Step 2: Replace the raw message text**

Find (around `ChatPane.tsx:185-187`):

```tsx
                    <span className="whitespace-pre-wrap break-words font-mono">
                      {m.text}
                    </span>
```

Replace with:

```tsx
                    <span className="whitespace-pre-wrap break-words font-mono">
                      <FormattedText text={m.text} />
                    </span>
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Full parser test run**

Run: `bunx vitest run src/multiplayer/chat/parseMessage.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/multiplayer/chat/ChatPane.tsx
git commit -m "feat(multiplayer): render chat messages with inline formatting"
```

---

### Task 7: Lint gate + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the frontend lint suite CI runs**

Run: `bunx biome ci .`
Expected: PASS. If Biome flags the `switch` with no `default` in `render`, add a `default: return null;` case and re-run.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual smoke in the app**

Run: `bun tauri dev`
In a chat/DM, send messages exercising each rule and confirm rendering:
- `!help now` → `!help` highlighted (as a tinted chip), ` now` plain — on BOTH your own (right) bubble and someone else's (left) bubble the chip text stays readable.
- `use `+"`code`"+` here` → `code` shows as a chip.
- `**bold** and *italic* and _also_` → weights/slant applied, markers gone.
- `visit https://recoil-engine.org.` → link is clickable, opens the system browser, and the trailing `.` is outside the link.

Report what you observed (the command-on-own-bubble contrast is the item to watch).

- [ ] **Step 4: Commit (only if Step 1 required a `default` case)**

```bash
git add src/multiplayer/chat/FormattedText.tsx
git commit -m "chore(multiplayer): satisfy biome switch-default in FormattedText"
```

---

## Self-Review notes

- **Spec coverage:** command (Task 1), code (Task 2), URL + trim (Task 3), bold/italic + nesting (Task 4), rendering incl. `openUrl` (Task 5), integration (Task 6), lint/typecheck/smoke (Task 7). All five inline rules covered.
- **Deviation from spec (intentional):** the command token is rendered as a primary-*tinted chip that inherits text colour*, not `text-primary`. This resolves the spec's flagged own-bubble contrast risk without threading an `own` prop into `FormattedText`. Code chip uses `bg-foreground/10`; command chip uses `bg-primary/20` for differentiation.
- **Type consistency:** `Inline` union defined once in Task 1; `parseInline`/`parseUrls`/`parseEmphasis` names are stable across Tasks 1-4 (each task replaces a stub with the same signature `(text: string) => Inline[]`).
