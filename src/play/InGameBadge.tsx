import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
 *
 * ## The two are not the same question (issue #2094)
 *
 * They were, and that was the bug. The X asked first only when there was a
 * figure to draw, so anything that took the figure away took the warning with
 * it and left the button doing the dangerous thing on the first press. Leaving
 * the battle room mid-game did exactly that.
 *
 * A figure is a nice-to-have that goes missing for several ordinary reasons. A
 * relay carrying every other player's traffic is a fact about what the X does.
 * So `relaying` decides the warning and `bytesPerSecond` decides the figure, and
 * nothing about the warning depends on coilbox managing to read a number.
 *
 * ## And they are both about this game (issue #2097)
 *
 * `relayed` is a fact about the run that is on screen, put there by the launch
 * that started the relayed battle. It used to be the route this client last
 * hosted at, which describes a battle rather than a game and outlives the
 * battle it describes. A sidecar outlives its game too, by up to the four
 * minutes of its traffic backstop, and between them they put the relay label
 * and the warning on a single player skirmish started inside that window.
 * Ending that ends it for nobody.
 *
 * It is also the free local check that decides whether to ask the backend
 * anything at all. An ordinary game never polls, never redraws on a timer and
 * never renders any of the below.
 */
export default function InGameBadge() {
  const { running, relayed, focusGame, cancel } = usePlay();
  const relay = useRelayCarrying(running && relayed);
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
      {relay.relaying && (
        <span title={RELAY_CARRYING_DETAIL} className="border-l pl-2">
          {relayCarryingLabel(relay.bytesPerSecond)}
        </span>
      )}
      {!relay.relaying ? (
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

/** The relay behind the running game, as far as coilbox can see it. */
type RelayBehindTheGame = {
  /** A relay on this machine is up and this game's traffic goes through it. */
  relaying: boolean;
  /** What it last said it was carrying, or null if it has not said. */
  bytesPerSecond: number | null;
};

/** Nothing known, which is what an ordinary game has and never asks about. */
const NOT_RELAYED: RelayBehindTheGame = {
  relaying: false,
  bytesPerSecond: null,
};

/**
 * The relay behind the game, asked once a second while `watch` is true and
 * never otherwise.
 *
 * Polled rather than pushed, and the alternative is what makes this the cheap
 * option. An event would arrive on the lobby channel and redraw everything
 * mirroring lobby state once a second, on a machine that is running a game. This
 * redraws one pill, and only for a host who is relaying one.
 *
 * A `null` figure is every way of having nothing to say about the rate: a
 * sidecar coilbox has stopped hearing from, or one whose last word is too old to
 * repeat. The pill draws no number rather than the last one it heard.
 *
 * A failed call is the one case that does not clear `relaying`. The command
 * cannot fail on the Rust side, so a rejection here is the IPC itself, and
 * treating that as "no relay" would take the warning off the X for a second on
 * the strength of a dropped message. The figure still goes, because a figure
 * from a call that did not happen is not a figure.
 */
function useRelayCarrying(watch: boolean): RelayBehindTheGame {
  const [relay, setRelay] = useState<RelayBehindTheGame>(NOT_RELAYED);
  useEffect(() => {
    if (!watch) {
      setRelay(NOT_RELAYED);
      return;
    }
    let live = true;
    const ask = () => {
      mpRelayTraffic({})
        .then((answer) => {
          if (live) setRelay(answer);
        })
        .catch(() => {
          if (live) setRelay((was) => ({ ...was, bytesPerSecond: null }));
        });
    };
    ask();
    const timer = setInterval(ask, ASK_EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [watch]);
  return relay;
}
