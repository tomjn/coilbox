/**
 * "Host against the computer", as shown in the frame's drawer: a room on this
 * computer with you against the game's standard AI, started without a form.
 *
 * The drawer is the progress and the error surface. A room needs the game's and
 * the map's checksums before it can open a battle, and reading them is the wait,
 * so the drawer says so while it happens and starts the room itself as soon as
 * they are in. The game and map are the first the content list offers, the same
 * start a new skirmish setup has, and the AI is the game's standard one (see
 * `quickRoomDraft`). Anything the host wants to choose is in "Host on LAN".
 *
 * Like the form, it holds its own busy and failed states, because the drawer is
 * handed an element and keeps it.
 */

import { Button } from "@picoframe/frame";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { hostEngineVersion } from "../multiplayer/battles/hostEngineVersion";
import { leaveAndLabel } from "../multiplayer/battles/oneBattle";
import {
  hashFailureMessage,
  useHostContent,
} from "../multiplayer/battles/useHostContent";
import type { StartRoomArgs } from "./HostRoomForm";
import { hostingRoute, recordHostingRoute } from "./hostingRoute";
import {
  DEFAULT_ROOM_MAX_PLAYERS,
  DEFAULT_ROOM_PORT,
  playerNameProblem,
} from "./room";
import { quickRoomDraft } from "./roomSeed";
import { roomBattleArgs } from "./startRoomArgs";

export function QuickRoom({
  blocked,
  leaves = null,
  defaultName,
  onStart,
}: {
  /** Why hosting is unavailable, or null when it is available. */
  blocked: string | null;
  /** What entering leaves behind under the one-battle rule (issue #2844), or
   *  null. Starting waits for the host to confirm leaving it. */
  leaves?: string | null;
  /** The name to host under, usually their last lobby login. */
  defaultName?: string;
  onStart: (args: StartRoomArgs) => Promise<string | undefined>;
}) {
  const content = useHostContent();
  const name = (defaultName ?? "Player").trim();
  const nameProblem = playerNameProblem(name);
  // A room that leaves something behind waits for a yes.
  const [confirmed, setConfirmed] = useState(!leaves);
  const [error, setError] = useState<string | null>(null);
  // Bumped by "Try again" so the start effect runs once more.
  const [attempt, setAttempt] = useState(0);
  const started = useRef(false);

  const target = content.target;
  const ready = content.ready;
  const { gameName, mapName, modhash, maphash } = content;
  const latestStart = useRef(onStart);
  latestStart.current = onStart;

  const canRun =
    !blocked && !nameProblem && !content.noEngine && confirmed && ready;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only re-runs the effect
  useEffect(() => {
    if (!canRun || started.current || !target) return;
    started.current = true;
    setError(null);
    (async () => {
      try {
        const version = await hostEngineVersion(target);
        // Nothing was measured, so the route is the one a room with no router
        // mapping has, exactly as in the form with its reachability box unticked.
        const route = hostingRoute(null, false, "auto");
        const key = await latestStart.current({
          host: name,
          port: DEFAULT_ROOM_PORT,
          advertise: true,
          approveJoins: false,
          publicAddress: null,
          battle: roomBattleArgs({
            password: "",
            maxPlayers: DEFAULT_ROOM_MAX_PLAYERS,
            title: "",
            host: name,
            route,
            version,
            gameName,
            mapName,
            modhash,
            maphash,
          }),
          draft: quickRoomDraft(gameName, mapName),
        });
        if (key) recordHostingRoute(key, route);
        // Left open on success, as the form does. Landing in the battle room
        // closes every drawer.
      } catch (e) {
        started.current = false;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [canRun, target, name, gameName, mapName, modhash, maphash, attempt]);

  if (blocked) {
    return <p className="text-sm text-muted-foreground">{blocked}</p>;
  }
  if (content.noEngine) {
    return (
      <p className="text-sm text-muted-foreground">
        No engine found. Add a content folder with an engine in{" "}
        <Link
          className="font-medium underline underline-offset-4"
          to="/settings/content-folders"
        >
          Settings → Content folders
        </Link>{" "}
        first.
      </p>
    );
  }
  if (nameProblem) {
    return (
      <p className="text-sm text-muted-foreground">
        {nameProblem} Use Host on LAN to pick a name.
      </p>
    );
  }
  if (!confirmed) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">{leaves}</p>
        <div className="flex justify-end">
          <Button className="h-9" onClick={() => setConfirmed(true)}>
            {leaveAndLabel("host")}
          </Button>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <p
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"
        >
          {error}
        </p>
        <p className="text-xs text-muted-foreground">
          Host on LAN lets you pick another port.
        </p>
        <div className="flex justify-end">
          <Button
            className="h-9"
            onClick={() => {
              setError(null);
              started.current = false;
              setAttempt((a) => a + 1);
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (content.gameFailed || content.mapFailed) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {content.gameFailed
          ? hashFailureMessage(
              "game",
              content.gameInfo.status,
              content.gameInfo.info?.errors?.[0],
            )
          : hashFailureMessage(
              "map",
              content.mapInfo.status,
              content.mapInfo.info?.errors?.[0],
            )}
      </p>
    );
  }
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {ready
        ? `Starting a room for you and the computer on ${mapName}.`
        : "Reading the game and the map."}
    </p>
  );
}
