import { useLingui } from "@lingui/react/macro";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SyncState } from "./config";

const CONFIG: Record<SyncState, { pill: string; dot: string }> = {
  synced: {
    pill: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    // Pulsing green: everyone is synced and content is present.
    dot: "bg-green-500 animate-pulse",
  },
  pending: {
    pill: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500 animate-pulse",
  },
  error: {
    pill: "bg-destructive/15 text-destructive",
    dot: "bg-destructive",
  },
};

/**
 * Top-of-room sync indicator: a pulsing dot that reads green when every player is
 * synced and the local map+game are present, amber while sync is still unknown,
 * and red when someone is unsynced or content is missing.
 *
 * When fully synced the status is ambient, so it collapses to a bare dot with the
 * label in a hover tooltip. Any non-synced state keeps its text visible so it
 * draws the eye and reads as something that needs attention.
 */
export function SyncStatusPill({
  state,
  detail,
}: {
  state: SyncState;
  detail?: string;
}) {
  const { t } = useLingui();
  const cfg = CONFIG[state];
  const labels: Record<SyncState, string> = {
    synced: t`Synced`,
    pending: t`Checking sync…`,
    error: t`Out of sync`,
  };
  const label = labels[state];
  const showLabel = state !== "synced";
  return (
    <Badge
      variant="ghost"
      className={cn("gap-1.5", cfg.pill, !showLabel && "px-1.5")}
      title={detail ?? label}
    >
      <span className={cn("size-2 rounded-full", cfg.dot)} />
      {showLabel && (detail ?? label)}
    </Badge>
  );
}
