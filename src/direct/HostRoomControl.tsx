import { Button, useDrawer } from "@picoframe/frame";
import { useEffect, useState } from "react";
import { buildRoomLink } from "@/deeplink/build";
import { nextDrawerKey } from "@/general/drawerKey";
import {
  type DirectLocalAddress,
  type DirectRoomStatus,
  directLocalAddresses,
} from "./bindings";
import { CopyButton } from "./CopyButton";
import { HostRoomForm, type StartRoomArgs } from "./HostRoomForm";
import { useRoomMovedFrom } from "./hostedRoom";
import { type DirectReachability, directPortStatus } from "./reachability";
import { announcementNote, gameAddressNote, roomSummary } from "./room";
import { addressText, shareAddresses, shareHeadline } from "./share";

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
  heardOnNetwork,
  blocked,
  defaultName,
  busy,
  error,
  onStart,
  onStop,
}: {
  /** The room this client is hosting, or null when it is not hosting. */
  room: DirectRoomStatus | null;
  /** This client has heard its own room announcing itself, which is the only
   *  evidence a host has that the announcement left the machine. */
  heardOnNetwork: boolean;
  /** Why hosting is unavailable, or null when it is available. There is one
   *  lobby connection, so whatever already has it is in the way (see
   *  `hostBlockedReason`). */
  blocked: string | null;
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
      <RunningRoom
        room={room}
        heardOnNetwork={heardOnNetwork}
        busy={busy}
        error={error}
        onStop={onStop}
      />
    );
  }
  return (
    <HostRoomDrawerButton
      blocked={blocked}
      defaultName={defaultName}
      onStart={onStart}
    />
  );
}

/** The room as it runs: who is in it, whether the network can hear it, where to
 *  find it, and how to end it. The line is a reading of the room's live status,
 *  so a join or a leave shows up in it (see the poll in `BattlesPage`). */
function RunningRoom({
  room,
  heardOnNetwork,
  busy,
  error,
  onStop,
}: {
  room: DirectRoomStatus;
  heardOnNetwork: boolean;
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
      {/* The room used to prove this by turning up in the list of rooms on the
          network with a "Yours" badge on it, which listed it twice over
          (issue #1608). Said here instead, where the host is already reading
          about their room. */}
      <span className="text-right text-xs text-muted-foreground">
        {announcementNote(room.advertise, heardOnNetwork)}
      </span>
      <RoomAddresses port={room.port} announced={room.ip} />
      <GameAddress ip={room.ip} />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The address the room itself hands out, while it is up (issue #2118).
 *
 * Below the addresses to read out rather than among them, because it is not one
 * of them. Those are what somebody types in to reach the room. This is the one
 * the room has picked to put in its battle, which a joiner's engine dials when
 * the game starts. A host reads it when people are in the room and the game will
 * not start for them.
 *
 * It learns about a move from the poll that already feeds the line above it, so
 * a room that moves onto a VPN says so within one tick of `ROOM_POLL_MS`
 * (issue #2116). The move is a change nobody asked for, so this is a live
 * region. A host who is reading the line hears it rather than having to notice
 * the number is different from the one they read a minute ago.
 */
function GameAddress({ ip }: { ip: string }) {
  const movedFrom = useRoomMovedFrom();
  return (
    <span role="status" className="text-right text-xs text-muted-foreground">
      {gameAddressNote(ip, movedFrom)}
    </span>
  );
}

/**
 * The addresses a joiner types in, while the room is up (issue #1611).
 *
 * This used to be the public address alone, and so rendered nothing at all for
 * every room on a LAN and every room behind a router that refuses UPnP and
 * NAT-PMP, which left the host with no answer to "what do I put in?". The
 * addresses were always there: the room binds `0.0.0.0` and answers on all of
 * them.
 *
 * It is on this line rather than in the drawer because starting a room takes the
 * host straight to their battle room, so the drawer they asked for it in is long
 * gone by the time somebody wants to join.
 *
 * Read once on mount rather than polled. Ports do not open and close by
 * themselves, an interface does not usually appear while a room is up, and this
 * component only exists while one is.
 *
 * `announced` is the exception, and comes down as a prop because it does move:
 * it is the address the room is putting in its battle, re-read on the poll that
 * feeds `GameAddress` below (issue #2116). It is what decides whether the
 * outside row can deliver a game as well as a room (issue #2127).
 */
function RoomAddresses({
  port,
  announced,
}: {
  port: number;
  announced: string;
}) {
  const [addresses, setAddresses] = useState<DirectLocalAddress[] | null>(null);
  const [report, setReport] = useState<DirectReachability | null>(null);
  useEffect(() => {
    let live = true;
    directLocalAddresses({})
      .then((r) => {
        if (live) setAddresses(r.addresses);
      })
      .catch(() => {});
    directPortStatus({})
      .then((r) => {
        if (live) setReport(r.reachability);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Nothing until the machine has answered. A moment with no addresses beats a
  // moment showing only loopback, which is the one address that is never the
  // answer.
  if (!addresses) return null;
  const shared = shareAddresses(addresses, port, report, announced);
  return (
    <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
      <span>{shareHeadline(shared)}</span>
      <ul className="flex flex-col items-end gap-1">
        {shared.map((address) => {
          // A link says the same thing as the address beside it, so it is an
          // extra button rather than a replacement: somebody reading it out over
          // voice chat still needs the numbers (issue #1612).
          const link = buildRoomLink(address.address, address.port);
          return (
            <li
              key={`${address.scope}-${address.address}`}
              className="flex flex-col items-end gap-0.5"
            >
              <div className="flex items-center gap-2">
                <span>{address.label}</span>
                <code className="select-all rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                  {addressText(address)}
                </code>
                <CopyButton
                  value={addressText(address)}
                  label={`Copy ${addressText(address)}, ${address.who}`}
                >
                  Copy
                </CopyButton>
                {link && (
                  <CopyButton
                    value={link}
                    label={`Copy a link that joins at ${addressText(address)}, ${address.who}`}
                  >
                    Copy link
                  </CopyButton>
                )}
              </div>
              {/* Under the row rather than beside it, because it is a sentence
                  and the row is a heading, an address and two buttons already
                  (issue #2127). */}
              {address.caveat && (
                <span className="max-w-sm text-right">{address.caveat}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Opens the form in the frame's drawer. Keyed per opening so a second visit gets
 *  a new form rather than the one the last visit left behind. */
function HostRoomDrawerButton({
  blocked,
  defaultName,
  onStart,
}: {
  blocked: string | null;
  defaultName?: string;
  onStart: (args: StartRoomArgs) => Promise<void>;
}) {
  const drawer = useDrawer();
  return (
    // Deliberately not disabled while blocked: a button that does nothing and
    // says nothing is the failure this milestone is about. The drawer opens and
    // says why hosting is unavailable.
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
              blocked={blocked}
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
