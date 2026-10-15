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
 * drops Fix colours rather than offering a button that would still do nothing
 * (the same reasoning #2738 hid this whole panel for), and relabels the rest
 * to say they're asks, not commands. The command text sent is unchanged
 * either way, so a battle that does have a real autohost behind it still gets
 * the plain command.
 *
 * Ring unready is the exception in both directions. The founder's own client
 * answers `!ring` wherever coilbox hosts the battle (`RingHost` in the lobby
 * protocol crate), so it keeps its plain label in a direct room and is the one
 * button a `selfHost` founder gets: the rest are inert for them, with lock in
 * the header and balance beside the presets. The founder's button rings
 * through `onRing` rather than `onCommand`: a host has no need to type a
 * command into its own battle to use a power it holds.
 */
export function AutohostControls({
  locked,
  directRoom,
  selfHost,
  onCommand,
  onRing,
}: {
  locked: boolean;
  directRoom: boolean;
  selfHost: boolean;
  onCommand: (command: string) => void;
  onRing: () => void;
}) {
  const ring = { label: "Ring unready", cmd: "!ring" };
  const quick: { label: string; cmd: string }[] = selfHost
    ? [ring]
    : directRoom
      ? [{ label: "Suggest balance", cmd: "!balance" }, ring]
      : [
          { label: "Balance", cmd: "!balance" },
          { label: "Fix colours", cmd: "!fixcolors" },
          ring,
        ];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-4">
      <span className="text-sm font-semibold">
        {directRoom && !selfHost ? "Ask the host" : "Host commands"}
      </span>
      <div className="flex flex-wrap gap-2">
        {quick.map((q) => (
          <Button
            key={q.cmd}
            variant="outline"
            size="sm"
            onClick={() => (selfHost ? onRing() : onCommand(q.cmd))}
          >
            {q.label}
          </Button>
        ))}
        {!selfHost && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onCommand(locked ? "!unlock" : "!lock")}
          >
            {locked ? (
              <Unlock className="size-4" />
            ) : (
              <Lock className="size-4" />
            )}
            {directRoom
              ? locked
                ? "Suggest unlock"
                : "Suggest lock"
              : locked
                ? "Unlock"
                : "Lock"}
          </Button>
        )}
      </div>
    </div>
  );
}
