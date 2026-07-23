import { Button, cn } from "@picoframe/frame";
import { UserCheck, UserX } from "lucide-react";
import type { ReactNode } from "react";
import type { User } from "../bindings";
import { NoteButton } from "../NoteButton";
import { CountryFlag, RankBadge } from "../UserBadges";
import { PRESENCE_META, type Presence } from "./presence";

/**
 * A reusable member panel: the users in the active conversation, with a coarse
 * status hint. Clicking a member (when `onSelect` is given) starts a DM; a trailing
 * ignore toggle (when `onToggleIgnore` is given) hides/shows that user's messages.
 */
export function MemberList({
  members,
  onSelect,
  colorFor,
  presenceFor,
  isIgnored,
  onToggleIgnore,
  noteFor,
  onSetNote,
  statsSummaryFor,
  renderActions,
}: {
  members: User[];
  onSelect?: (username: string) => void;
  /** Optional per-member accent colour (`#rrggbb`), e.g. a battle player's team
   * colour, shown as a swatch. Returns undefined when there's no colour. */
  colorFor?: (username: string) => string | undefined;
  /** Optional per-member presence (in-game/in-battle/away/online/offline),
   * shown as a coloured dot plus a label for any non-online state. */
  presenceFor?: (username: string) => Presence;
  /** Whether a member is currently on the ignore list (dims them + flips the toggle). */
  isIgnored?: (username: string) => boolean;
  /** Toggle a member on/off the ignore list. Renders a per-row ignore button. */
  onToggleIgnore?: (username: string) => void;
  /** Current private note for a member ("" for none). Given the full `User` so
   * callers can key it on account id rather than name (issue #341). Renders a
   * per-row note button when provided. */
  noteFor?: (user: User) => string;
  /** Save (or, given "", clear) a member's private note. */
  onSetNote?: (user: User, text: string) => void;
  /** "N games with this player…" summary from the local replay-stats database
   * (#375), or null with nothing to say. Shown in the note popover alongside
   * the manual note. */
  statsSummaryFor?: (user: User) => string | null;
  /** Optional trailing per-member control (e.g. a moderation menu). Returns a node
   * to render at the end of the row, or null/undefined to render nothing for it. */
  renderActions?: (username: string) => ReactNode;
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
          const ignored = isIgnored?.(u.name) ?? false;
          const note = noteFor?.(u) ?? "";
          const row = (
            <span
              className={cn("flex items-center gap-2", ignored && "opacity-50")}
            >
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
              <CountryFlag country={u.country} />
              <span className="truncate" title={note || undefined}>
                {u.name}
              </span>
              <RankBadge rank={u.status.rank} />
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
            <li key={u.name} className="flex items-center gap-1">
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(u.name)}
                  className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  {row}
                </button>
              ) : (
                <span className="block min-w-0 flex-1 px-2 py-1.5 text-sm">
                  {row}
                </span>
              )}
              {onSetNote && (
                <NoteButton
                  name={u.name}
                  note={note}
                  onSave={(text) => onSetNote(u, text)}
                  statsSummary={statsSummaryFor?.(u)}
                />
              )}
              {onToggleIgnore && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-8 shrink-0 p-0"
                  onClick={() => onToggleIgnore(u.name)}
                  aria-label={
                    ignored ? `Unignore ${u.name}` : `Ignore ${u.name}`
                  }
                  title={ignored ? "Unignore" : "Ignore"}
                >
                  {ignored ? (
                    <UserCheck className="size-4" />
                  ) : (
                    <UserX className="size-4" />
                  )}
                </Button>
              )}
              {renderActions?.(u.name)}
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
