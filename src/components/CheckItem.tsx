/**
 * One row in a checks drawer: an icon for its severity, where it is and what
 * it says, and a tag naming what found it. The workshop's own checks drawer
 * (`ProjectChecks.tsx`) set the icon and colour for each severity, and this is
 * the generic row so every other checks drawer in the app reads the same way
 * rather than each page inventing its own list styling.
 *
 * A row given `onSelect` is a native `<button>`, not picoframe's `Button`,
 * because that component's ghost variant hovers to a solid, saturated fill
 * that reads as an alarm rather than a hint. A row here only ever needs a
 * quiet `hover:bg-muted/50` and a visible focus ring for the keyboard.
 */
import { CircleX, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export type CheckSeverity = "error" | "warning" | "info";

/** Which icon a severity reads as, wherever one is shown. */
export const SEVERITY_ICON: Record<CheckSeverity, typeof CircleX> = {
  error: CircleX,
  warning: TriangleAlert,
  info: Info,
};

/** How a severity reads, wherever one is shown: a row's icon, a gutter mark,
 *  or a count button covering a whole page's worth of them. */
export const SEVERITY_COLOR: Record<CheckSeverity, string> = {
  error: "text-destructive",
  warning: "text-amber-700 dark:text-amber-400",
  info: "text-muted-foreground",
};

/** The most urgent of a set of severities, error first, then warning, then
 *  info. `null` for an empty set, so a caller does not need its own guard. */
export function worstSeverity(
  severities: CheckSeverity[],
): CheckSeverity | null {
  if (severities.includes("error")) return "error";
  if (severities.includes("warning")) return "warning";
  return severities.length > 0 ? "info" : null;
}

function CheckItemBody({
  severity,
  location,
  message,
  tag,
}: {
  severity: CheckSeverity;
  location?: string;
  message: ReactNode;
  tag?: string;
}) {
  const Icon = SEVERITY_ICON[severity];
  return (
    <>
      <Icon
        className={`mt-0.5 size-3.5 shrink-0 ${SEVERITY_COLOR[severity]}`}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        {location && (
          <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">
            {location}
          </span>
        )}
        <span>{message}</span>
      </span>
      {tag && (
        <span className="shrink-0 self-start font-mono text-[10px] text-muted-foreground">
          {tag}
        </span>
      )}
    </>
  );
}

/**
 * One row of a checks list. Renders as an `<li>`, so a caller wraps rows in
 * a `<ul>` (see {@link CheckSection}). With `onSelect`, the row is a button
 * that jumps to what it is about. Without one it is a plain row, for a
 * finding the caller has nowhere to jump to.
 */
export function CheckItem({
  severity,
  location,
  message,
  tag,
  onSelect,
}: {
  severity: CheckSeverity;
  /** Where this is about, e.g. "line 12" or "this.h:73". Left out for a
   *  finding that names nowhere in particular. */
  location?: string;
  message: ReactNode;
  /** What found this, e.g. a lint rule id or "conversion". */
  tag?: string;
  onSelect?: () => void;
}) {
  if (onSelect) {
    return (
      <li>
        <button
          type="button"
          onClick={onSelect}
          className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CheckItemBody
            severity={severity}
            location={location}
            message={message}
            tag={tag}
          />
        </button>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2 px-2 py-1 text-xs">
      <CheckItemBody
        severity={severity}
        location={location}
        message={message}
        tag={tag}
      />
    </li>
  );
}

/** A titled list of {@link CheckItem} rows, with the count of what it holds
 *  in the heading (e.g. "Problems in the BOS (3)"), so a drawer with several
 *  of these reads the same way as the workshop's own checks drawer. */
export function CheckSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-sm">
        {title} ({count})
      </h3>
      <ul className="flex flex-col gap-1">{children}</ul>
    </section>
  );
}
