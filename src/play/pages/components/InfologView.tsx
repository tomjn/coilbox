import { useMemo } from "react";
import type { InfologTail } from "@/play/bindings";
import { classifyLine } from "@/play/crash";

/** The colour each level reads in. Warnings are amber rather than red so that a
 * log full of the engine's routine warnings does not look like a log full of
 * errors, which is the thing being looked for. */
const TONE = {
  error: "block text-destructive",
  warning: "block text-amber-500",
  normal: "block text-muted-foreground",
} as const;

/**
 * The engine log's tail, with the engine's own error and warning lines picked
 * out. Shared by the crash drawer and the Engine log settings page, which want
 * the same thing for different reasons.
 *
 * Rendered as one span per line inside a `<pre>` rather than as a block of text,
 * because each line needs its own colour, and left selectable because a log is
 * something you copy out of.
 */
export function InfologView({
  log,
  className,
}: {
  log: InfologTail;
  className?: string;
}) {
  // Classified once per log rather than once per render, and carrying its own
  // key: a log repeats lines verbatim, so position has to be part of the key.
  const rows = useMemo(
    () =>
      log.lines.map((text, i) => ({
        key: `${i}-${text}`,
        text,
        kind: classifyLine(text),
      })),
    [log.lines],
  );

  return (
    <div
      className={`overflow-auto rounded border border-border/60 bg-muted/30 p-3 ${className ?? ""}`}
    >
      {log.truncated ? (
        <p className="pb-2 text-xs text-muted-foreground">
          Showing the last {log.lines.length} of {log.totalLines} lines.
        </p>
      ) : null}
      <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">
        {rows.map((row) => (
          <span
            key={row.key}
            data-line-kind={row.kind}
            className={TONE[row.kind]}
          >
            {row.text || " "}
          </span>
        ))}
      </pre>
    </div>
  );
}
