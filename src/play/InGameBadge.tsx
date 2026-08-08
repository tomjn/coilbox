import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { usePlay } from "./PlayProvider";

/**
 * topbar.right slot: an orange pulsing "In game" pill, shown only while a game or
 * replay is running. Clicking the pill returns focus to the game window
 * (best-effort). The X force-quits it and clears the run state, an escape hatch
 * for when the badge is stuck because a launch never resolved (#925).
 */
export default function InGameBadge() {
  const { running, focusGame, cancel } = usePlay();
  if (!running) return null;
  return (
    <div className="flex animate-pulse items-center gap-1 rounded-full bg-orange-500/15 py-1 pl-3 pr-1 text-xs font-medium text-orange-600 hover:bg-orange-500/25 motion-reduce:animate-none dark:text-orange-400">
      <button
        type="button"
        onClick={focusGame}
        title="Return to the game"
        className="flex items-center gap-1.5"
      >
        <span className="size-2 rounded-full bg-orange-500" />
        In game
      </button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={cancel}
        title="End game"
        aria-label="End game"
        className="h-6 shrink-0 px-1 text-orange-600 hover:bg-orange-500/25 hover:text-orange-700 dark:text-orange-400"
      >
        <X size={12} />
      </Button>
    </div>
  );
}
