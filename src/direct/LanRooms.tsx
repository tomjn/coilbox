import { Button, useDrawer } from "@picoframe/frame";
import { ChevronRight, Lock, Users } from "lucide-react";
import { useState } from "react";
import { nextDrawerKey } from "@/general/drawerKey";
import { THUMB_MINIMAP_MIP, useUnitsyncMinimap } from "../content/config";
import { MapThumb } from "../content/pages/components/MapThumb";
import type { DirectLanRoom } from "./bindings";
import {
  type JoinRoomArgs,
  JoinRoomForm,
  type JoinRoomTarget,
} from "./JoinRoomForm";

export type { JoinRoomArgs } from "./JoinRoomForm";

/**
 * "Local Network": the rooms other people are announcing, and the way in for a
 * host who was never heard at all.
 *
 * Collapsed to its heading until somebody opens it, and counted there like the
 * battle list's own groups, because most people are on a server and the rooms on
 * their own network are nearly always none. A section that is nearly always
 * empty should not be the first thing above the battles.
 *
 * Other people's, because a host is already in their own room and it is in the
 * battle list below with the way back into it, so listing it here as well was
 * the same room twice (issue #1608). `BattlesPage` filters it out, and the note
 * on the host's own line says whether their room is being announced.
 *
 * An empty list is a real answer, not a wait. Plenty of access points refuse to
 * carry broadcast between the devices on them, and a VPN or a guest network does
 * the same, so an empty list means "ask them for their address" far more often
 * than it means "nobody is hosting". That is why the typed address sits in the
 * heading rather than behind the empty state, and why nothing here spins.
 *
 * Shown whether or not there is a lobby connection, because somebody with no
 * server is who this is for. When something else already holds the one lobby
 * connection, the rooms are still listed and the reason a join is unavailable is
 * said out loud.
 */
export function LanRooms({
  rooms,
  error,
  blocked,
  defaultName,
  enginePath,
  dataDir,
  onJoin,
}: {
  /** The rooms somebody else is announcing. */
  rooms: DirectLanRoom[];
  /** Why this client cannot listen for rooms at all, or null. */
  error: string | null;
  /** Why a join is unavailable, or null. */
  blocked: string | null;
  /** The name to offer as this player's, usually their last lobby login. */
  defaultName?: string;
  /** The local engine and data root, for the minimaps, exactly as the battle
   *  list uses them. A map that is not installed falls through to a placeholder
   *  rather than being fetched from anywhere. */
  enginePath?: string;
  dataDir?: string;
  onJoin: (args: JoinRoomArgs) => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <section className="flex w-full flex-col gap-2" aria-labelledby="lan-rooms">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          id="lan-rooms"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="flex items-center gap-1.5 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            aria-hidden
            className={`size-3.5 transition-transform ${
              collapsed ? "" : "rotate-90"
            }`}
          />
          Local Network
          <span>{rooms.length}</span>
        </button>
        {/* Outside the collapse on purpose. A room heard on nobody's network is
            exactly when somebody needs to type an address, so the way in cannot
            be behind the heading that says there is nothing here. */}
        <JoinRoomDrawerButton
          defaultName={defaultName}
          blocked={blocked}
          onJoin={onJoin}
        />
      </div>

      {/* Also outside, because a client that cannot listen at all has a reason
          worth reading and a count of 0 that does not explain itself. */}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error} Rooms on this network will not be listed, but you can still
          join one by address.
        </p>
      )}

      {!collapsed &&
        (rooms.length === 0 ? (
          !error && (
            <p className="text-left text-xs text-muted-foreground">
              No rooms found. Some networks stop devices seeing each other, so a
              room that is up may still not be listed here. Ask the host for
              their address and join by address.
            </p>
          )
        ) : (
          <ul className="flex flex-col gap-2">
            {rooms.map((room) => (
              <LanRoomRow
                key={room.id}
                room={room}
                blocked={blocked}
                defaultName={defaultName}
                enginePath={enginePath}
                dataDir={dataDir}
                onJoin={onJoin}
              />
            ))}
          </ul>
        ))}

      {!collapsed && blocked && rooms.length > 0 && (
        <p className="text-xs text-muted-foreground">{blocked}</p>
      )}
    </section>
  );
}

/** One room heard on the network, read the same way a battle row is: map, game,
 *  host, how full it is, and the way in. */
function LanRoomRow({
  room,
  blocked,
  defaultName,
  enginePath,
  dataDir,
  onJoin,
}: {
  room: DirectLanRoom;
  blocked: string | null;
  defaultName?: string;
  enginePath?: string;
  dataDir?: string;
  onJoin: (args: JoinRoomArgs) => Promise<void>;
}) {
  const { url, loading } = useUnitsyncMinimap(
    enginePath,
    dataDir,
    room.map,
    THUMB_MINIMAP_MIP,
  );
  return (
    <li className="flex items-center gap-4 rounded-md border border-border p-3">
      <div className="w-14 shrink-0 overflow-hidden rounded-md border border-border">
        <MapThumb
          url={url ?? undefined}
          loading={loading}
          alt={`Minimap of ${room.map}`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-medium">
          {room.passworded && (
            <Lock
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-label="Passworded"
            />
          )}
          <span className="truncate">{room.title}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {room.map} · {room.game} · host {room.host}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <Users className="size-3.5" aria-hidden />
        <span>
          {room.players}/{room.maxPlayers}
        </span>
      </div>
      <JoinRoomDrawerButton
        target={{
          title: room.title,
          address: room.address,
          port: room.port,
          passworded: room.passworded,
          from: "network",
        }}
        defaultName={defaultName}
        blocked={blocked}
        onJoin={onJoin}
      />
    </li>
  );
}

/** Opens the join form in the frame's drawer, empty for a typed address or
 *  filled in for a room off the list. Keyed per opening, so a second visit gets a
 *  new form rather than the one the last visit left behind. */
function JoinRoomDrawerButton({
  target,
  defaultName,
  blocked,
  onJoin,
}: {
  target?: JoinRoomTarget;
  defaultName?: string;
  blocked: string | null;
  onJoin: (args: JoinRoomArgs) => Promise<void>;
}) {
  const drawer = useDrawer();
  return (
    // Deliberately not disabled while something else holds the connection: a
    // button that does nothing and says nothing is the failure this milestone is
    // about. The drawer opens and says why joining is unavailable.
    <Button
      variant="secondary"
      className="h-8 shrink-0 px-3"
      aria-label={
        target?.title ? `Join ${target.title}` : "Join a room by address"
      }
      onClick={() =>
        drawer.open({
          title: target?.title ? `Join ${target.title}` : "Join by address",
          width: "30rem",
          content: (
            <JoinRoomForm
              key={nextDrawerKey()}
              target={target}
              defaultName={defaultName}
              blocked={blocked}
              onJoin={onJoin}
            />
          ),
        })
      }
    >
      {target?.title ? "Join" : "Join by address"}
    </Button>
  );
}
