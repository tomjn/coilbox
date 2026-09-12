import { Button } from "@picoframe/frame";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useChosenHostingRoute } from "@/direct/hostingRoute";
import { notify } from "@/notify/notify";
import { usePlay } from "@/play/PlayProvider";
import { ASK_EVERY_MS, relayCarryingLabel } from "@/play/relayCarrying";
import { leaveBattle } from "./battle/leaveBattle";
import { LeftoverRelayAgent } from "./battles/LeftoverRelayAgent";
import {
  mpLeftoverRelayAgent,
  mpRelayLeftRunning,
  mpRelayTraffic,
} from "./bindings";
import { useMultiplayer } from "./store";

/**
 * topbar.right slot: one pill for the relay on this machine, on every page,
 * whichever battle it is carrying.
 *
 * There are two relays it can be about, and they need opposite things. One is
 * carrying a battle this coilbox is hosting, and the host can go back to it or
 * close it. The other was left running by an earlier coilbox for a game that
 * may still be being played, which coilbox cannot end and can only ask to stop
 * (issue #2062). The first used to be a word in the battle room's header, gone
 * the moment the host looked anywhere else, and the second a pill with nothing
 * to press (issue #2074).
 *
 * It stands aside while a relayed game is running, because the in-game badge
 * already says what the relay is carrying and owns the warning on ending the
 * game (issue #2094).
 */
export default function RelayIndicator() {
  const { running, relayed } = usePlay();
  const hosting = useChosenHostingRoute() === "relay";
  const ours = useOurRelay(hosting);
  const leftover = useRelayLeftRunning(ours !== null);
  if (running && relayed) return null;
  if (ours) return <OurRelay {...ours} />;
  if (leftover) return <LeftRelay bytesPerSecond={leftover.bytesPerSecond} />;
  return null;
}

/** What a relay says it is carrying, or null when it has not said. */
type Carrying = { bytesPerSecond: number | null };

/** Our own relay's figure and who it is carrying, null when it has not said. */
type OurCarrying = Carrying & {
  letThrough: number | null;
  heardFrom: number | null;
};

const QUIET_PILL =
  "flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground";

const WARM_PILL =
  "flex animate-pulse items-center gap-1.5 rounded-full bg-orange-500/15 px-3 py-1 text-xs font-medium text-orange-600 hover:bg-orange-500/25 motion-reduce:animate-none dark:text-orange-400";

/**
 * The relay carrying the battle this coilbox is hosting, asked once a second
 * while `hosting` is true, and not at all otherwise.
 *
 * `hosting` is the route the last battle opened on, which the hosting form
 * records only once a battle is open and leaving it clears. So an ordinary
 * session never asks, and a relayed one asks for as long as the backend says
 * the relay is there and stops the moment it is not.
 */
function useOurRelay(hosting: boolean): OurCarrying | null {
  const [relay, setRelay] = useState<OurCarrying | null>(null);
  useEffect(() => {
    if (!hosting) {
      setRelay(null);
      return;
    }
    let live = true;
    let asking: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      let answer: Awaited<ReturnType<typeof mpRelayTraffic>> | null = null;
      try {
        answer = await mpRelayTraffic({});
      } catch {
        // Not knowing is not a relay, and a pill on the strength of an error
        // would claim one.
      }
      if (!live) return;
      if (!answer?.relaying) {
        setRelay(null);
        return;
      }
      setRelay({
        bytesPerSecond: answer.bytesPerSecond,
        letThrough: answer.letThrough ?? null,
        heardFrom: answer.heardFrom ?? null,
      });
      asking = setTimeout(ask, ASK_EVERY_MS);
    };
    void ask();
    return () => {
      live = false;
      clearTimeout(asking);
    };
  }, [hosting]);
  return relay;
}

/**
 * A relay running on this machine that this coilbox is not hosting through,
 * kept up to date until it stops.
 *
 * Asked when the pill mounts and again whenever our own relay comes or goes,
 * because a battle that ended with a game still running through it leaves
 * exactly that relay behind. Every second only for as long as the answer is
 * yes. One machine runs one sidecar, so while our own is up there is no other
 * to ask about.
 */
