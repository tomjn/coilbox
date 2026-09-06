import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The header at the top of a page: a title, the buttons that act on the whole
 * page, and a line or two saying what the page is for.
 *
 * Written once because it was written by hand on about fifty pages, and the
 * hand written version puts the description beside the buttons rather than
 * under them (issue #1509). That gives the description a third of the width and
 * wraps it to four or five lines, while the space under the buttons stays
 * empty. Here the title row holds only the title and the actions, and the
 * description sits under both.
 *
 * The description is capped at 65ch because uncapped it is one 190 character
 * line on a 1512px window, which is hard to read back. 65ch is 563px, still
 * most of the width the hand written version denied it: on the blueprint
 * library it goes from 344px and four lines to 563px and two. Six of the
 * seventeen headers this replaces already set the same cap.
 *
 * The title row wraps, so on a narrow window the actions drop below the title
 * instead of squashing it. `shrink-0` keeps them one line while they fit and
 * `max-w-full` lets them wrap once they no longer do, rather than running off
 * the right edge as the hand written version does at 600px.
 *
 * `descriptionClassName` is an escape hatch from the 65ch cap, not a second way
 * to set it. It exists for a header whose description is one short sentence and
 * whose actions leave the rest of the row empty (issue #2563's hub browse
 * header): there the cap wraps a line that already fits, for no reason. Reach
 * for it only when the description is short enough that widening it will not
 * itself repeat the 190-character problem the cap exists to avoid.
 *
 * This is for the top of a route page. Drawer, panel and overlay headers have
 * their own constraints and keep their own markup.
 */
export function PageHeader({
  title,
  description,
  descriptionClassName,
  actions,
  className,
  children,
}: {
  /** Usually a string. A node so a page can put an icon or a badge beside it. */
  title: ReactNode;
  /** What the page is for. Omitted on pages that say it another way. */
  description?: ReactNode;
  /** Overrides the description's default classes (65ch cap, small muted text).
   * See the escape-hatch note above - most callers should leave this unset. */
  descriptionClassName?: string;
  /** Buttons acting on the page. A falsy value leaves the row to the title. */
  actions?: ReactNode;
  className?: string;
  /** Anything else the header holds, e.g. a filter row, below the description. */
  children?: ReactNode;
}) {
  return (
    <header className={cn("flex flex-col gap-1", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          {title}
        </h1>
        {actions ? (
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {description ? (
        <p
          className={cn(
            "max-w-prose text-sm text-muted-foreground",
            descriptionClassName,
          )}
        >
          {description}
        </p>
      ) : null}
      {children}
    </header>
  );
}
