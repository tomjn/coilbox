import { Button } from "@picoframe/frame";
import { Percent } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { clampBonus } from "./config";

/**
 * Set a player's SPADS resource bonus/handicap, 0-100% (issue #346), via
 * `!force <name> bonus <n>`, the real SPADS command. There is no team-scoped
 * `!teambonus`, only this per-player one, which the wire protocol calls
 * `HANDICAP`.
 *
 * SPADS's own command level gates who may call this (typically boss/host),
 * the same as every other `!`-command in this room (see `AutohostControls`):
 * coilbox has no reliable way to know a viewer's SPADS rights ahead of time,
 * so the control is offered to anyone and a denied attempt comes back as a
 * chat rebuff rather than being hidden speculatively.
 *
 * `confirmed` is never a locally-guessed echo. It's decoded off the player's
 * `battleStatus`, which only changes on a `CLIENTBATTLESTATUS` line from the
 * server, so it is always what the server actually reports. The slider's
 * position while the popover is open is a draft, and nothing is sent until
 * Send. The closed trigger only ever shows `confirmed`.
 */
export function BonusButton({
  name,
  confirmed,
  onSend,
}: {
  name: string;
  /** The player's last server-confirmed bonus, 0-100. */
  confirmed: number;
  onSend: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(confirmed);
  const hasBonus = confirmed > 0;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setDraft(confirmed);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            hasBonus
              ? `Edit resource bonus for ${name}, currently ${confirmed}%`
              : `Set a resource bonus for ${name}`
          }
          title={
            hasBonus ? `${confirmed}% resource bonus` : "Set a resource bonus"
          }
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-0.5 rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground",
            hasBonus && "text-amber-600 dark:text-amber-400",
          )}
        >
          <Percent className="size-3.5" />
          {hasBonus && (
            <span className="text-[11px] tabular-nums">{confirmed}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Resource bonus: {name}</p>
          <p className="text-xs text-muted-foreground">
            Current: {confirmed}%. The autohost applies this and rejects the
            request if you aren't its boss or host.
          </p>
          <div className="flex items-center gap-3">
            <Slider
              aria-label={`Resource bonus for ${name}`}
              min={0}
              max={100}
              step={1}
              value={[draft]}
              onValueChange={([v]) => setDraft(v)}
              className="py-2"
            />
            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {draft}%
            </span>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              className="h-7"
              disabled={draft === confirmed}
              onClick={() => {
                onSend(clampBonus(draft));
                setOpen(false);
              }}
            >
              Send
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
