/**
 * A source text box, with line numbers, find's matches highlighted, and lint
 * problems marked in the gutter with a tooltip.
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
 *
 * `readOnly` is a view rather than an editor, for a generated or compiled
 * script nothing here can write back to. `dimmedLines` fades the lines a run
 * never reached, in a layer of its own above the text: the tint layer sits
 * behind the box so its colours show through gaps in the real, opaque
 * characters, and fading those same characters needs the opposite, a layer
 * the text is behind instead.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { LintDiagnostic } from "@/animation/bindings";
import {
  SEVERITY_COLOR,
  SEVERITY_ICON,
  worstSeverity,
} from "@/components/CheckItem";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { LuaMatch } from "@/scenario/pages/components/missionLuaSearch";

const TEXT =
  "font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:break-word]";
const LAYOUT = `absolute inset-0 py-2 pr-3 [scrollbar-gutter:stable] ${TEXT}`;

/** The worst severity lint found on a line, `error` or `warning` only: info
 *  is left unmarked everywhere here, since it is not worth the eye. */
function lineSeverity(diagnostics: LintDiagnostic[] | undefined) {
  if (!diagnostics) return null;
  const severity = worstSeverity(diagnostics.map((d) => d.severity));
  return severity === "info" ? null : severity;
}

/** How a line's own number reads in the gutter, for the worst severity on it. */
function gutterClass(severity: "error" | "warning" | null) {
  if (severity === "error") return "text-destructive font-semibold";
  if (severity === "warning")
    return "text-amber-600 dark:text-amber-400 font-semibold";
  return undefined;
}

/** The tint behind a line with a lint problem on it, subtle enough to read
 *  as a hint rather than a highlight, so several such lines in a row do not
 *  fight the amber a picked problem or a find match already use. */
function rowTint(severity: "error" | "warning" | null) {
  if (severity === "error") return "bg-destructive/10";
  if (severity === "warning") return "bg-amber-500/10";
  return undefined;
}

export function SourceEditor({
  id,
  value,
  onChange,
  placeholder,
  lines,
  matches,
  activeMatch,
  highlightLine,
  problems,
  readOnly,
  dimmedLines,
}: {
  id: string;
  value: string;
  /** Unused, and never called, when `readOnly` is set. */
  onChange?: (value: string) => void;
  placeholder: string;
  lines: string[];
  matches: LuaMatch[];
  activeMatch: LuaMatch | null;
  /** A 0-indexed line to scroll to and mark, such as a lint problem picked
   *  from the list beside this box. Independent of find's `activeMatch`. */
  highlightLine?: number | null;
  /** Every error or warning diagnostic on each 0-indexed line, for a mark in
   *  the gutter and a tint behind the line, each with the message(s) on
   *  hover. */
  problems?: Map<number, LintDiagnostic[]>;
  /** A view rather than an editor: what a generated or compiled script's own
   *  read-only text wants, since nothing typed here would go anywhere. */
  readOnly?: boolean;
  /** 0-indexed lines to show at reduced opacity, such as the ones a run never
   *  reached. Drawn over the text rather than behind it, which is what makes
   *  faded characters actually look faded rather than unaffected. */
  dimmedLines?: Set<number>;
}) {
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const backRef = useRef<HTMLDivElement | null>(null);
  const dimRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const [heights, setHeights] = useState<number[]>([]);
  const [width, setWidth] = useState(0);

  const follow = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    if (backRef.current) {
      backRef.current.scrollTop = box.scrollTop;
      backRef.current.scrollLeft = box.scrollLeft;
    }
    if (dimRef.current) {
      dimRef.current.scrollTop = box.scrollTop;
      dimRef.current.scrollLeft = box.scrollLeft;
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

  // A picked lint problem is brought to the middle of the box too, on its own
  // trigger so it works whether or not anything is being found.
  useEffect(() => {
    const box = boxRef.current;
    const line = highlightRef.current;
    if (highlightLine == null || !box || !line) return;
    box.scrollTop = line.offsetTop - box.clientHeight / 2;
    follow();
  }, [highlightLine, follow]);

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
            width: `calc(${Math.max(2, String(lines.length).length)}ch + ${problems && problems.size > 0 ? "2.5rem" : "1.5rem"})`,
          }}
        >
          <div ref={gutterRef} className={`py-2 pr-3 ${TEXT}`}>
            <TooltipProvider>
              {lines.map((_, n) => {
                const onLine = problems?.get(n);
                const severity = lineSeverity(onLine);
                const Icon = severity ? SEVERITY_ICON[severity] : null;
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: a line is its position in the text
                    key={n}
                    style={{ height: heights[n] }}
                    className="flex items-center justify-end gap-1"
                  >
                    {severity && Icon && onLine && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Icon
                            className={`size-3 shrink-0 ${SEVERITY_COLOR[severity]}`}
                            aria-hidden
                          />
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {onLine.map((d) => d.message).join(" ")}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <span className={gutterClass(severity)}>{n + 1}</span>
                  </div>
                );
              })}
            </TooltipProvider>
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
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: a line is its position in the text
              key={n}
              ref={n === highlightLine ? highlightRef : undefined}
              className={
                n === highlightLine
                  ? "bg-amber-400/25"
                  : rowTint(lineSeverity(problems?.get(n)))
              }
            >
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
          onChange={(e) => onChange?.(e.target.value)}
          onScroll={follow}
          placeholder={placeholder}
          spellCheck={false}
          readOnly={readOnly}
          className={`${LAYOUT} ${numbered ? "pl-0" : "pl-3"} h-full min-h-0 resize-none rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent md:text-xs`}
        />
        {dimmedLines && dimmedLines.size > 0 && (
          <div
            ref={dimRef}
            aria-hidden="true"
            className={`${LAYOUT} pointer-events-none overflow-hidden text-transparent ${numbered ? "" : "pl-3"}`}
          >
            {lines.map((line, n) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: a line is its position in the text
                key={n}
                className={dimmedLines.has(n) ? "bg-background/60" : undefined}
              >
                {line === "" ? " " : line}
              </div>
            ))}
          </div>
        )}
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
