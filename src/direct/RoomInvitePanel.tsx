import type { DirectRoomStatus } from "./bindings";
import { RoomAddresses } from "./HostRoomControl";

/**
 * The ways into a room, in the room's own battle page, for the host who has just
 * started it (issue #3383).
 *
 * The same rows the Battles page shows under "Stop room", with their copy and
 * copy link buttons. They have to be here as well, because starting a room takes
 * the host straight into its battle room, and the Battles page is no longer on
 * screen by the time somebody needs the link. A link says what the address says
 * (see `invite.ts`), so a friend who opens it gets the room's join form filled
 * in.
 */
export function RoomInvitePanel({ room }: { room: DirectRoomStatus }) {
  return (
    <section
      aria-label="Invite people to this room"
      className="flex flex-col items-end border-b border-border px-4 py-2"
    >
      <RoomAddresses port={room.port} announced={room.ip} />
    </section>
  );
}
