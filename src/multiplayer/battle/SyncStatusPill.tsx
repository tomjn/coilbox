import { cn } from "@/lib/utils";
import type { SyncState } from "./config";

const CONFIG: Record<SyncState, { pill: string; dot: string; label: string }> =
  {
    synced: {
      pill: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      // Pulsing green: everyone is synced and content is present.
      dot: "bg-green-500 animate-pulse",
      label: "Synced",
    },
    pending: {
      pill: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      dot: "bg-amber-500 animate-pulse",
      label: "Checking sync…",
    },
    error: {
      pill: "bg-destructive/15 text-destructive",
      dot: "bg-destructive",
      label: "Out of sync",
    },
  };

/**
 * Top-of-room sync indicator: a pill with a pulsing dot that reads green when
 * every player is synced and the local map+game are present, amber while sync is
 * still unknown, and red when someone is unsynced or content is missing.
 */
export function SyncStatusPill({
  state,
  detail,
}: {
  state: SyncState;
  detail?: string;
}) {
  const cfg = CONFIG[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        cfg.pill,
      )}
      title={detail ?? cfg.label}
    >
      <span className={cn("size-2 rounded-full", cfg.dot)} />
      {detail ?? cfg.label}
    </span>
  );
}
