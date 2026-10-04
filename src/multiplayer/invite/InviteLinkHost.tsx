import { Button } from "@picoframe/frame";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { SlideDrawer } from "@/components/SlideDrawer";
import { BATTLE_PASSWORD_REFUSAL, battleKeyFor } from "../../deeplink/parse";
import {
  allServers,
  useCustomServers,
  useLastLogin,
  useLobbyAccounts,
} from "../../lobby-servers/config";
import { requestDrawer } from "../../lobby-servers/drawerRequest";
import { notify } from "../../notify/notify";
import { battleRoomHref } from "../battle/battleRoomKey";
import { leaveBattle } from "../battle/leaveBattle";
import { joinBattle } from "../battles/joinBattle";
import {
  leavesBattleNotice,
  otherBattleKey,
  roomLeaveIsStale,
} from "../battles/oneBattle";
import type { Connections } from "../connections";
import { protocolForKey } from "../protocol";
import { serverNameFor, useMultiplayer, useProtocolServers } from "../store";
import {
  type InviteConnection,
  type InviteLink,
  type InviteOffer,
  intentStep,
  inviteOffer,
  newIntent,
} from "./inviteOffer";
import {
  closeInvitePrompt,
  setInviteIntent,
  useInviteState,
} from "./inviteStore";

/** The lobby servers settings page, which holds the login and server forms. */
const LOGIN_SCREEN = "/settings/lobby-servers";

/** Every connection, as much of it as the invite decision reads. */
function inviteConnections(
  connections: Connections,
  busyKeys: ReadonlySet<string>,
): InviteConnection[] {
  return Object.values(connections).map((c) => ({
    serverKey: c.serverKey,
    direct: c.direct,
    live: c.live,
    opening: !c.live && busyKeys.has(c.serverKey),
    ready: c.mirror.phase === "ready",
    inBattle: c.mirror.state?.currentBattle != null,
  }));
}

/** A battle's row on the battle list, where a join can be finished by hand. */
function battleRowHref(serverKey: string, battle: number): string {
  return `/battles?server=${encodeURIComponent(serverKey)}&battle=${battle}`;
}

/** The label of the button that carries an offer out. */
function actionLabel(offer: InviteOffer, andJoin: boolean): string | null {
  switch (offer.kind) {
    case "join":
      return andJoin ? "Join battle" : null;
    case "connect":
      return `Connect as ${offer.account.username}${andJoin ? " and join" : ""}`;
    case "login":
      return "Open the login screen";
    case "unknown":
      return "Add this server";
  }
}

/**
 * The far end of a `coilbox://join` link (issue #3382): the question the player
 * is asked, and the join that follows once they have answered it.
 *
 * A link is written by whoever sent it, so arriving does nothing but open a
 * drawer. The drawer shows the server's address in the form it will be dialled
 * in and says what the button does. Nothing connects, looks a name up or reads
 * a saved password until that button is pressed, and that holds for a server
 * the player has a saved login for as much as for one coilbox has never seen.
 *
 * Pressing it holds the join until its server is logged in to, shown in a
 * card in the corner for as long as it is held. The card is how the player
 * cancels it, and how they connect once they have added a login. The join is
 * made through `joinBattle`, the same as from the battle list.
 *
 * Mounted once, inside the multiplayer provider and the router.
 */
