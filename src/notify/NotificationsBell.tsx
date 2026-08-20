import { Button, cn } from "@picoframe/frame";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  clearHistory,
  markRead,
  type NotifyHistoryEntry,
  useNotifyHistory,
} from "./history";
import type { NotifyLevel } from "./notify";

const DOT_CLASS: Record<NotifyLevel, string> = {
  info: "bg-muted-foreground",
  success: "bg-green-500",
  error: "bg-destructive",
};

/** Short relative time, e.g. "now", "3m", "2h", "5d". Pure for testing. */
export function relativeTime(at: number, now: number = Date.now()): string {
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 45) return "now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * topbar.right slot: a bell that opens a history of recent notifications. Toasts
 * vanish, so a missed "download failed" or "vote called" is otherwise lost; this
 * keeps the last {@link HISTORY_CAP} with timestamps, optional click-through to
 * the relevant screen, and clear-all. Opening the panel clears the unread badge.
 */
export default function NotificationsBell() {
  const { entries, unread } = useNotifyHistory();
  const navigate = useNavigate();

  return (
    <Popover onOpenChange={(open) => open && markRead()}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            unread > 0 ? `Notifications: ${unread} unread` : "Notifications"
          }
          className="relative flex size-8 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground ring-2 ring-background">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {entries.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => clearHistory()}
            >
              Clear all
            </Button>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No notifications yet.
          </p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {entries.map((entry) => (
              <NotificationRow
                key={entry.id}
                entry={entry}
                onNavigate={
                  entry.to ? () => navigate(entry.to as string) : undefined
                }
              />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  entry,
  onNavigate,
}: {
  entry: NotifyHistoryEntry;
  onNavigate?: () => void;
}) {
  const content = (
    <div className="flex items-start gap-2">
      <span
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          DOT_CLASS[entry.level],
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{entry.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {relativeTime(entry.at)}
          </span>
        </div>
        {entry.body && (
          // Wrapped rather than clipped to one line (issue #1703). A background
          // upload's entry is here to be read, and the sentence that says which
          // picture the hub refused and what was wrong with it is longer than
          // the popover is wide. The list already scrolls.
          <p className="mt-0.5 break-words text-xs text-muted-foreground">
            {entry.body}
          </p>
        )}
      </div>
    </div>
  );

  if (!onNavigate) return <li className="px-3 py-2">{content}</li>;
  return (
    <li>
      <button
        type="button"
        onClick={onNavigate}
        className="w-full px-3 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {content}
      </button>
    </li>
  );
}