function useRelayLeftRunning(ours: boolean): Carrying | null {
  const [relay, setRelay] = useState<Carrying | null>(null);
  useEffect(() => {
    if (ours) {
      setRelay(null);
      return;
    }
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
  }, [ours]);
  return relay;
}

/**
 * The pill for the battle this coilbox is hosting through the relay, with the
 * way back to it and the way to close it.
 *
 * Closing asks first, in the words the battle room's own Close uses, because it
 * removes everybody in the battle.
 */
function OurRelay({ bytesPerSecond, letThrough, heardFrom }: OurCarrying) {
  const { activeKey } = useMultiplayer();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function choose(next: boolean) {
    setOpen(next);
    if (!next) setConfirming(false);
  }

  async function close() {
    choose(false);
    if (!activeKey) return;
    try {
      await leaveBattle(activeKey);
      navigate("/battles");
    } catch (e) {
      void notify({
        title: "The battle is still open",
        body: `Coilbox could not close it: ${e instanceof Error ? e.message : String(e)}.`,
        level: "error",
      });
    }
  }

  const label = relayCarryingLabel(bytesPerSecond);

  return (
    <Popover open={open} onOpenChange={choose}>
      <PopoverTrigger asChild>
        <button type="button" className={QUIET_PILL}>
          <span aria-hidden className="size-2 rounded-full bg-emerald-500" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        {confirming ? (
          <>
            <p className="text-sm">
              Close this battle? Everyone will be removed and it will disappear
              from the battle list.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={close}>
                Close battle
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm">
              Your battle goes through the server's relay, so players reach it
              through the lobby server rather than connecting to you directly.
            </p>
            {letThrough !== null && heardFrom !== null && (
              <RelayPeers letThrough={letThrough} heardFrom={heardFrom} />
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  choose(false);
                  navigate("/battle");
                }}
              >
                Go to battle
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirming(true)}
              >
                Close
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Who the relay is carrying: how many addresses the lobby named and coilbox let
 * through, and how many players the relay has heard from.
 *
 * The second stays at zero until the game starts, because only the game itself
 * sends through the relay. The window is `QUIET_ENOUGH_TO_RECLAIM` in
 * `coilbox-relay-agent`, which is the engine's own reconnect timeout.
 */
function RelayPeers({
  letThrough,
  heardFrom,
}: {
  letThrough: number;
  heardFrom: number;
}) {
  return (
    <div className="space-y-1">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Addresses let through</dt>
        <dd className="tabular-nums">{letThrough}</dd>
        <dt className="text-muted-foreground">
          Heard from in the last 15 seconds
        </dt>
        <dd className="tabular-nums">{heardFrom}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        Nobody is heard from until the game starts, because only the game itself
        sends through the relay.
      </p>
    </div>
  );
}

/** Which process the leftover relay is, as far as coilbox could read it. */
type Agent = { pid: number | null; ours: boolean } | "unreadable" | null;

/**
 * The pill for a relay an earlier coilbox left running, with the one thing
 * coilbox can safely do about it, which is ask. The agent stops only if no
 * player was ever heard through it, so asking cannot end somebody's match.
 */
function LeftRelay({ bytesPerSecond }: Carrying) {
  const [agent, setAgent] = useState<Agent>(null);
  useEffect(() => {
    let live = true;
    mpLeftoverRelayAgent({})
      .then((found) => {
        if (live) setAgent(found);
      })
      .catch(() => {
        if (live) setAgent("unreadable");
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={WARM_PILL}>
          <span aria-hidden className="size-2 rounded-full bg-orange-500" />
          {relayCarryingLabel(bytesPerSecond)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        {agent === null ? (
          <p className="text-sm text-muted-foreground">Looking for it…</p>
        ) : agent === "unreadable" ? (
          <p className="text-sm">
            Coilbox could not read which process the relay is.
          </p>
        ) : agent.pid === null ? (
          <p className="text-sm">It has stopped.</p>
        ) : (
          <LeftoverRelayAgent pid={agent.pid} ours={agent.ours} />
        )}
      </PopoverContent>
    </Popover>
  );
}