export function InviteLinkHost() {
  const { prompt, intent } = useInviteState();
  const navigate = useNavigate();
  const {
    connections,
    activeKey,
    busyKeys,
    connect,
    openLoginPopover,
    clearJoinError,
  } = useMultiplayer();
  const [accountsCfg] = useLobbyAccounts();
  const [customCfg] = useCustomServers();
  const [lastLogin] = useLastLogin();
  const protocolServers = useProtocolServers();
  // The catalog a login is made against, so a server the distribution profile
  // leaves out is not a known server here either.
  const servers = useMemo(
    () => allServers(customCfg.servers),
    [customCfg.servers],
  );
  const conns = useMemo(
    () => inviteConnections(connections, busyKeys),
    [connections, busyKeys],
  );
  // Why the last press could not connect, shown on the card.
  const [error, setError] = useState<string | null>(null);
  // A join that has been sent and has not landed yet.
  const [landing, setLanding] = useState<{
    serverKey: string;
    battle: number;
  } | null>(null);

  const offerFor = (link: InviteLink) =>
    inviteOffer(link, servers, accountsCfg.accounts, lastLogin, conns);

  /** Carry out an offer the player has just pressed the button for. */
  function act(link: InviteLink, offer: InviteOffer) {
    setError(null);
    setInviteIntent(
      newIntent(link, conns, "leavesKey" in offer ? offer.leavesKey : null),
    );
    if (offer.kind === "connect") {
      connect(offer.server, offer.account.username).catch((e) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
    } else if (offer.kind === "login") {
      // A saved login that cannot connect in one press is in the topbar's
      // list, which is where a browser sign-in is started from. With none
      // saved, the add login form opens on this server.
      if (offer.account) openLoginPopover();
      else {
        requestDrawer({ kind: "login", serverId: offer.server.id });
        navigate(LOGIN_SCREEN);
      }
    } else if (offer.kind === "unknown") {
      requestDrawer({ kind: "server", host: offer.host, port: offer.port });
      navigate(LOGIN_SCREEN);
    }
  }

  // Finish a held join once its server is logged in to, or drop it.
  useEffect(() => {
    if (!intent) return;
    const step = intentStep(intent, conns);
    if (step.kind === "wait") return;
    setInviteIntent(null);
    const { link } = intent;
    if (step.kind === "elsewhere") {
      void notify({
        title: "Invite dropped",
        body: `You logged in to another server, so coilbox did not join battle ${link.battle} on ${link.address}. Open the link again to join it.`,
      });
      return;
    }
    const { serverKey } = step;
    const state = connections[serverKey]?.mirror.state;
    const name = serverNameFor(serverKey, protocolServers);
    const battle = state?.battles[String(link.battle)];
    if (!state || !battle) {
      void notify({
        title: "The battle has gone",
        body: `Battle ${link.battle} is no longer open on ${name}.`,
        level: "error",
      });
      return;
    }
    if (state.currentBattle === battle.id) {
      navigate(battleRoomHref(serverKey));
      return;
    }
    if (state.currentBattle != null) {
      void notify({
        title: "You are in another battle",
        body: `Leave your battle on ${name}, then join this one from the battle list.`,
      });
      navigate(battleRowHref(serverKey, battle.id));
      return;
    }
    if (battle.passworded && !link.password) {
      void notify({
        title: "This battle needs a password",
        body: "Enter it on the battle's row to join.",
      });
      navigate(battleRowHref(serverKey, battle.id));
      return;
    }
    // The password rule is the saved server entry's, never the link's, so a
    // link cannot claim a protocol to get a looser one (issue #3524).
    const key =
      link.password === undefined
        ? undefined
        : battleKeyFor(
            protocolForKey(serverKey, protocolServers),
            link.password,
          );
    if (key === null) {
      void notify({
        title: "This battle's password cannot be sent",
        body: `${BATTLE_PASSWORD_REFUSAL} Enter it on the battle's row to join.`,
        level: "error",
      });
      navigate(battleRowHref(serverKey, battle.id));
      return;
    }
    // Only the battle the player was told about is left. One joined since the
    // press was never agreed to, so that join is left for the battle list,
    // which asks.
    const other = otherBattleKey(connections, activeKey, serverKey);
    if (roomLeaveIsStale(intent.leavesKey, other)) {
      void notify({
        title: "You are in another battle",
        body: `${leavesBattleNotice(serverNameFor(other ?? "", protocolServers), "join")} Join from the battle list to go ahead.`,
      });
      navigate(battleRowHref(serverKey, battle.id));
      return;
    }
    void joinBattle({
      serverKey,
      battle,
      key: key || undefined,
      leaveOther: async () => {
        if (other) await leaveBattle(other);
      },
      awaitLanding: () => {
        clearJoinError(serverKey);
        setLanding({ serverKey, battle: battle.id });
      },
      giveUp: () => setLanding(null),
    });
  }, [
    intent,
    conns,
    connections,
    activeKey,
    protocolServers,
    navigate,
    clearJoinError,
  ]);

  // Take the player to the battle room when the join lands, or say why it
  // did not.
  useEffect(() => {
    if (!landing) return;
    const connection = connections[landing.serverKey];
    if (!connection?.live) {
      setLanding(null);
      return;
    }
    if (connection.mirror.state?.currentBattle === landing.battle) {
      setLanding(null);
      navigate(battleRoomHref(landing.serverKey));
      return;
    }
    const refused = connection.mirror.lastJoinError;
    if (refused) {
      setLanding(null);
      void notify({
        title: "Could not join the battle",
        body: refused,
        level: "error",
        to: "/battles",
      });
    }
  }, [landing, connections, navigate]);

  const offer = prompt ? offerFor(prompt) : null;
  const waiting = intent ? offerFor(intent.link) : null;
  const waitingLabel = waiting ? actionLabel(waiting, false) : null;

  return (
    <>
      <SlideDrawer
        open={prompt !== null}
        title="Join a battle"
        onClose={closeInvitePrompt}
      >
        {prompt && offer && (
          <InvitePrompt
            link={prompt}
            offer={offer}
            leaves={
              "leavesKey" in offer && offer.leavesKey
                ? leavesBattleNotice(
                    serverNameFor(offer.leavesKey, protocolServers),
                    "join",
                  )
                : null
            }
            onAct={() => act(prompt, offer)}
            onCancel={closeInvitePrompt}
          />
        )}
      </SlideDrawer>
      {intent &&
        waiting &&
        createPortal(
          <div
            role="status"
            className="fixed bottom-4 right-4 z-30 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-md border border-border bg-background p-3 text-sm shadow-lg"
          >
            <p className="font-medium">Invite waiting</p>
            <p className="text-muted-foreground">
              Coilbox joins battle {intent.link.battle} once you are logged in
              to{" "}
              <code className="break-all text-foreground">
                {intent.link.address}
              </code>
              .
            </p>
            {waiting.kind === "join" && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Logging in
              </p>
            )}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInviteIntent(null)}
              >
                Cancel invite
              </Button>
              {waitingLabel && (
                <Button size="sm" onClick={() => act(intent.link, waiting)}>
                  {waitingLabel}
                </Button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * What an invite link is asking for, and the one button that agrees to it.
 * The address is always shown, in the form it is compared and dialled in, and
 * a server coilbox has no entry for is said to be one.
 */
function InvitePrompt({
  link,
  offer,
  leaves,
  onAct,
  onCancel,
}: {
  link: InviteLink;
  offer: InviteOffer;
  leaves: string | null;
  onAct: () => void;
  onCancel: () => void;
}) {
  const name =
    offer.kind === "join"
      ? offer.serverName
      : offer.kind === "unknown"
        ? null
        : offer.server.name;
  return (
    <>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm">
        <p>
          This link is an invite to battle {link.battle}
          {name ? ` on ${name}` : ""}.
        </p>
        <div>
          <p className="text-xs text-muted-foreground">Server address</p>
          <code className="break-all font-mono text-base">{link.address}</code>
        </div>
        {offer.kind === "unknown" && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              Coilbox does not know this server. It is not in your server list,
              and none of your saved logins are for it. Check the address before
              you go on, and do not give it a password you use elsewhere.
            </span>
          </p>
        )}
        <p className="text-muted-foreground">
          {offer.kind === "join" &&
            (offer.ready
              ? "You are logged in to this server."
              : "You are logging in to this server. Coilbox joins the battle once you are in.")}
          {offer.kind === "connect" &&
            `Coilbox has not connected to it. It will log in as ${offer.account.username}, with the password saved for this server, and then join the battle.`}
          {offer.kind === "login" &&
            "Coilbox has not connected to it. The login screen opens for this server, and coilbox joins the battle once you are logged in."}
          {offer.kind === "unknown" &&
            "Coilbox has not connected to it. The add server form opens with this address filled in. Nothing connects until you add the server and log in, and coilbox joins the battle once you have."}
        </p>
        {link.password && (
          <p className="text-muted-foreground">
            The link carries a password for the battle, which is sent to this
            server when you join.
          </p>
        )}
        {leaves && <p>{leaves}</p>}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onAct}>
          {actionLabel(offer, true)}
        </Button>
      </footer>
    </>
  );
}
