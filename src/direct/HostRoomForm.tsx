/**
 * The "Host on LAN" form, as shown in the frame's drawer.
 *
 * It was a popover and did not fit in one: a room asks about a name, a game, a
 * map, a size, a port, a password and three toggles, and a popover is bounded by
 * whatever space Radix finds between the trigger and the edge of the window, so
 * the last third of the form was behind a scrollbar inside a floating panel
 * (issue #1586). A drawer is full height, which is the height this asks for.
 *
 * The drawer keeps whatever element it was opened with, so nothing here may
 * depend on a prop that changes while it is open. That is why the submission's
 * own busy and failed states are held here rather than passed in: the form is
 * the only thing that needs them, and it always knows them first hand.
 */

import { Button, Input, useDrawer } from "@picoframe/frame";
import { useState } from "react";
import { Link } from "react-router";
import { OptionSelect } from "@/components/OptionSelect";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DEFAULT_HOST_PORT,
  type OpenBattleArgs,
} from "../multiplayer/battles/HostBattlePopover";
import {
  hashFailureMessage,
  useHostContent,
} from "../multiplayer/battles/useHostContent";
import {
  hostingRoute,
  hostingRouteSummary,
  NAT_TYPE_DIRECT,
  recordHostingRoute,
} from "./hostingRoute";
import { ReachablePorts } from "./ReachablePorts";
import {
  type DirectReachability,
  ownPublicAddress,
  roomPorts,
} from "./reachability";
import {
  DEFAULT_ROOM_PORT,
  playerNameProblem,
  roomPasswordProblem,
  roomPortProblem,
  startButtonLabel,
} from "./room";

/** Everything the page needs to start a room and open the host's battle in it. */
export interface StartRoomArgs {
  /** The name the host's own client logs in under, and the one that holds host
   *  powers in the room. */
  host: string;
  /** The lobby port the room listens on. */
  port: number;
  /** Announce the room on the local network, so people on it find it without
   *  being told an address. */
  advertise: boolean;
  /** Hold every join until the host answers it. */
  approveJoins: boolean;
  /** The address the internet sees this machine at, when the machine holds it
   *  itself, so the room can announce something somebody outside can dial. Null
   *  when nothing was measured, which is every host who left the reachability
   *  box unticked. */
  publicAddress: string | null;
  /** The battle to open once the host's client has connected. */
  battle: OpenBattleArgs;
}

