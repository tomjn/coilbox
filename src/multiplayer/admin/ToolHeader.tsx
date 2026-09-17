import type { ReactNode } from "react";

/**
 * The top of a Server admin tool (issue #2918): its name, the tool's primary
 * action and any secondary ones on the right, and a line saying what it is
 * for. The page header above names the account and server, so this is an
 * `h2`.
 */
export function ToolHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {description ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
    </header>
  );
}

/** The padded, scrolling body of a Server admin drawer. `SlideDrawer` draws
 * the title and close button, and leaves the body to its caller. */
export function DrawerBody({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {children}
    </div>
  );
}

/** A labelled group of fields or actions inside a tool. */
export function ToolGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? (
          <p className="max-w-prose text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
