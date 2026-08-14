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
import { Checkbox } from "@/components/ui/checkbox";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import {
  DEFAULT_HOST_PORT,
  type OpenBattleArgs,
} from "../multiplayer/battles/HostBattlePopover";
import {
  hashFailureMessage,
  useHostContent,
} from "../multiplayer/battles/useHostContent";
import { ReachablePorts } from "./ReachablePorts";
import { roomPorts } from "./reachability";
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
    try {
      await onStart({
        host: trimmedName,
        port: Number(port),
        advertise,
        approveJoins,
        battle: {
          battleType: 0,
          // Direct is the only mode coilbox implements, here as everywhere.
          natType: 0,
          key: password.trim() || "*",
          // The engine's game port, not the room's. The two are separate ports
          // and the engine binds its own, exactly as it does on a real server.
          port: DEFAULT_HOST_PORT,
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
      />

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
