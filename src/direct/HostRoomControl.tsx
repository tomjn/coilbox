import { Button, useDrawer } from "@picoframe/frame";
import { useEffect, useRef } from "react";
import { nextDrawerKey } from "@/general/drawerKey";
import type { SkirmishDraft } from "@/play/drafts";
import type { DirectRoomStatus } from "./bindings";
import { HostRoomForm, type StartRoomArgs } from "./HostRoomForm";
import { useRoomMovedFrom } from "./hostedRoom";
import { QuickRoom } from "./QuickRoom";
import { announcementNote, gameAddressNote, roomSummary } from "./room";
import { ShareRoomButton } from "./ShareRoomButton";

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
  leaves = null,
  defaultName,
  draft,
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
  /** Why hosting is unavailable, or null when it is available. Coilbox is in
   *  one room at a time, so a room already open is in the way (see
   *  `hostBlockedReason`). */
  blocked: string | null;
  /** What entering leaves behind under the one-battle rule (issue #2844), or
   *  null. Said above the button, which then confirms leaving. */
  leaves?: string | null;
  /** The name to offer as the host's, usually their last lobby login. */
  defaultName?: string;
  /** A skirmish setup from "Host as battle" to open the form with, which also
   *  opens the form on arrival. */
  draft?: SkirmishDraft;
  busy: boolean;
  /** Why the last attempt to stop the room failed, or null. A failed start is
   *  said in the drawer, by the form that asked for it. */
  error: string | null;
  onStart: (args: StartRoomArgs) => Promise<string | undefined>;
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
      leaves={leaves}
      defaultName={defaultName}
      draft={draft}
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
        {/* Where to find the room's addresses, here as in the battle room: the
            host leaves this page when the room starts and comes back to it
            wanting the same link. */}
        <ShareRoomButton room={room} className="h-8 px-3" />
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

/** Opens the form in the frame's drawer, or starts a room against the computer
 *  in one step. Keyed per opening so a second visit gets a new form rather than
 *  the one the last visit left behind. */
function HostRoomDrawerButton({
  blocked,
  leaves,
  defaultName,
  draft,
  onStart,
}: {
  blocked: string | null;
  leaves: string | null;
  defaultName?: string;
  draft?: SkirmishDraft;
  onStart: (args: StartRoomArgs) => Promise<string | undefined>;
}) {
  const drawer = useDrawer();
  const openForm = () =>
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
          leaves={leaves}
          defaultName={defaultName}
          draft={draft}
          onStart={onStart}
        />
      ),
    });
  // A setup sent here from the Singleplayer page opens the form on arrival, once.
  // Held in a ref so the drawer is not opened again by a re-render, and so a
  // form already closed stays closed.
  const openOnArrival = useRef(openForm);
  openOnArrival.current = openForm;
  const arrived = useRef(false);
  useEffect(() => {
    if (!draft || arrived.current) return;
    arrived.current = true;
    openOnArrival.current();
  }, [draft]);
  return (
    // Deliberately not disabled while blocked: a button that does nothing and
    // says nothing is the failure this milestone is about. The drawer opens and
    // says why hosting is unavailable.
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        className="h-8 px-3"
        onClick={() =>
          drawer.open({
            title: "Host against the computer",
            width: "30rem",
            content: (
              <QuickRoom
                key={nextDrawerKey()}
                blocked={blocked}
                leaves={leaves}
                defaultName={defaultName}
                onStart={onStart}
              />
            ),
          })
        }
      >
        Host vs computer
      </Button>
      <Button variant="secondary" className="h-8 px-3" onClick={openForm}>
        Host on LAN
      </Button>
    </div>
  );
}
