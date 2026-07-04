import { usePlay } from "./PlayProvider";

/**
 * topbar.right slot: an orange pulsing "In game" pill, shown only while a game or
 * replay is running. Clicking returns focus to the game window (best-effort).
 */
export default function InGameBadge() {
  const { running, focusGame } = usePlay();
  if (!running) return null;
  return (
    <button
      type="button"
      onClick={focusGame}
      title="Return to the game"
      className="flex animate-pulse items-center gap-1.5 rounded-full bg-orange-500/15 px-3 py-1 text-xs font-medium text-orange-600 hover:bg-orange-500/25 motion-reduce:animate-none dark:text-orange-400"
    >
      <span className="size-2 rounded-full bg-orange-500" />
      In game
    </button>
  );
}
