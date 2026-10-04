import { Button } from "@picoframe/frame";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { notify } from "../../notify/notify";
import { battleRoomHref } from "../battle/battleRoomKey";
import { isBattleRunning } from "../battles/battleFilters";
import { JoinBattlePopover } from "../battles/JoinBattlePopover";
import { joinBattle } from "../battles/joinBattle";
import { useOneBattleRule } from "../battles/oneBattle";
import type { FriendStatus } from "../friendsAcrossServers";
import { useConnection, useMultiplayer } from "../store";
import { friendBattleAction } from "./friendBattleAction";

/**
 * Join or Watch for the battle a friend is in, on the friend's row. Renders
 * nothing when there is nothing to offer (see `friendBattleAction`).
 *
 * Pressing it uses the battle list's own join (`joinBattle`) and then goes to
 * the battle room when the join lands, which is where a missing game or map is
 * downloaded and where a running battle is watched. A refused join is reported
 * as a notification, because the Battles page's error banner is not on screen.
 *
 * A passworded battle, or one that leaves a battle on another server, asks
 * first in the same popover the battle list uses.
 */
export function FriendBattleButton({
  serverKey,
  status,
  battleId,
}: {
  serverKey: string;
  status: FriendStatus;
  battleId: number;
}) {
  const connection = useConnection(serverKey);
  const { busy, clearJoinError } = useMultiplayer();
  const rule = useOneBattleRule(serverKey);
  const navigate = useNavigate();
  const [waiting, setWaiting] = useState(false);
  const [open, setOpen] = useState(false);

  const mirror = connection?.mirror;
  const state = mirror?.state;
  const joinedId = state?.currentBattle ?? null;
  const joinError = mirror?.lastJoinError ?? null;

  // Once the join has been sent, the server's answer is the next thing to see:
  // a battle we are in sends us to its room, a refusal says why.
  useEffect(() => {
    if (!waiting) return;
    if (joinedId != null) {
      setWaiting(false);
      navigate(battleRoomHref(serverKey));
    } else if (joinError) {
      setWaiting(false);
      void notify({
        title: "Could not join the battle",
        body: joinError,
        level: "error",
      });
    }
  }, [waiting, joinedId, joinError, navigate, serverKey]);

  const battle = state?.battles[String(battleId)];
  if (!battle) return null;
  const action = friendBattleAction({
    status,
    battle,
    running: isBattleRunning(battle, state?.users),
    session: { ready: mirror?.phase === "ready", busy, joinedId },
  });
  if (!action) return null;

  const leaves = rule.notice("join");
  const join = (key?: string) =>
    joinBattle({
      serverKey,
      battle,
      key,
      leaveOther: rule.leaveOther,
      awaitLanding: () => {
        clearJoinError(serverKey);
        setWaiting(true);
      },
      giveUp: () => setWaiting(false),
    });
  const title =
    action.reason ??
    (action.kind === "watch"
      ? "Joins the battle, where you can watch the running game"
      : undefined);
  const asks = !action.disabled && (action.asksPassword || !!leaves);

  if (asks) {
    return (
      <JoinBattlePopover
        title={battle.title}
        disabled={waiting}
        onSubmit={(key) => join(action.asksPassword ? key : undefined)}
        open={open}
        onOpenChange={setOpen}
        needsPassword={action.asksPassword}
        notice={leaves}
        triggerLabel={action.label}
      />
    );
  }
  return (
    <Button
      className="h-6 px-2 text-xs"
      disabled={action.disabled || waiting}
      title={title}
      aria-label={`${action.label} ${battle.title}`}
      onClick={() => join()}
    >
      {action.label}
    </Button>
  );
}
