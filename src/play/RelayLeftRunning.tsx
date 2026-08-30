import { useEffect, useState } from "react";
import { mpRelayLeftRunning } from "@/multiplayer/bindings";
import {
  ASK_EVERY_MS,
  RELAY_LEFT_RUNNING_DETAIL,
  relayCarryingLabel,
} from "./relayCarrying";

/**
 * topbar.right slot: a pill for a relay that is running on this machine and that
 * this coilbox did not start (issue #2074).
 *
 * Closing coilbox during a relayed battle deliberately leaves the sidecar
 * running, so that the game carries on and nobody is cut off. Open coilbox again
 * and the machine is still carrying every other player's traffic with nothing on
 * screen to say so.
 *
 * ## What it does not do, and why
 *
 * It has no X. Ending that game means ending the engine, and coilbox has no
 * handle on it: a different coilbox launched it, that handle went with the
 * window, and a process id read off disk is not a thing to send a kill to,
 * because the number belongs to whatever the OS gave it to next. Asking the
 * relay to stop is not the same thing either. It would refuse, since it is
 * carrying a game, and if it did not it would cut everybody off rather than end
 * the match. So the pill says what is true and offers nothing it cannot do.
 *
 * It does not say "In game" either. The rate is measured traffic and is
 * evidence. A game running is not something coilbox can see from here.
 */
export default function RelayLeftRunning() {
  const relay = useRelayLeftRunning();
  if (!relay) return null;
  return (
    <div
      title={RELAY_LEFT_RUNNING_DETAIL}
      className="flex animate-pulse items-center gap-1.5 rounded-full bg-orange-500/15 px-3 py-1 text-xs font-medium text-orange-600 motion-reduce:animate-none dark:text-orange-400"
    >
      <span className="size-2 rounded-full bg-orange-500" />
      {relayCarryingLabel(relay.bytesPerSecond)}
    </div>
  );
}

/** A relay running on this machine that this coilbox did not start. */
type LeftRunning = {
  /** What the sidecar last said it was carrying, or null if it has not said. */
  bytesPerSecond: number | null;
};

/**
 * The relay left running, if there is one, kept up to date until it stops.
 *
 * Asked once when coilbox opens, and again every second only for as long as the
 * answer is yes. One sidecar runs per machine and only a coilbox starts one, so
 * a machine with none when this coilbox opened is not going to grow one that is
 * somebody else's. Asking forever on the chance would be a poll a second for the
 * whole of an ordinary session, which is nearly every session.
 *
 * A timeout rather than an interval, so a slow answer delays the next question
 * instead of stacking one on top of it.
 */
function useRelayLeftRunning(): LeftRunning | null {
  const [relay, setRelay] = useState<LeftRunning | null>(null);
  useEffect(() => {
    let live = true;
    let asking: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      let answer: Awaited<ReturnType<typeof mpRelayLeftRunning>> | null = null;
      try {
        answer = await mpRelayLeftRunning({});
      } catch {
        // A command that failed is coilbox not knowing, which is the same
        // answer as no relay and gets the same treatment.
      }
      if (!live) return;
      if (!answer?.relaying) {
        setRelay(null);
        return;
      }
      setRelay({ bytesPerSecond: answer.bytesPerSecond });
      asking = setTimeout(ask, ASK_EVERY_MS);
    };
    void ask();
    return () => {
      live = false;
      clearTimeout(asking);
    };
  }, []);
  return relay;
}
