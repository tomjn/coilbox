import type { User } from "../bindings";

/**
 * A reusable member panel: the users in the active conversation, with a coarse
 * status hint. Clicking a member (when `onSelect` is given) starts a DM.
 */
export function MemberList({
  members,
  onSelect,
}: {
  members: User[];
  onSelect?: (username: string) => void;
}) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-l border-border">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold">
        Members ({members.length})
      </div>
      <ul className="flex flex-col gap-0.5 overflow-auto p-2">
        {members.map((u) => {
          const label = u.status.ingame
            ? "in-game"
            : u.status.away
              ? "away"
              : null;
          const row = (
            <span className="flex items-center justify-between gap-2">
              <span className="truncate">{u.name}</span>
              {label && (
                <span className="text-xs text-muted-foreground">{label}</span>
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
