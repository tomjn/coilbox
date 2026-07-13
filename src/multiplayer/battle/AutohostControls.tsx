import { Button } from "@picoframe/frame";
import { Lock, Unlock } from "lucide-react";

/**
 * Friendly buttons over the common SPADS `!` commands so players don't have to
 * memorise them. Everything routes through `onCommand` → SAYBATTLE; the autohost
 * enforces permissions and replies in battle chat. Ad-hoc commands are typed
 * straight into the battle chat, so there's no separate command input here.
 */
export function AutohostControls({
  locked,
  onCommand,
}: {
  locked: boolean;
  onCommand: (command: string) => void;
}) {
  const quick: { label: string; cmd: string }[] = [
    { label: "Balance", cmd: "!balance" },
    { label: "Fix colours", cmd: "!fixcolors" },
    { label: "Ring unready", cmd: "!ring" },
  ];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-4">
      <span className="text-sm font-semibold">Host commands</span>
      <div className="flex flex-wrap gap-2">
        {quick.map((q) => (
          <Button
            key={q.cmd}
            variant="outline"
            size="sm"
            onClick={() => onCommand(q.cmd)}
          >
            {q.label}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCommand(locked ? "!unlock" : "!lock")}
        >
          {locked ? <Unlock className="size-4" /> : <Lock className="size-4" />}
          {locked ? "Unlock" : "Lock"}
        </Button>
      </div>
    </div>
  );
}
