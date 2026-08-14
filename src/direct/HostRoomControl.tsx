import { Button, useDrawer } from "@picoframe/frame";
import { useEffect, useState } from "react";
import { nextDrawerKey } from "@/general/drawerKey";
import type { DirectRoomStatus } from "./bindings";
import { HostRoomForm, type StartRoomArgs } from "./HostRoomForm";
import {
  type DirectReachability,
  directPortStatus,
  joinAddress,
} from "./reachability";
import { roomSummary } from "./room";

export type { StartRoomArgs } from "./HostRoomForm";

/**
 * "Host on LAN": start a lobby of your own, with no server and no account.
 *
 * The room is a TASServer subset running in this process, so once it is up the
 * host's own client dials it over loopback and everything above the socket is the
 * ordinary path: the same battle room, the same host powers, the same launch.
 * That is why this collects a battle as well as a room, and lands the host in the
 * battle room rather than in a lobby of one.
 *
 * Two states, never both: the trigger for the form while there is no room, and a
 * line about the room while there is one. {@link HostRoomForm} holds the form
 * itself, because the drawer is handed an element rather than a component and the
 * form has to stand alone inside it.
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
  /** Why the last attempt to stop the room failed, or null. A failed start is
   *  said in the drawer, by the form that asked for it. */
  error: string | null;
  onStart: (args: StartRoomArgs) => Promise<void>;
  onStop: () => void;
}) {
  if (room) {
    return (
      <RunningRoom room={room} busy={busy} error={error} onStop={onStop} />
    );
  }
  return (
    <HostRoomDrawerButton
      connectedToServer={connectedToServer}
      defaultName={defaultName}
      onStart={onStart}
    />
  );
}

/** The room as it runs: who is in it, where to find it, and how to end it. The
 *  line is a reading of the room's live status, so a join or a leave shows up in
 *  it (see the poll in `BattlesPage`). */
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
          {roomSummary(room)}
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
      <PublicAddress />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The address to send somebody outside this network, while there is one.
 *
 * Read once on mount rather than polled: ports do not open and close by
 * themselves, and this component only exists while a room is up. It is here
 * because starting a room takes the host straight to their battle room, so the
 * drawer that showed them the address is long gone by the time they want to read
 * it out to a friend.
 *
 * Renders nothing at all when no ports are open, which is every room on a LAN.
 */
function PublicAddress() {
  const [report, setReport] = useState<DirectReachability | null>(null);
  useEffect(() => {
    let live = true;
    directPortStatus({})
      .then((r) => {
        if (live) setReport(r.reachability);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const address = report && joinAddress(report);
  if (!address) return null;
  return (
    <span className="text-xs text-muted-foreground">
      Reachable from outside at{" "}
      <code className="select-all font-mono text-foreground">{address}</code>
    </span>
  );
}

/** Opens the form in the frame's drawer. Keyed per opening so a second visit gets
 *  a new form rather than the one the last visit left behind. */
function HostRoomDrawerButton({
  connectedToServer,
  defaultName,
  onStart,
}: {
  connectedToServer: boolean;
  defaultName?: string;
  onStart: (args: StartRoomArgs) => Promise<void>;
}) {
  const drawer = useDrawer();
  return (
    // Deliberately not disabled while connected to a server: a button that does
    // nothing and says nothing is the failure this milestone is about. The drawer
    // opens and says why hosting is unavailable.
    <Button
      variant="secondary"
      className="h-8 px-3"
      onClick={() =>
        drawer.open({
          title: "Host on LAN",
          // No description. The page this button sits on has already said a room
          // needs no server and no account, and repeating it costs a line the
          // form needs to stand up in one short laptop window.
          // Wide enough for the same reason.
          width: "30rem",
          content: (
            <HostRoomForm
              key={nextDrawerKey()}
              connectedToServer={connectedToServer}
              defaultName={defaultName}
              onStart={onStart}
            />
          ),
        })
      }
    >
      Host on LAN
    </Button>
  );
}
