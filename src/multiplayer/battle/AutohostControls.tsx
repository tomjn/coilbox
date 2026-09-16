import { Button } from "@picoframe/frame";
import { Lock, Unlock } from "lucide-react";

/**
 * Friendly buttons over the common SPADS `!` commands so players don't have to
 * memorise them. Everything routes through `onCommand`, which sends SAYBATTLE.
 * The autohost enforces permissions and replies in battle chat. Ad-hoc
 * commands are typed straight into the battle chat, so there's no separate
 * command input here.
 *
 * In a direct room there is no autohost to enforce or reply, so these become
 * requests the founder reads in the same chat and answers with Accept/Reject
 * (issue #2871, `hostSuggestion.ts` + `HostSuggestionAction`). Only Balance
 * and Lock/Unlock have a founder-direct equivalent to honour, so `directRoom`
 * drops Fix colours and Ring unready rather than offering a button that
 * would still do nothing (the same reasoning #2738 hid this whole panel
 * for), and relabels the rest to say they're asks, not commands. The command
 * text sent is unchanged either way, so a battle that does have a real
 * autohost behind it still gets the plain command.
 */
export function AutohostControls({
  locked,
  directRoom,
  onCommand,
}: {
  locked: boolean;
  directRoom: boolean;
  onCommand: (command: string) => void;
}) {
  const quick: { label: string; cmd: string }[] = directRoom
    ? [{ label: "Suggest balance", cmd: "!balance" }]
    : [
        { label: "Balance", cmd: "!balance" },
        { label: "Fix colours", cmd: "!fixcolors" },
        { label: "Ring unready", cmd: "!ring" },
      ];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-4">
      <span className="text-sm font-semibold">
        {directRoom ? "Ask the host" : "Host commands"}
      </span>
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
          {directRoom
            ? locked
              ? "Suggest unlock"
              : "Suggest lock"
            : locked
              ? "Unlock"
              : "Lock"}
        </Button>
      </div>
    </div>
  );
}
