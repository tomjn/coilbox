import { Button, cn } from "@picoframe/frame";
import { Footprints, TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { notify } from "../../notify/notify";
import { battleRoomHref } from "../battle/battleRoomKey";
import { leaveBattle } from "../battle/leaveBattle";
import { isBattleRunning } from "../battles/battleFilters";
import { joinBattle } from "../battles/joinBattle";
import { useOneBattleRule } from "../battles/oneBattle";
import { FriendBattleButton } from "../chat/FriendBattleButton";
import { userPresence } from "../chat/presence";
import { useFavourites } from "../friends";
import { battleOf, isFriendOn } from "../friendsAcrossServers";
import {
  serverNameFor,
  useConnection,
  useMultiplayer,
  useProtocolServers,
  usernameFromKey,
} from "../store";
import {
  type FollowBlock,
  type FollowStop,
  FRESH_FOLLOW,
  followBlock,
  followStep,
} from "./followStep";
import { type Follow, setFollow, useFollow } from "./followStore";

const STOPPED: Record<FollowStop, string> = {
  disconnected: "You are no longer connected to their server.",
  unfriended: "They are no longer one of your friends.",
  leftByHand: "You left their battle.",
};

const BLOCKED: Record<Exclude<FollowBlock, "passworded">, string> = {
  locked: "Their battle is locked.",
  full: "Their battle is full.",
};

/**
 * Follows the friend in the follow store: joins the battle they join and leaves
 * it when they do (issue #3696). What to do is `followStep`'s to decide. This
 * reads the friend's connection, hands it over and carries out the answer.
 */
function useFollowDriver(follow: Follow | null): FollowBlock | null {
  const serverKey = follow?.serverKey ?? null;
  const name = follow?.name ?? null;
  const connection = useConnection(serverKey);
  const { busy, clearJoinError } = useMultiplayer();
  const { leaveOther } = useOneBattleRule(serverKey);
  const [favourites] = useFavourites();
  const navigate = useNavigate();

  const mirror = connection?.mirror;
  const state = mirror?.state ?? null;
  const ready = mirror?.phase === "ready" && state != null;
  const target = state && name ? (battleOf(state, name)?.id ?? null) : null;
  const battle = target != null ? state?.battles[String(target)] : undefined;
  const mine = state?.currentBattle ?? null;
  const me = state?.myUsername ?? null;
  const joinError = mirror?.lastJoinError ?? null;

  const now = {
    connected: connection?.live ?? false,
    ready,
    friend:
      serverKey != null &&
      name != null &&
      isFriendOn(favourites, serverKey, state, name),
    playing: (me != null && state?.users[me]?.status.ingame) ?? false,
    busy,
    target,
    mine,
    battle: battle ?? null,
    running: battle ? isBattleRunning(battle, state?.users) : false,
  };

  // The memo belongs to one follow, so a new one starts it again.
  const memo = useRef(FRESH_FOLLOW);
  const followed = useRef<Follow | null>(null);
  /** The battle a join has been sent for and has not been answered. */
  const waiting = useRef<number | null>(null);

  // Runs after every render and leaves it to `followStep` to say whether
  // anything changed. Its memo is what makes each action happen once.
  useEffect(() => {
    if (followed.current !== follow) {
      followed.current = follow;
      memo.current = FRESH_FOLLOW;
      waiting.current = null;
    }
    if (!follow || !serverKey || !name) return;
    const step = followStep(memo.current, now);
    memo.current = step.memo;
    const action = step.action;

    if (action.kind === "stop") {
      setFollow(null);
      void notify({
        title: `Stopped following ${name}`,
        body: STOPPED[action.reason],
      });
    } else if (action.kind === "leave") {
      leaveBattle(serverKey).catch((e) => {
        void notify({
          title: `Could not leave the battle ${name} left`,
          body: e instanceof Error ? e.message : String(e),
          level: "error",
        });
      });
    } else if (action.kind === "blocked") {
      void notify(
        action.reason === "passworded"
          ? {
              title: `${name} is in a battle with a password`,
              body: "Enter it from the follow button in the top bar.",
            }
          : {
              title: `Could not follow ${name} into their battle`,
              body: BLOCKED[action.reason],
              level: "warning",
            },
      );
    } else if (action.kind === "join" && battle) {
      void joinBattle({
        serverKey,
        battle,
        leaveOther,
        awaitLanding: () => {
          clearJoinError(serverKey);
          waiting.current = battle.id;
        },
        giveUp: () => {
          waiting.current = null;
        },
      });
    }
  });

  // The server's answer to a join this sent: a battle we are in opens its room,
  // as a join from the battle list does, and a refusal says why.
  useEffect(() => {
    if (waiting.current == null || !serverKey || !name) return;
    if (mine === waiting.current) {
      waiting.current = null;
      void notify({
        title: `Followed ${name} into their battle`,
        to: battleRoomHref(serverKey),
      });
      navigate(battleRoomHref(serverKey));
    } else if (joinError) {
      waiting.current = null;
      void notify({
        title: `Could not follow ${name} into their battle`,
        body: joinError,
        level: "error",
      });
    }
  }, [mine, joinError, serverKey, name, navigate]);

  return follow && ready ? followBlock(now) : null;
}

/** What the panel says about a battle the player could not be moved into. */
const WHY_NOT: Record<FollowBlock, string> = {
  passworded:
    "It has a password, so you were not moved. Enter the password to join them.",
  locked: "It is locked, so you were not moved. You join if it is unlocked.",
  full: "It is full, so you were not moved. You join when there is space.",
};

/**
 * The top bar's sign that a friend is being followed, and the way to stop.
 * Draws nothing while nobody is followed. It is mounted the whole time, which
 * is why the follow itself runs from here: whichever page is showing, the
 * player still moves with their friend.
 */
export default function FollowIndicator() {
  const follow = useFollow();
  const blocked = useFollowDriver(follow);
  const connection = useConnection(follow?.serverKey);
  const servers = useProtocolServers();
  if (!follow) return null;

  const { serverKey, name } = follow;
  const state = connection?.mirror.state ?? null;
  const battle = state ? battleOf(state, name) : null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
            blocked
              ? "bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-400"
              : "bg-sky-500/15 text-sky-600 hover:bg-sky-500/25 dark:text-sky-400",
          )}
        >
          {blocked ? (
            <TriangleAlert aria-hidden className="size-3.5" />
          ) : (
            <Footprints aria-hidden className="size-3.5" />
          )}
          {blocked ? `Cannot follow ${name}` : `Following ${name}`}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Following {name}</p>
          <p className="text-xs text-muted-foreground">
            As {usernameFromKey(serverKey)} on{" "}
            {serverNameFor(serverKey, servers)}. You join the battles they join
            and leave when they leave.
          </p>
        </div>
        <p className="text-sm">
          {battle
            ? `In ${battle.title || `battle ${battle.id}`}`
            : "Not in a battle"}
        </p>
        {blocked && (
          <p
            role="status"
            className="text-sm text-amber-700 dark:text-amber-400"
          >
            {WHY_NOT[blocked]}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {battle && state && (
            <FriendBattleButton
              serverKey={serverKey}
              status={userPresence(state, name)}
              battleId={battle.id}
            />
          )}
          <Button variant="secondary" size="sm" onClick={() => setFollow(null)}>
            Unfollow
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
