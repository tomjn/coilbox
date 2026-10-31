import { t } from "@lingui/core/macro";
import { useEffect, useRef } from "react";
import { describeError } from "@/i18n/uiError";
import { notify } from "../notify/notify";
import { type OaProgram, playOaMaps } from "../play/bindings";
import { checkHostAddress } from "./battle/hostAddress";
import { leaveBattle } from "./battle/leaveBattle";
import type { Battle } from "./bindings";
import type { Connections } from "./connections";
import {
  isOaBattle,
  OA_BATTLE_ROOM_SCREEN,
  oaHostArguments,
  oaJoinArguments,
  oaMapArgument,
} from "./oaHost";
import { oaRunBattle, observeOaBattle, startOaRun } from "./oaRun";
import { useOpenAnnihilation } from "./openAnnihilation";
import { protocolForKey } from "./protocol";
import { useMultiplayer, useProtocolServers } from "./store";

/** The Open Annihilation battle the player is in, on a connection that is up. */
interface JoinedOaBattle {
  serverKey: string;
  battle: Battle;
  username: string;
  hosting: boolean;
  hostIngame: boolean;
}

function joinedOaBattle(
  connections: Connections,
  servers: ReturnType<typeof useProtocolServers>,
): JoinedOaBattle | null {
  for (const [serverKey, c] of Object.entries(connections)) {
    const state = c.mirror.state;
    if (!c.live || !c.mirror.connected || state?.currentBattle == null) {
      continue;
    }
    const battle = state.battles[String(state.currentBattle)];
    const username = state.myUsername;
    if (!battle || !username || !isOaBattle(battle)) continue;
    return {
      serverKey,
      battle,
      username,
      hosting: battle.host === username,
      hostIngame:
        protocolForKey(serverKey, servers) === "zerok"
          ? battle.inProgress
          : !!state.users[battle.host]?.status.ingame,
    };
  }
  return null;
}

/**
 * Start Open Annihilation for the battle, and leave the battle when OA is gone.
 *
 * Only what the lobby carries goes to OA. OA's own room does the seating, the
 * map, the rules and readiness. The host's in game flag means its room is up and
 * taking joiners, so it is raised on the battle room screen and not when the
 * process starts. A joiner's means the match is on. Both drop when OA exits.
 *
 * With the lobby connection down there is no battle to leave. The server took
 * the player out when the connection went, so nothing is sent.
 */
async function openOa(
  { serverKey, battle, username, hosting }: JoinedOaBattle,
  program: OaProgram | null,
  setIngame: (ingame: boolean) => void,
  connections: () => Connections,
) {
  const battleId = battle.id;
  const inBattle = () => {
    const c = connections()[serverKey];
    return (
      !!c?.live &&
      c.mirror.connected &&
      c.mirror.state?.currentBattle === battleId
    );
  };
  const leave = (reason: string | null) => {
    if (reason) {
      void notify({
        title: t`Left the Open Annihilation battle`,
        body: reason,
        level: "error",
      });
    }
    if (!inBattle()) return;
    void leaveBattle(serverKey).catch((e) => {
      const why = describeError(e);
      void notify({
        title: t`You are still in the Open Annihilation battle`,
        body: t`Coilbox could not leave it: ${why}.`,
        level: "error",
      });
    });
  };

  const running = oaRunBattle();
  // Back in the battle OA already runs for, after a drop.
  if (running?.serverKey === serverKey && running.battleId === battleId) return;
  if (running) return leave(t`Open Annihilation is already running.`);
  if (!program) {
    return leave(t`Set where Open Annihilation is in Settings first.`);
  }

  let args: string[];
  if (hosting) {
    // The key `--map` takes is not always the name the lobby carries. A list
    // that will not load leaves the lobby's name to be tried as it stands.
    const maps = await playOaMaps({ path: program.path })
      .then((r) => r.maps)
      .catch(() => []);
    if (!inBattle()) return;
    args = oaHostArguments({
      battleId,
      username,
      map: oaMapArgument(battle.map, maps),
      maxPlayers: battle.maxPlayers,
    });
  } else {
    // OA reads no port, so one the lobby left out is not a reason to refuse.
    const verdict = checkHostAddress(battle.ip, Number(battle.port) || 1);
    if (verdict.kind === "blocked") return leave(verdict.reason);
    args = oaJoinArguments({ battleId, username, hostIp: battle.ip });
  }

  let flagRaised = false;
  // A refusal with no line of OA's own, which the run cannot put into words.
  let refusal: string | null = null;
  await startOaRun({
    executable: program.path,
    args,
    battle: { serverKey, battleId },
    onEvent: (event) => {
      // A match that starts without the room screen having been seen still
      // means the host is in game.
      const inGame =
        (event.kind === "match" && event.change === "started") ||
        (hosting &&
          event.kind === "screen" &&
          event.name === OA_BATTLE_ROOM_SCREEN);
      if (inGame && !flagRaised) {
        flagRaised = true;
        setIngame(true);
      }
      if (event.kind === "exit" && event.reason === "refused") {
        refusal =
          event.message ??
          (hosting
            ? t`Open Annihilation refused to open this battle.`
            : t`Open Annihilation refused to join this battle.`);
      }
    },
    onEnd: (error) => {
      if (flagRaised) setIngame(false);
      leave(refusal ?? error);
    },
  });
}

/**
 * Renders nothing. An Open Annihilation battle has no room page (issue #4972),
 * so this runs whatever page is showing and is what connects a lobby battle to
 * OA. Being in the battle starts OA, at once for the host and when the host goes
 * in game for a joiner, who waits on the battle list with no time limit: the row
 * says so and Leave is there. OA ending leaves the battle, and leaving the battle
 * ends OA.
 *
 * `started` stops a battle OA has just exited, whose leave has not landed, from
 * starting OA again. A leave that fails also stays out, and the row's Leave is
 * the way to try again.
 */
export function OaBattleKeeper() {
  const { connections, setIngame } = useMultiplayer();
  const servers = useProtocolServers();
  const [program] = useOpenAnnihilation();
  const latest = useRef(connections);
  const started = useRef<string | null>(null);

  useEffect(() => {
    latest.current = connections;
    // Read from every connection rather than the focused one, because a battle
    // can be on another connection (issue #2844). A drop or a reconnect is not a
    // leave: OA's game does not use this connection.
    observeOaBattle((serverKey) => {
      const c = connections[serverKey];
      return c
        ? {
            connected: c.live && c.mirror.connected,
            battleId: c.mirror.state?.currentBattle ?? null,
          }
        : null;
    });

    const joined = joinedOaBattle(connections, servers);
    if (!joined) {
      started.current = null;
      return;
    }
    const key = `${joined.serverKey}:${joined.battle.id}`;
    if (started.current === key) return;
    // With no OA there is nothing to wait for. The row keeps a player out, and
    // a link or a followed player is turned back here.
    if (program && !joined.hosting && !joined.hostIngame) return;
    started.current = key;
    void openOa(joined, program, setIngame, () => latest.current);
  }, [connections, servers, program, setIngame]);

  return null;
}