export function HostRoomForm({
  blocked,
  defaultName,
  onStart,
}: {
  /** Why hosting is unavailable, or null when it is available. There is one
   *  lobby connection, so whatever already has it is in the way (see
   *  `hostBlockedReason`). */
  blocked: string | null;
  /** The name to offer as the host's, usually their last lobby login. */
  defaultName?: string;
  /** Starts the room and opens the battle in it. Rejects with what to tell the
   *  host when either half fails. */
  onStart: (args: StartRoomArgs) => Promise<void>;
}) {
  const drawer = useDrawer();
  const content = useHostContent();
  const [name, setName] = useState(defaultName ?? "Player");
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  // Held as typed rather than as a number, so the field can be emptied and a bad
  // value can be shown back to the host instead of being corrected under them.
  const [port, setPort] = useState(String(DEFAULT_ROOM_PORT));
  const [maxPlayers, setMaxPlayers] = useState(8);
  // On by default: the point of hosting on a LAN is that the people on it find
  // the room without being read an address across the sofa.
  const [advertise, setAdvertise] = useState(true);
  // Off by default: on a LAN everybody in the room is somebody you can see, and
  // a host who has to watch the screen to let people in is worse than no gate at
  // all. It earns its keep once a forwarded port puts the room on the internet.
  const [approveJoins, setApproveJoins] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the router and the internet said, handed up by ReachablePorts below.
  const [reachability, setReachability] = useState<DirectReachability | null>(
    null,
  );

  // A room is its own lobby server, so there is no server to have a relay and
  // the ladder from issue #2020 ends at the port mapping. That is not a
  // shortcoming: the point of hosting on a LAN is the people on the LAN, so the
  // sentence below says so rather than reporting it as a failure.
  //
  // It is also why the relay preference from issue #2023 is not in this form,
  // only in the lobby one. A lobby server not having a relay is a fact about
  // today that a server upgrade changes. A room not having one is what a room
  // is. Asking here would put a checkbox in front of somebody that could never
  // change a single thing about the room they are starting, which is worse than
  // not asking. Nothing is lost by leaving it out, because the preference only
  // ever decides whether an available relay is used, and there is never one
  // here. Passed as true rather than as the stored answer for the same reason
  // the false above is not a bare constant: it says what this call means.
  const route = hostingRoute(reachability, false, true);

  const trimmedName = name.trim();
  const nameProblem = playerNameProblem(name);
  const portProblem = roomPortProblem(port);
  const passwordProblem = roomPasswordProblem(password);
  const canStart =
    content.ready &&
    !nameProblem &&
    !portProblem &&
    !passwordProblem &&
    !starting &&
    !content.noEngine;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canStart || !content.target) return;
    setStarting(true);
    setError(null);
    // Dropped before the attempt rather than after it, so a room that fails to
    // start leaves no route behind for the next reader to believe.
    recordHostingRoute(null);
    try {
      await onStart({
        host: trimmedName,
        port: Number(port),
        advertise,
        approveJoins,
        // The panel above already measured this and already tells this host
        // they are directly reachable. Handing it to the room is what makes
        // that true of the game as well as the room (issue #2130).
        publicAddress: ownPublicAddress(reachability),
        battle: {
          battleType: 0,
          natType: NAT_TYPE_DIRECT,
          key: password.trim() || "*",
          // The engine's game port, not the room's. The two are separate ports
          // and the engine binds its own, exactly as it does on a real server.
          //
          // The port the router opened deliberately does not go here, unlike a
          // battle on a lobby server. This one field is read by everybody in the
          // room, and a room's joiners are on both sides of the router: the
          // people on this network reach the engine at the port it binds, and
          // only somebody outside would want the router's. Naming the router's
          // would break the case the room exists for to fix the case it does
          // not.
          //
          // Worth knowing before anybody revisits that trade, because it looks
          // like a coin flip and is not. Making the two port numbers agree buys
          // nothing at all. A room announces one address as well as one port,
          // and for a room on a LAN that address is this machine on this
          // network, so a joiner from outside is sent somewhere they cannot
          // dial whichever port they are handed. A machine behind a router that
          // could hand back a different external port holds a private address
          // by definition, so the port is never the only thing in the way and
          // never the first. Serving both sides means choosing the address per
          // joiner as well, which the room cannot do today because its accept
          // loop drops the peer's socket address (issue #2055).
          port: DEFAULT_HOST_PORT,
          // Never true here, and written as the same expression the lobby form
          // uses rather than a bare false, because the reason it is never true
          // is that a room has no lobby server to have a relay. Hard-coding it
          // would hide that behind a constant.
          relay: route === "relay",
          maxPlayers,
          modhash: content.modhash,
          rank: 0,
          maphash: content.maphash,
          engine: "spring",
          version: content.target.engineVersion,
          map: content.mapName,
          title: title.trim() || `${trimmedName}'s room`,
          modname: content.gameName,
        },
      });
      recordHostingRoute(route);
      // Deliberately left open on success too. A room that starts lands the host
      // in its battle room, and that navigation closes every drawer, so there is
      // nothing here to close and nothing to race with.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

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

  return (
    <form className="flex flex-col gap-2.5" onSubmit={submit}>
      {/* Paired, like the two numbers below, because the form is longer than a
          short laptop window and these are the two shortest answers in it. */}
      <div className="flex gap-2">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Room name</span>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`${trimmedName || "Your"}'s room`}
          />
        </label>

        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Your name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="The name others see"
          />
        </label>
      </div>
      {nameProblem && (
        <span className="text-xs text-destructive">{nameProblem}</span>
      )}

      {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Game</span>
        <OptionSelect
          value={content.gameName}
          onValueChange={content.setGameName}
          options={content.games.map((g) => ({ value: g.name, label: g.name }))}
          placeholder={content.scanning ? "Scanning…" : "Select a game"}
          size="sm"
        />
      </label>

      {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Map</span>
        <OptionSelect
          value={content.mapName}
          onValueChange={content.setMapName}
          options={content.maps.map((m) => ({ value: m.name, label: m.name }))}
          placeholder={content.scanning ? "Scanning…" : "Select a map"}
          size="sm"
        />
      </label>

      <div className="flex gap-2">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Max players</span>
          <Input
            type="number"
            min={2}
            max={32}
            value={maxPlayers}
            onChange={(e) =>
              setMaxPlayers(
                Math.max(2, Math.min(32, Number(e.target.value) || 2)),
              )
            }
          />
        </label>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Room port</span>
          <Input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
          {portProblem && (
            <span className="text-xs text-destructive">{portProblem}</span>
          )}
        </label>
      </div>

      {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Password (optional)</span>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Leave blank for an open room"
        />
        {passwordProblem && (
          <span className="text-xs text-destructive">{passwordProblem}</span>
        )}
      </label>

      {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the Checkbox control (implicit label association) */}
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={advertise}
          onCheckedChange={(checked) => setAdvertise(checked === true)}
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">Advertise on the local network</span>
          <span className="text-xs text-muted-foreground">
            People on this network see your room without being told an address.
            Turn it off and they need your address and port.
          </span>
        </span>
      </label>

      <ReachablePorts
        ports={portProblem ? null : roomPorts(Number(port), DEFAULT_HOST_PORT)}
        help={`Asks your router to forward the room's port and the game's port ${DEFAULT_HOST_PORT} so people outside this network can join. Both, because opening only the room's gets everybody in and then fails at launch.`}
        onReport={setReachability}
      />

      <p className="text-xs text-muted-foreground">
        {hostingRouteSummary(route, { lanRoom: true })}
      </p>

      {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the Checkbox control (implicit label association) */}
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={approveJoins}
          onCheckedChange={(checked) => setApproveJoins(checked === true)}
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">Approve joins</span>
          <span className="text-xs text-muted-foreground">
            Nobody gets in until you say so. You are asked in the battle room,
            and whoever is asking waits until you answer.
          </span>
        </span>
      </label>

      {(content.gameFailed || content.mapFailed) && (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
          {content.gameFailed && (
            <div className="flex items-center justify-between gap-2">
              <span>
                {hashFailureMessage(
                  "game",
                  content.gameInfo.status,
                  content.gameInfo.info?.errors?.[0],
                )}
              </span>
              <Button
                type="button"
                variant="secondary"
                className="h-6 shrink-0 px-2"
                onClick={content.gameInfo.reload}
              >
                Retry
              </Button>
            </div>
          )}
          {content.mapFailed && (
            <div className="flex items-center justify-between gap-2">
              <span>
                {hashFailureMessage(
                  "map",
                  content.mapInfo.status,
                  content.mapInfo.info?.errors?.[0],
                )}
              </span>
              <Button
                type="button"
                variant="secondary"
                className="h-6 shrink-0 px-2"
                onClick={content.mapInfo.reload}
              >
                Retry
              </Button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          className="h-9"
          onClick={() => drawer.close()}
        >
          Cancel
        </Button>
        <Button type="submit" className="h-9" disabled={!canStart}>
          {startButtonLabel(starting, content.checksumsReady)}
        </Button>
      </div>
    </form>
  );
}
