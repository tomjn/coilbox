import { MapPin } from "lucide-react";
import { BATTLE_MOVED_NOTICE, useBattleMoved } from "./battleMoved";

/**
 * Tells everybody in a battle that the battle has moved onto a different
 * address (issue #2073).
 *
 * The joiner's half of the room-moved strip a host reads a few pixels above
 * this (issue #2122). A host running a room is told when the room follows their
 * machine onto a new address. Everybody sitting in that room was told nothing,
 * even though they are the ones holding an address that has stopped working,
 * and the same is true of a relayed battle whose allocation is rebuilt.
 *
 * Drawn in the same shape as the host's strip and for the same reasons: muted
 * rather than amber because a move is not a fault, `role="status"` because it
 * arrives while somebody is reading something else, and a strip rather than a
 * notification because it is a fact that keeps rather than a question waiting on
 * an answer.
 *
 * # Why the host is skipped
 *
 * Not because the move does not concern them, but because they have already been
 * told. A host running a LAN room reads the room-moved strip directly above
 * this. A host whose relay moved asked for the move themselves, through the
 * relay agent, and is warned separately when the lobby refuses it. Drawing this
 * as well would say the same thing twice in one column.
 *
 * # Why it takes the battle rather than reading one
 *
 * The record names a battle, and this is the check that the name is the battle
 * on screen. `battleId` comes from the page, which holds the only copy that is
 * definitely current.
 */
export function BattleMovedPanel({
  battleId,
  selfHost,
}: {
  /** The battle drawn on this page, to check the record is about it. */
  battleId: number;
  /** Whether this client runs the battle, and so has been told already. */
  selfHost: boolean;
}) {
  const moved = useBattleMoved();
  if (selfHost || moved !== battleId) return null;
  return (
    <p
      role="status"
      className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground"
    >
      <MapPin className="size-4 shrink-0" />
      {BATTLE_MOVED_NOTICE}
    </p>
  );
}
