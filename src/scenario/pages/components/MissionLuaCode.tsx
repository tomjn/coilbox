/**
 * The compiled mission.lua on screen, with line numbers, shiki's colours and
 * find's highlighted matches (issue #2282). The three earlier problems this
 * fixes - no line numbers, no colour, no way to search - share one
 * rendering path here rather than three independent ones, because find has
 * to highlight text shiki has coloured, and neither can be allowed to
 * corrupt the other, see `missionLuaLineSegments.ts` for how that is done.
 *
 * A mission can be thousands of lines, and mounting a DOM row per line for
 * all of them is exactly the cost the issue calls out, so only the lines in
 * view (plus a small buffer) are ever rendered - see `missionLuaVirtualize.ts`
 * for the windowing math this reads from a real, measured container height.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { splitLineSegments } from "./missionLuaLineSegments";
import type { LuaMatch } from "./missionLuaSearch";
import type { LuaTokenLine } from "./missionLuaTokens";
import { scrollTopForLine, visibleLineWindow } from "./missionLuaVirtualize";

/** Pixels per line. Fixed, and applied to every row via inline style, so the
 *  windowing math above and the actual layout never disagree about it. */
const LINE_HEIGHT = 18;
/** Extra lines rendered above and below the visible range, so a fast scroll
 *  or a jump to a find match does not show a blank flash while the next
 *  frame's window catches up. */
const OVERSCAN = 15;

export interface MissionLuaCodeHandle {
  /** Scrolls so `line` (0-indexed) sits in the middle of the view. Used to
   *  jump to a find match, including one not currently mounted. */
  scrollToLine: (line: number) => void;
}

export const MissionLuaCode = forwardRef<
  MissionLuaCodeHandle,
  {
    lines: string[];
    tokens: LuaTokenLine[] | null;
    matches: LuaMatch[];
    activeMatch: LuaMatch | null;
  }
>(function MissionLuaCode({ lines, tokens, matches, activeMatch }, ref) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToLine(line: number) {
        const el = containerRef.current;
        if (!el) return;
        const top = scrollTopForLine(
          line,
          lines.length,
          viewportHeight,
          LINE_HEIGHT,
        );
        el.scrollTop = top;
        setScrollTop(top);
      },
    }),
    [lines.length, viewportHeight],
  );

  // Grouped once per matches change, so a line's own render does not scan
  // every match in the file to find the handful that are its own.
  const matchesByLine = useMemo(() => {
    const map = new Map<number, LuaMatch[]>();
    for (const match of matches) {
      const list = map.get(match.line);
      if (list) list.push(match);
      else map.set(match.line, [match]);
    }
    return map;
  }, [matches]);

  const { start, end } = visibleLineWindow(
    scrollTop,
    viewportHeight,
    lines.length,
    LINE_HEIGHT,
    OVERSCAN,
  );
  const gutterWidth = `${Math.max(2, String(lines.length).length)}ch`;

  return (
    <section
      ref={containerRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      aria-label="Compiled mission.lua"
      className="h-full overflow-auto rounded-md border border-border/50 bg-muted/20 font-mono text-xs"
    >
      <div style={{ height: lines.length * LINE_HEIGHT, position: "relative" }}>
        <div style={{ transform: `translateY(${start * LINE_HEIGHT}px)` }}>
          {lines.slice(start, end).map((text, i) => {
            const line = start + i;
            const segments = splitLineSegments(
              text,
              tokens?.[line],
              matchesByLine.get(line),
              activeMatch?.line === line ? activeMatch : null,
            );
            return (
              <div
                key={line}
                className="flex whitespace-pre"
                style={{ height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px` }}
              >
                <span
                  aria-hidden="true"
                  className="sticky left-0 shrink-0 select-none bg-muted/20 pr-3 text-right text-muted-foreground"
                  style={{ width: gutterWidth }}
                >
                  {line + 1}
                </span>
                <span data-testid="mission-lua-line-text">
                  {segments.map((segment, s) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: segments only ever grow by re-splitting the same immutable line text, never reorder
                      key={s}
                      style={
                        segment.color ? { color: segment.color } : undefined
                      }
                      className={
                        segment.match
                          ? segment.active
                            ? "rounded-[1px] bg-amber-400/80 text-background"
                            : "rounded-[1px] bg-amber-300/40"
                          : undefined
                      }
                    >
                      {segment.text}
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
});
