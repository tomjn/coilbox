import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { notify } from "../notify/notify";
import { battleRoomHref } from "./battle/battleRoomKey";
import { serverNameFor, useMultiplayer, useProtocolServers } from "./store";

/**
 * Zero-K's offer to put a player back in a match they dropped out of (issue
 * #4198), wherever the player happens to be when it arrives.
 *
 * The server sends it at login and has already put the player back in the
 * match's battle room. Accepting goes to that room and asks it to request the
 * match (see `BattleRoomPage`), because the room is what launches the engine
 * when the server answers. Asking from here would send the answer to a page that
 * is not on screen. Dismissing sends nothing: the room's own button still gets
 * the player back in while the match runs.
 */
export function RejoinOfferPanel() {
  const { connections } = useMultiplayer();
  const offered = Object.values(connections).filter(
    (entry) => entry.live && entry.mirror.rejoinOffer != null,
  );
  if (offered.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-3">
      {offered.map((entry) => (
        <Offer key={entry.serverKey} serverKey={entry.serverKey} />
      ))}
    </div>
  );
}

function Offer({ serverKey }: { serverKey: string }) {
  const { t } = useLingui();
  const { connections } = useMultiplayer();
  const servers = useProtocolServers();
  const navigate = useNavigate();
  const offer = connections[serverKey]?.mirror.rejoinOffer ?? null;
  // The offer object answered already. A new offer is a new object, so it shows
  // again even when it names the same battle.
  const [answered, setAnswered] = useState<object | null>(null);

  const told = useRef<object | null>(null);
  useEffect(() => {
    if (!offer || told.current === offer) return;
    told.current = offer;
    void notify({
      title: t`You are still in a match`,
      body: t`Rejoin it or leave the other players without you.`,
    });
  }, [offer, t]);

  if (!offer || answered === offer) return null;
  const name = serverNameFor(serverKey, servers);

  return (
    <div
      role="alertdialog"
      aria-label={t`You are still in a running match`}
      className="w-80 rounded-lg border border-border bg-card p-4 shadow-lg"
    >
      <p className="text-sm font-semibold">
        <Trans>You are still in a match</Trans>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        <Trans>
          You left a match on {name} that is still running. Rejoin it, or leave
          your team a player short.
        </Trans>
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          onClick={() => {
            setAnswered(offer);
            navigate(battleRoomHref(serverKey), {
              state: { rejoinBattleId: offer.battleId },
            });
          }}
        >
          <Trans>Rejoin</Trans>
        </Button>
        <Button variant="secondary" onClick={() => setAnswered(offer)}>
          <Trans>Dismiss</Trans>
        </Button>
      </div>
    </div>
  );
}
