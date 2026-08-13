import { Button, Input } from "@picoframe/frame";
import { useState } from "react";
import { Link } from "react-router";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import {
  DEFAULT_HOST_PORT,
  type OpenBattleArgs,
} from "../multiplayer/battles/HostBattlePopover";
import {
  hashFailureMessage,
  useHostContent,
} from "../multiplayer/battles/useHostContent";
import type { DirectRoomStatus } from "./bindings";
import { DEFAULT_ROOM_PORT, normalizeRoomPort, startButtonLabel } from "./room";

/** Everything the page needs to start a room and open the host's battle in it. */
export interface StartRoomArgs {
  /** The name the host's own client logs in under, and the one that holds host
   *  powers in the room. */
  host: string;
  /** The lobby port the room listens on. */
  port: number;
  /** The battle to open once the host's client has connected. */
  battle: OpenBattleArgs;
}

/**
 * "Host on LAN": start a lobby of your own, with no server and no account.
 *
 * The room is a TASServer subset running in this process, so once it is up the
 * host's own client dials it over loopback and everything above the socket is the
 * ordinary path: the same battle room, the same host powers, the same launch.
 * That is why this collects a battle as well as a room, and lands the host in the
 * battle room rather than in a lobby of one.
 *
 * The three toggles the design calls for are shown switched off and disabled,
 * because the work behind each is still to come. Showing them working would put
 * a host on a LAN nobody can see them on.
 */
export function HostRoomControl({
  room,
  connectedToServer,
  defaultName,
  busy,
  error,
  onStart,
  onStop,
}: {
  /** The room this client is hosting, or null when it is not hosting. */
  room: DirectRoomStatus | null;
  /** Connected to a real lobby server. There is one connection, so it is the
   *  room's or the server's, and the server got there first. */
  connectedToServer: boolean;
  /** The name to offer as the host's, usually their last lobby login. */
  defaultName?: string;
  busy: boolean;
  /** Why the last attempt to start or stop a room failed, or null. */
  error: string | null;
  onStart: (args: StartRoomArgs) => void;
  onStop: () => void;
}) {
  if (room) {
    return (
      <RunningRoom room={room} busy={busy} error={error} onStop={onStop} />
    );
  }
  return (
    <HostRoomPopover
      connectedToServer={connectedToServer}
      defaultName={defaultName}
      busy={busy}
      error={error}
      onStart={onStart}
    />
  );
}

/** The room as it runs: who is in it, where to find it, and how to end it. */
function RunningRoom({
  room,
  busy,
  error,
  onStop,
}: {
  room: DirectRoomStatus;
  busy: boolean;
  error: string | null;
  onStop: () => void;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          Hosting on port {room.port} as {room.host}
          {room.peers > 1 ? `, ${room.peers - 1} joined` : ""}
        </span>
        <Button
          variant="secondary"
          className="h-8 px-3"
          disabled={busy}
          onClick={onStop}
        >
          Stop room
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function HostRoomPopover({
  connectedToServer,
  defaultName,
  busy,
  error,
  onStart,
}: {
  connectedToServer: boolean;
  defaultName?: string;
  busy: boolean;
  error: string | null;
  onStart: (args: StartRoomArgs) => void;
}) {
  const [open, setOpen] = useState(false);
  const content = useHostContent();
  const [name, setName] = useState(defaultName ?? "Player");
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [port, setPort] = useState(DEFAULT_ROOM_PORT);
  const [maxPlayers, setMaxPlayers] = useState(8);

  const trimmedName = name.trim();
  // A room announces its members by name in single wire fields, so a name with a
  // space in it arrives as two, and the room refuses the login rather than
  // guessing. Say so here instead of letting the handshake fail.
  const nameHasSpace = /\s/.test(trimmedName);
  const canStart =
    content.ready &&
    !!trimmedName &&
    !nameHasSpace &&
    !busy &&
    !content.noEngine;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canStart || !content.target) return;
    onStart({
      host: trimmedName,
      port: normalizeRoomPort(port),
      battle: {
        battleType: 0,
        // Direct is the only mode coilbox implements, here as everywhere.
        natType: 0,
        key: password.trim() || "*",
        // The engine's game port, not the room's. The two are separate ports and
        // the engine binds its own, exactly as it does on a real server.
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
    // Deliberately left open. A room that will not start says so in here, and
    // closing on submit would throw that away and look like nothing happened.
    // A room that does start navigates to its battle room, which takes the whole
    // page and this with it.
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Deliberately not disabled while connected to a server: a button that
            does nothing and says nothing is the failure this milestone is about. */}
        <Button variant="secondary" className="h-8 px-3">
          Host on LAN
        </Button>
      </PopoverTrigger>
      {/* A room asks more questions than fits a short window, so the form scrolls
          inside whatever height Radix says is left rather than running off the top. */}
      <PopoverContent
        align="end"
        className="max-h-[var(--radix-popover-content-available-height)] w-80 overflow-y-auto"
      >
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <span className="text-sm font-semibold">Host on LAN</span>

          {connectedToServer ? (
            <p className="text-sm text-muted-foreground">
              Log out of the lobby server first. Coilbox holds one lobby
              connection, and hosting a room needs it.
            </p>
          ) : content.noEngine ? (
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
          ) : (
            <>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Room name</span>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`${trimmedName || "Your"}'s room`}
                />
              </label>

              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Your name</span>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="The name others see"
                />
                {nameHasSpace && (
                  <span className="text-xs text-destructive">
                    No spaces. A room announces names in single wire fields, so
                    a name with a space in it does not survive the trip.
                  </span>
                )}
              </label>

              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Game</span>
                <OptionSelect
                  value={content.gameName}
                  onValueChange={content.setGameName}
                  options={content.games.map((g) => ({
                    value: g.name,
                    label: g.name,
                  }))}
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
                  options={content.maps.map((m) => ({
                    value: m.name,
                    label: m.name,
                  }))}
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
                    value={port}
                    onChange={(e) =>
                      setPort(Number(e.target.value) || DEFAULT_ROOM_PORT)
                    }
                  />
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
              </label>

              <PendingToggle
                label="Advertise on the local network"
                reason="Rooms are not announced yet, so give joiners the address instead."
              />
              <PendingToggle
                label="Reachable over the internet"
                reason="Coilbox cannot open a port on your router yet. Forward it by hand for players outside your network."
              />
              <PendingToggle
                label="Approve joins"
                reason="There is nowhere to answer a waiting join yet, so every join would sit unanswered."
              />

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

              <Button type="submit" className="h-8" disabled={!canStart}>
                {startButtonLabel(busy, content.checksumsReady)}
              </Button>
            </>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** A toggle the design calls for and nothing implements yet: off, unusable, and
 *  saying so rather than pretending. */
function PendingToggle({ label, reason }: { label: string; reason: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: wraps the Checkbox control (implicit label association)
    <label className="flex items-start gap-2 text-sm opacity-60">
      <Checkbox checked={false} disabled className="mt-0.5" />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">Not yet. {reason}</span>
      </span>
    </label>
  );
}
