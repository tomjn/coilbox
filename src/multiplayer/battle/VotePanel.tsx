import { Button } from "@picoframe/frame";
import { Check, Minus, Vote as VoteIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Vote } from "../bindings";

/**
 * Live seconds remaining from a unix-millis deadline, or null when the deadline is
 * unknown (`endsAt === 0`, e.g. we've only seen the start line so far). Ticks once
 * a second while a deadline is set.
 */
function useCountdown(endsAt: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/**
 * The transient panel for a live SPADS autohost vote. Shows what's being voted on,
 * the running yes/no tally (with how many each side needs), a countdown, and
 * one-click Yes / No / Abstain — so players don't have to read chat and type
 * `!vote`. Abstain only appears when the autohost advertised it. The panel is
 * mounted only while `room.currentVote` is set; the reducer clears that when the
 * vote passes, fails, is cancelled, or we leave, which unmounts this.
 */
export function VotePanel({
  vote,
  onVote,
}: {
  vote: Vote;
  onVote: (choice: "y" | "n" | "b") => void;
}) {
  const secondsLeft = useCountdown(vote.endsAt);

  // Proportional yes/no bar. Falls back to a neutral empty bar before any vote is
  // counted so we never divide by zero.
  const total = vote.yes + vote.no;
  const yesPct = total > 0 ? (vote.yes / total) * 100 : 0;

  return (
    <section
      aria-label="Autohost vote"
      className="border-b border-primary/30 bg-primary/5 px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <VoteIcon className="size-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">Vote</span>
          <span className="truncate text-sm text-muted-foreground">
            {vote.subject}
            {vote.caller && (
              <span className="text-muted-foreground/70"> · by {vote.caller}</span>
            )}
          </span>
        </div>
        {secondsLeft !== null && (
          <span
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
            aria-label={`${secondsLeft} seconds remaining`}
          >
            {secondsLeft}s left
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-[10rem] flex-1 items-center gap-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-destructive/25"
            aria-hidden
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${yesPct}%` }}
            />
          </div>
          <span
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
            aria-live="polite"
          >
            <span className="text-emerald-600 dark:text-emerald-400">
              y {vote.yes}/{vote.yesNeeded}
            </span>
            {" · "}
            <span className="text-destructive">
              n {vote.no}/{vote.noNeeded}
            </span>
          </span>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button size="sm" onClick={() => onVote("y")}>
            <Check className="size-4" />
            Yes
          </Button>
          <Button size="sm" variant="destructive" onClick={() => onVote("n")}>
            <X className="size-4" />
            No
          </Button>
          {vote.allowAbstain && (
            <Button size="sm" variant="outline" onClick={() => onVote("b")}>
              <Minus className="size-4" />
              Abstain
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
