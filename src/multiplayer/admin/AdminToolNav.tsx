import { cn } from "@picoframe/frame";
import { useId } from "react";
import { Link, useSearchParams } from "react-router";
import { groupTools, toolSearch } from "./toolNav";
import type { AdminTool } from "./tools";

function ToolGroupList({
  title,
  tools,
  current,
}: {
  title: string;
  tools: AdminTool[];
  current: string;
}) {
  const [params] = useSearchParams();
  const headingId = useId();
  if (tools.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h2
        id={headingId}
        className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {title}
      </h2>
      <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
        {tools.map(({ id, label, icon: Icon }) => {
          const active = id === current;
          return (
            <li key={id}>
              <Link
                to={{ search: `?${toolSearch(params, id)}` }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-accent/50",
                )}
              >
                <Icon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The Server admin page's tool list (issue #2918): moderation tools, then,
 * for an admin, the admin-only ones under their own heading. `tools` is
 * already filtered for the viewer, so a moderator's list has no admin group
 * at all rather than an empty one.
 */
export function AdminToolNav({
  tools,
  current,
}: {
  tools: AdminTool[];
  current: string;
}) {
  const { moderation, admin } = groupTools(tools);
  return (
    <nav
      aria-label="Server admin tools"
      className="flex flex-col gap-4 border-border p-3 md:border-r"
    >
      <ToolGroupList title="Moderation" tools={moderation} current={current} />
      <ToolGroupList title="Admin only" tools={admin} current={current} />
    </nav>
  );
}
