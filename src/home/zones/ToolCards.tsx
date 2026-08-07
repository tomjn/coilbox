import { useFrame } from "@picoframe/frame";
import type { NavItem } from "@picoframe/plugin-sdk";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router";
import { homeToolGroups } from "../nav";

/**
 * Every navigable route as a card, grouped exactly as the sidebar groups them.
 *
 * A fork of picoframe's built-in launcher grid, copied rather than imported
 * because the package exports only `Home` as a whole page and not its parts.
 * Kept deliberately identical for now: issue #985 moves ownership of `/` into
 * Coilbox with no visible change, and later issues in milestone 16 add card art
 * on top of this.
 *
 * Both of picoframe's launcher sentences ("Choose a tool to get started." and
 * the empty-grid "No tools available yet.") moved to the Greeting zone in issue
 * #987, which owns the line under the heading. The grid now does what every zone
 * does and renders nothing when it has nothing.
 */
export default function ToolCards() {
  const { nav } = useFrame();
  // Groups as composeNav sorted them, minus Home and anything left empty, so the
  // grid mirrors the sidebar. Shared with the Greeting, which needs the same
  // answer to decide whether to say there are no tools.
  const groups = homeToolGroups(nav);
  if (groups.length === 0) return null;

  return (
    <div className="mt-6 space-y-8">
      {groups.map((group) => (
        <section key={group.id} className="hidden has-[[data-nav-item]]:block">
          {group.label && (
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {group.label}
            </h2>
          )}
          <div className="flex flex-wrap gap-3">
            {group.items.map((item) => (
              <ToolCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Resolve a nav item's live presentation, in one fixed hook-call order.
 *
 * picoframe's own `useResolvedNavItem` is internal to the package, so this is a
 * copy. Every hook runs even where the result is unused, because hooks must run
 * unconditionally per fiber. As picoframe requires, a given item id must
 * consistently define, or not define, each hook.
 */
function useResolvedNavItem(item: NavItem) {
  return {
    // biome-ignore-start lint/correctness/useHookAtTopLevel: the hook call is guarded by whether the nav item defines it, which picoframe's contract requires to be stable for a given item id. The sidebar resolves items the same way.
    visible: item.useVisible ? item.useVisible() : true,
    label: item.useLabel ? item.useLabel() : item.label,
    icon: item.useIcon ? item.useIcon() : item.icon,
    description: item.useDescription ? item.useDescription() : item.description,
    // biome-ignore-end lint/correctness/useHookAtTopLevel: end of the guarded resolver
  };
}

function ToolCard({ item }: { item: NavItem }) {
  // Mirror the sidebar: an item gated off via `useVisible` is hidden everywhere,
  // this grid included. Resolved unconditionally (per-item component, so
  // hook-safe) before the early return. Visible cards carry `data-nav-item` so
  // their section stays shown.
  const { visible, label, icon: Icon, description } = useResolvedNavItem(item);
  if (!visible) return null;

  // Full-width single column on phones, a fixed 16rem on larger screens so cards
  // pack left and wrap instead of stretching to fill a grid cell.
  const cardClass =
    "group flex w-full items-center gap-3 rounded-lg border border-border bg-card p-4 text-left text-card-foreground transition-colors hover:border-ring hover:bg-accent sm:w-64";
  const inner = (
    <>
      {Icon && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-background">
          <Icon size={20} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {description != null && (
          <span className="block truncate text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      {item.href && (
        <ExternalLink size={16} className="shrink-0 text-muted-foreground" />
      )}
    </>
  );

  if (item.href) {
    const href = item.href;
    return (
      <button
        type="button"
        data-nav-item=""
        onClick={() =>
          openUrl(href).catch((err) =>
            console.error(`home: could not open external url: ${href}`, err),
          )
        }
        className={cardClass}
      >
        {inner}
      </button>
    );
  }
  return (
    <Link to={item.to ?? "/"} data-nav-item="" className={cardClass}>
      {inner}
    </Link>
  );
}
