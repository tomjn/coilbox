/**
 * Syntax colouring for the mission Lua code view (issue #2282), via shiki -
 * already a dependency, already lazy-loaded the same way by the archive
 * browser's `FilePreview.tsx`. That file calls shiki's `codeToHtml` and drops
 * the result straight into `dangerouslySetInnerHTML`, but this view cannot do
 * that, because the same text also needs a line-number gutter and find's
 * highlighted matches layered onto it, and rewriting shiki's own HTML to add
 * either would be liable to break the other. `codeToTokens` is called
 * instead, which hands back shiki's per-line, per-token colours as plain
 * data, so `MissionLuaCode` can compose a line's colours and its find
 * matches itself, one token/match segment at a time.
 */

import { useEffect, useState } from "react";
import type { ThemedToken } from "shiki";

/** One line's tokens, in order. Concatenating their `content` strings
 *  reconstructs that line's text. */
export type LuaTokenLine = ThemedToken[];

const LANG = "lua";
const THEME = "github-dark";

/**
 * How long to wait, after the compiled Lua stops changing, before asking
 * shiki to re-tokenize it. Measured with shiki 4.3's default (oniguruma)
 * engine against synthetic Lua: retokenizing costs roughly 130ms at 2,000
 * lines and 390ms at 10,000 (Node, not this project's actual webview, since
 * there was no running app to measure it in from this worktree). Re-running
 * that on every keystroke-level scenario edit while this drawer happens to
 * be open would make editing elsewhere in the app janky, so this waits for
 * edits to settle. Line numbers and find do not wait on it: both work from
 * the plain text immediately, colour is a later, optional layer.
 */
export const RETOKENIZE_DEBOUNCE_MS = 200;

/**
 * Tokenizes `code` as Lua, returning one token array per entry of `lines`.
 *
 * Null while unavailable: before the first result lands, while a debounced
 * retokenize is pending after `code` changed, or if shiki fails to load or
 * returns a different number of lines than `lines` has (a mismatch is
 * treated as untrustworthy rather than risk pairing a line's text with
 * another line's colours). The caller falls back to plain text either way.
 */
export function useLuaTokens(
  code: string,
  lines: string[],
): LuaTokenLine[] | null {
  const [tokens, setTokens] = useState<LuaTokenLine[] | null>(null);

  useEffect(() => {
    // The previous result was tokenized from a different `code`, so its
    // colours no longer pair with `lines` and must not be shown against it.
    setTokens(null);
    let cancelled = false;
    const timer = setTimeout(() => {
      import("shiki")
        .then(({ codeToTokens }) =>
          codeToTokens(code, { lang: LANG, theme: THEME }),
        )
        .then(({ tokens: result }) => {
          if (cancelled) return;
          setTokens(result.length === lines.length ? result : null);
        })
        .catch(() => {
          if (!cancelled) setTokens(null);
        });
    }, RETOKENIZE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, lines.length]);

  return tokens;
}
