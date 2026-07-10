import { cn } from "@picoframe/frame";
import type { User } from "../bindings";
import { PRESENCE_META, type Presence } from "./presence";

/**
 * A reusable member panel: the users in the active conversation, with a coarse
 * status hint. Clicking a member (when `onSelect` is given) starts a DM.
 */
export function MemberList({
  members,
  onSelect,
  colorFor,
  presenceFor,
}: {
  members: User[];
  onSelect?: (username: string) => void;
  /** Optional per-member accent colour (`#rrggbb`), e.g. a battle player's team
   * colour, shown as a swatch. Returns undefined when there's no colour. */
  colorFor?: (username: string) => string | undefined;
  /** Optional per-member presence (in-game/in-battle/away/online/offline),
   * shown as a coloured dot plus a label for any non-online state. */
  presenceFor?: (username: string) => Presence;
}) {
  // Reserve the swatch column only when at least one member has a colour, so
  // colour-less members (e.g. the host) still line up, while plain channel/DM
  // lists (no colours at all) stay flush without a leading gap.
  const showSwatches = colorFor ? members.some((u) => colorFor(u.name)) : false;
  return (
    <aside className="flex w-56 shrink-0 flex-col border-l border-border">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold">
        Members ({members.length})
      </div>
      <ul className="flex flex-col gap-0.5 overflow-auto p-2">
        {members.map((u) => {
          const presence = presenceFor?.(u.name);
          const meta = presence ? PRESENCE_META[presence] : null;
          const color = colorFor?.(u.name);
          const row = (
            <span className="flex items-center gap-2">
              {showSwatches &&
                (color ? (
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/30"
                    style={{ backgroundColor: color }}
                  />
                ) : (
                  <span aria-hidden className="size-2.5 shrink-0" />
                ))}
              <span className="truncate">{u.name}</span>
              {meta && (
                <span
                  className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                  title={meta.label}
                >
                  <span
                    aria-hidden
                    className={cn("size-2 rounded-full", meta.dotClass)}
                  />
                  {presence !== "online" && meta.label}
                </span>
              )}
            </span>
          );
          return (
            <li key={u.name}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(u.name)}
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  {row}
                </button>
              ) : (
                <span className="block px-2 py-1.5 text-sm">{row}</span>
              )}
            </li>
          );
        })}
        {members.length === 0 && (
          <li className="px-2 py-1.5 text-sm text-muted-foreground">
            No members.
          </li>
        )}
      </ul>
    </aside>
  );
}
