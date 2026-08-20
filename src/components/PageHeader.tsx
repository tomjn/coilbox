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
 * description sits under both across the full width.
 *
 * The title row wraps, so on a narrow window the actions drop below the title
 * instead of squashing it.
 *
 * This is for the top of a route page. Drawer, panel and overlay headers have
 * their own constraints and keep their own markup.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
  children,
}: {
  /** Usually a string. A node so a page can put an icon or a badge beside it. */
  title: ReactNode;
  /** What the page is for. Omitted on pages that say it another way. */
  description?: ReactNode;
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
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
      {children}
    </header>
  );
}
