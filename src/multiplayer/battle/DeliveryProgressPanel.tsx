/**
 * Render a paced `!bSet` delivery run's progress: one line per slot, a
 * one-sentence verdict once it stops, and the reason for the slot that
 * failed (issue #1279, reused for the preset-load path in issue #2761).
 *
 * Shared between the two callers of `runDelivery`, a workshop project's
 * tweak slots and a whole option preset, because a run looks the same either
 * way: a list of slots, each one queued, sent, confirmed or given up on.
 */
import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "@/lib/utils";
import {
  type DeliveryProgress,
  deliverySummary,
  type SlotProgress,
} from "./tweakDelivery";

function SlotRow({ entry }: { entry: SlotProgress }) {
  const { t } = useLingui();
  const stateLabel: Record<SlotProgress["state"], string> = {
    waiting: t`queued`,
    "already-set": t`already set`,
    sending: t`sending`,
    confirming: t`waiting for the battle`,
    confirmed: t`set`,
    failed: t`did not land`,
    skipped: t`not sent`,
  };
  const bad = entry.state === "failed";
  const grey = entry.state === "skipped" || entry.state === "waiting";
  return (
    <li className="flex items-baseline justify-between gap-3 text-xs">
      <code className="shrink-0">{entry.slot.name}</code>
      <span
        className={cn(
          "text-right",
          bad && "text-destructive",
          grey && "text-muted-foreground",
        )}
      >
        {stateLabel[entry.state]}
      </span>
    </li>
  );
}

export function DeliveryProgressPanel({
  progress,
  retryHint,
}: {
  progress: DeliveryProgress;
  /** What a second run does, phrased for the caller's own slots (a workshop
   *  project's tweak slots, or a preset's options). Both skip whatever is
   *  already set, so only the missing ones go out. */
  retryHint: string;
}) {
  const failed = progress.slots.find((s) => s.state === "failed");
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 p-3">
      <ul className="flex flex-col gap-1">
        {progress.slots.map((entry) => (
          <SlotRow key={entry.slot.name} entry={entry} />
        ))}
      </ul>
      {progress.done && (
        <p
          className={cn(
            "text-xs",
            progress.stoppedAt == null
              ? "text-muted-foreground"
              : "text-destructive",
          )}
        >
          {deliverySummary(progress)}
        </p>
      )}
      {failed && (
        <div className="flex flex-col gap-2 text-xs text-destructive">
          <p>{failed.reason}</p>
          {failed.hostSaid?.map((said) => (
            <p key={said} className="break-all">
              <Trans>The host said: {said}</Trans>
            </p>
          ))}
          {failed.serverSaid?.map((said) => (
            <p key={said} className="break-all">
              <Trans>The server said: {said}</Trans>
            </p>
          ))}
          {!failed.hostSaid && !failed.serverSaid && (
            <p>
              <Trans>
                Nothing said why. The usual causes are not being the room's
                boss, the autohost ignoring you for sending too much too fast,
                and a lobby server that drops a line this long.
              </Trans>
            </p>
          )}
          <p>{retryHint}</p>
        </div>
      )}
    </div>
  );
}
