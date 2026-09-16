/**
 * The BOS text box, with line numbers and find's matches highlighted in it.
 *
 * A text box cannot colour part of its own text, and WebKit does not paint the
 * selection of one that is not focused, which it is not while the find box is.
 * So the matches are drawn on a copy of the text laid out the same way behind
 * the box, whose own text and background are transparent. Both reserve the
 * scrollbar's width, so they wrap at the same place, and the copy follows the
 * box's scroll.
 *
 * Long lines wrap, so a line's number has to be as tall as the line. The copy
 * holds each line in its own block, and the gutter takes each block's height.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Textarea } from "@/components/ui/textarea";
import type { LuaMatch } from "@/scenario/pages/components/missionLuaSearch";

const TEXT =
  "font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:break-word]";
const LAYOUT = `absolute inset-0 py-2 pr-3 [scrollbar-gutter:stable] ${TEXT}`;

export function BosSource({
  id,
  value,
  onChange,
  placeholder,
  lines,
  matches,
  activeMatch,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  lines: string[];
  matches: LuaMatch[];
  activeMatch: LuaMatch | null;
}) {
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const backRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLElement | null>(null);
  const [heights, setHeights] = useState<number[]>([]);
  const [width, setWidth] = useState(0);

  const follow = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    if (backRef.current) {
      backRef.current.scrollTop = box.scrollTop;
      backRef.current.scrollLeft = box.scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.style.transform = `translateY(${-box.scrollTop}px)`;
    }
  }, []);

  // A new width rewraps the lines, so their heights are read again.
  useEffect(() => {
    const back = backRef.current;
    if (!back) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(back);
    return () => observer.disconnect();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: width is the remeasure trigger
  useLayoutEffect(() => {
    const back = backRef.current;
    if (!back) return;
    setHeights(
      Array.from(back.children, (line) => (line as HTMLElement).offsetHeight),
    );
    follow();
  }, [lines, matches, width, follow]);

  // The active match is brought to the middle of the box.
  useEffect(() => {
    const box = boxRef.current;
    const mark = activeRef.current;
    if (!activeMatch || !box || !mark) return;
    box.scrollTop = mark.offsetTop - box.clientHeight / 2;
    follow();
  }, [activeMatch, follow]);

  const byLine = new Map<number, LuaMatch[]>();
  for (const match of matches) {
    const list = byLine.get(match.line);
    if (list) list.push(match);
    else byLine.set(match.line, [match]);
  }
  const numbered = value !== "";

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
      {numbered && (
        <div
          aria-hidden="true"
          className="shrink-0 select-none overflow-hidden text-right text-muted-foreground"
          style={{
            width: `calc(${Math.max(2, String(lines.length).length)}ch + 1.5rem)`,
          }}
        >
          <div ref={gutterRef} className={`py-2 pr-3 ${TEXT}`}>
            {lines.map((_, n) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a line is its position in the text
              <div key={n} style={{ height: heights[n] }}>
                {n + 1}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="relative min-w-0 flex-1">
        <div
          ref={backRef}
          aria-hidden="true"
          className={`${LAYOUT} pointer-events-none overflow-hidden text-transparent ${numbered ? "" : "pl-3"}`}
        >
          {lines.map((line, n) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a line is its position in the text
            <div key={n}>
              {segments(line, byLine.get(n) ?? []).map((part) =>
                part.match ? (
                  <mark
                    key={part.from}
                    ref={part.match === activeMatch ? activeRef : undefined}
                    className={`rounded-[1px] text-transparent ${
                      part.match === activeMatch
                        ? "bg-amber-400/80"
                        : "bg-amber-300/40"
                    }`}
                  >
                    {part.text}
                  </mark>
                ) : (
                  <span key={part.from}>{part.text}</span>
                ),
              )}
              {/* An empty line still takes a line's height. */}
              {line === "" && " "}
            </div>
          ))}
        </div>
        <Textarea
          ref={boxRef}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={follow}
          placeholder={placeholder}
          spellCheck={false}
          className={`${LAYOUT} ${numbered ? "pl-0" : "pl-3"} h-full min-h-0 resize-none rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent md:text-xs`}
        />
      </div>
    </div>
  );
}

/** A line cut into plain runs and the matches on it. */
function segments(line: string, matches: LuaMatch[]) {
  const parts: { from: number; text: string; match?: LuaMatch }[] = [];
  let at = 0;
  for (const match of matches) {
    if (match.start > at) {
      parts.push({ from: at, text: line.slice(at, match.start) });
    }
    parts.push({
      from: match.start,
      text: line.slice(match.start, match.end),
      match,
    });
    at = match.end;
  }
  if (at < line.length) parts.push({ from: at, text: line.slice(at) });
  return parts;
}
