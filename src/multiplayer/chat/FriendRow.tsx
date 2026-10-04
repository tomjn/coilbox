import { cn } from "@picoframe/frame";
import { UserCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { FriendStatus } from "../friendsAcrossServers";
import { PRESENCE_META } from "./presence";

const UNKNOWN_META = {
  label: "Unknown, not connected",
  dotClass: "border border-muted-foreground/60",
};

/**
 * One friend, as drawn in the chat sidebar. The per-connection Friends section
 * and the all-servers list both use this row, so anything a friend's row gains
 * (such as Join and Watch buttons) is added here once.
 *
 * `children` are hover-revealed actions that position themselves absolutely over
 * the right of the row (`FriendAction`, `FavStar`). They need the row's wrapping
 * `<li>`, which this renders, and the extra right padding it adds when present.
 */
export function FriendRow({
  name,
  status,
  battle,
  serverLabel,
  serverTitle,
  serverFriend,
  active,
  disabled,
  trailing,
  onOpen,
  children,
}: {
  name: string;
  status: FriendStatus;
  /** The battle the friend is in, when the row should say so. */
  battle?: { id: number; title: string } | null;
  /** The server's name, for a list that mixes servers. */
  serverLabel?: string;
  /** Longer hover text for the server, such as the account and server. */
  serverTitle?: string;
  serverFriend: boolean;
  active?: boolean;
  /** True when the row cannot be opened, such as a server that is not connected. */
  disabled?: boolean;
  /** Content after the name inside the button, such as an unread badge. */
  trailing?: ReactNode;
  onOpen: () => void;
  children?: ReactNode;
}) {
  const meta = status === "unknown" ? UNKNOWN_META : PRESENCE_META[status];
  const dim = status === "offline" || status === "unknown";
  const battleLabel = battle
    ? `In ${battle.title || `battle ${battle.id}`}`
    : null;
  const subline = [serverLabel, battleLabel].filter(Boolean).join(" · ");
  return (
    <li className="group relative">
      <button
        type="button"
        disabled={disabled}
        title={disabled ? serverTitle : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
          active ? "bg-muted font-medium" : "hover:bg-muted",
          disabled && "cursor-default hover:bg-transparent",
          children != null && "pr-16",
        )}
        onClick={onOpen}
      >
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", meta.dotClass)}
          title={meta.label}
        />
        {subline ? (
          <span className="flex min-w-0 flex-col" title={serverTitle}>
            <span className={cn("truncate", dim && "text-muted-foreground")}>
              {name}
            </span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              {subline}
            </span>
          </span>
        ) : (
          <span className={cn("truncate", dim && "text-muted-foreground")}>
            {name}
          </span>
        )}
        {serverFriend && (
          <UserCheck
            className="size-3.5 shrink-0 text-sky-500"
            aria-label="Server friend"
          />
        )}
        {trailing}
      </button>
      {children}
    </li>
  );
}
