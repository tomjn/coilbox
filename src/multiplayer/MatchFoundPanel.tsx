import { Button } from "@picoframe/frame";
import { useEffect, useRef, useState } from "react";
import { usePreferredTarget } from "@/play/config";
import { notify } from "../notify/notify";
import { useBattleLaunch } from "./battle/useBattleLaunch";
import { mpMatchmakingCancel, mpMatchmakingReady } from "./bindings";
import { countdown, searchingIn, secondsLeft } from "./matchmaking";
import { triggerAttention } from "./ringEffect";
import { useMultiplayer } from "./store";

/**
 * The match the server has found, wherever the user happens to be, and the
 * launch that follows accepting it.
 *
 * Both have to be app-level. A found match runs on a countdown and everybody in
 * it has to accept before it expires, so a panel that only appeared on the
 * matchmaking screen would be missed by anyone who had wandered off. And a
 * matchmaking match has no lobby behind it, so the battle room, which is what
 * launches a lobby's match, is never on screen to do it.
 *
 * The attention cue is the autohost ring's, for the same reason it exists there:
 * the user may be behind another window, and the OS flash is what reaches them.
 *
 * The launch only runs while we are in no lobby. In one, the battle room owns it
 * and is watching the same signal, so this would start a second engine.
 *
 * The work is in the inner component so that resolving an engine to launch with,
 * which loads the content state, only happens on a connection that has
 * matchmaking rather than on every app start.
 */
export function MatchFoundPanel() {
  const { activeKey, protocol } = useMultiplayer();
  if (!activeKey || protocol !== "tachyon") return null;
  return <Panel serverKey={activeKey} />;
}

function Panel({ serverKey }: { serverKey: string }) {
  const { mirror } = useMultiplayer();
  const state = mirror.state;
  const found = state?.matchmaking.found ?? null;
  const inLobby = state?.currentBattle != null;
  const { target } = usePreferredTarget();
  const { launch } = useBattleLaunch(serverKey, target, false);

  // Once per match found, rather than on every snapshot the countdown causes.
  const rungFor = useRef<string | null>(null);
  useEffect(() => {
    if (!found) {
      rungFor.current = null;
      return;
    }
    const id = `${found.queueId}:${found.readyBy}`;
    if (rungFor.current === id) return;
    rungFor.current = id;
    triggerAttention("A match has been found. Accept it to play.");
    void notify({
      title: "Match found",
      body: "Accept it before the countdown runs out.",
    });
  }, [found]);

  // The server has told us where the match is. In a lobby the battle room
  // launches it. Out of one, which is every match matchmaking makes, nothing
  // else would.
  const startSeq = mirror.battleStartSeq;
  const launched = useRef(startSeq);
  useEffect(() => {
    if (launched.current === startSeq) return;
    launched.current = startSeq;
    if (inLobby || !target) return;
    launch().catch(() => {});
  }, [startSeq, inLobby, target, launch]);

  if (!found) return null;
  const key = serverKey;
  const queue =
    state?.matchmaking.queues.find((q) => q.id === found.queueId)?.name ??
    found.queueId;

  return (
    <div
      role="alertdialog"
      aria-label="A match has been found"
      className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-border bg-card p-4 shadow-lg"
    >
      <p className="text-sm font-semibold">Match found: {queue}</p>
      <Remaining readyBy={found.readyBy} />
      {found.readied ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Waiting for the other players
          {found.readyCount > 0 ? `, ${found.readyCount} so far` : ""}.
        </p>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button
            onClick={() =>
              mpMatchmakingReady({ serverKey: key }).catch(() => {})
            }
          >
            Accept
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              mpMatchmakingCancel({ serverKey: key }).catch(() => {})
            }
          >
            Turn down
          </Button>
        </div>
      )}
      <StillSearching />
    </div>
  );
}

/** The countdown to the deadline the server set, ticking once a second. */
function Remaining({ readyBy }: { readyBy: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
      {countdown(secondsLeft(readyBy, now))} left to accept
    </p>
  );
}

/**
 * The other queues the search is still running in, which a found match does not
 * take us out of.
 */
function StillSearching() {
  const { mirror } = useMultiplayer();
  const matchmaking = mirror.state?.matchmaking;
  if (!matchmaking) return null;
  const others = searchingIn({
    ...matchmaking,
    searching: matchmaking.searching.filter(
      (id) => id !== matchmaking.found?.queueId,
    ),
  });
  if (others.length === 0) return null;
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      Still searching in {others.join(", ")}.
    </p>
  );
}
