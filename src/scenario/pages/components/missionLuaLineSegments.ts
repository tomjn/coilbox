/**
 * Where shiki's colours and find's matches are combined, for one line of the
 * mission Lua code view (issue #2282).
 *
 * Neither source owns the DOM here: shiki's tokens are plain data (see
 * `missionLuaTokens.ts`, which explains why `codeToHtml`'s ready-made markup
 * was not used), and find's matches are just character ranges (see
 * `missionLuaSearch.ts`). Cutting the line's text at every token boundary and
 * every match boundary, then looking up which token and which match (if any)
 * cover each resulting piece, means the colour and the highlight are both
 * just facts about a segment rather than two competing ways of marking up
 * the same string, so there is nothing for one to clobber in the other.
 */

import type { LuaMatch } from "./missionLuaSearch";
import type { LuaTokenLine } from "./missionLuaTokens";

export interface LineSegment {
  text: string;
  /** shiki's colour for this segment, or undefined for plain text (no
   *  tokens, or a token set that did not reconstruct the line - see below). */
  color?: string;
  /** Whether this segment is (part of) a find match. */
  match: boolean;
  /** Whether this segment is (part of) the current find match, styled apart
   *  from the rest so an author can tell which one "next" landed on. */
  active: boolean;
}

/**
 * Splits `text` into segments carrying shiki's colour and find's match state.
 *
 * `tokens` is trusted only if concatenating its content reconstructs `text`
 * exactly - otherwise every segment renders as plain text, since a token set
 * that does not add up to the same string cannot be aligned to it safely.
 */
export function splitLineSegments(
  text: string,
  tokens: LuaTokenLine | undefined,
  matches: LuaMatch[] | undefined,
  activeMatch: LuaMatch | null,
): LineSegment[] {
  const cuts = new Set<number>([0, text.length]);

  let tokenRanges: { start: number; end: number; color?: string }[] = [];
  if (tokens && tokens.length > 0) {
    let pos = 0;
    const ranges = tokens.map((token) => {
      const range = {
        start: pos,
        end: pos + token.content.length,
        color: token.color,
      };
      pos += token.content.length;
      return range;
    });
    if (pos === text.length) tokenRanges = ranges;
  }
  for (const range of tokenRanges) {
    cuts.add(range.start);
    cuts.add(range.end);
  }

  const lineMatches = matches ?? [];
  for (const match of lineMatches) {
    cuts.add(Math.min(match.start, text.length));
    cuts.add(Math.min(match.end, text.length));
  }

  const points = [...cuts].sort((a, b) => a - b);
  const segments: LineSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (start === end) continue;
    const color = tokenRanges.find(
      (range) => range.start <= start && end <= range.end,
    )?.color;
    const match = lineMatches.some((m) => m.start <= start && end <= m.end);
    const active = activeMatch
      ? activeMatch.start <= start && end <= activeMatch.end
      : false;
    segments.push({ text: text.slice(start, end), color, match, active });
  }
  // A blank line still needs a segment to render as an (empty) row.
  if (segments.length === 0) {
    segments.push({ text: "", match: false, active: false });
  }
  return segments;
}
