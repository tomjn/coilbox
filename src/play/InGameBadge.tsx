import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useChosenHostingRoute } from "@/direct/hostingRoute";
import { mpRelayTraffic } from "@/multiplayer/bindings";
import { usePlay } from "./PlayProvider";
import {
  ASK_EVERY_MS,
  RELAY_CARRYING_DETAIL,
  relayCarryingLabel,
} from "./relayCarrying";

/**
 * topbar.right slot: an orange pulsing "In game" pill, shown only while a game or
 * replay is running. Clicking the pill returns focus to the game window
 * (best-effort). The X force-quits it and clears the run state, an escape hatch
 * for when the badge is stuck because a launch never resolved (#925).
 *
 * A game the host is relaying gets two things more, and an ordinary game gets
 * neither, because there is nothing to say about one (issue #2024). It says how
 * much the relay is carrying, so a game that has quietly stopped can be told
 * from one that is working. And its X asks first, because everybody else in that
 * game is connected through this machine and ending it here ends it for all of
 * them.
 */
export default function InGameBadge() {
  const { running, focusGame, cancel } = usePlay();
  // The route this client last hosted at, which is a free local check and
  // decides whether to ask the backend anything at all. An ordinary battle
  // never polls, never redraws on a timer and never renders any of the below.
  const relayed = useChosenHostingRoute() === "relay";
  const carrying = useRelayCarrying(running && relayed);
  const [confirmEnd, setConfirmEnd] = useState(false);
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
      {carrying !== null && (
        <span title={RELAY_CARRYING_DETAIL} className="border-l pl-2">
          {relayCarryingLabel(carrying)}
        </span>
      )}
      {carrying === null ? (
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
      ) : (
        <Popover open={confirmEnd} onOpenChange={setConfirmEnd}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="End game"
              aria-label="End game"
              className="h-6 shrink-0 px-1 text-orange-600 hover:bg-orange-500/25 hover:text-orange-700 dark:text-orange-400"
            >
              <X size={12} />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 space-y-3">
            <p className="text-sm">
              This game runs through your machine's relay. Ending it here ends
              it for everybody playing in it, not just for you.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmEnd(false)}
              >
                Keep playing
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setConfirmEnd(false);
                  cancel();
                }}
              >
                End it for everybody
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/**
 * How much the relay is carrying, asked once a second while `watch` is true and
 * never otherwise.
 *
 * Polled rather than pushed, and the alternative is what makes this the cheap
 * option. An event would arrive on the lobby channel and redraw everything
 * mirroring lobby state once a second, on a machine that is running a game. This
 * redraws one pill, and only for a host who is relaying one.
 *
 * `null` is every way of having nothing to say: not relaying, the sidecar gone,
 * or the command failing. Each of them means coilbox does not know, and the pill
 * draws nothing rather than repeating the last figure it heard.
 */
function useRelayCarrying(watch: boolean): number | null {
  const [carrying, setCarrying] = useState<number | null>(null);
  useEffect(() => {
    if (!watch) {
      setCarrying(null);
      return;
    }
    let live = true;
    const ask = () => {
      mpRelayTraffic({})
        .then((answer) => {
          if (live) setCarrying(answer.bytesPerSecond);
        })
        .catch(() => {
          if (live) setCarrying(null);
        });
    };
    ask();
    const timer = setInterval(ask, ASK_EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [watch]);
  return carrying;
}
