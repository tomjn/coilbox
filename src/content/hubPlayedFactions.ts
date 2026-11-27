/**
 * The faction each player played, as a replay's hub summary sends it (#5504).
 *
 * The hub works the same thing out from the file and refuses a replay whose
 * summary differs (`PlayedFactions.php` and `docs/replay-uploads.md` in
 * coilbox-hub). Which pick counts is already decided by the decoder, so
 * `pick` is the one the hub reads too.
 */
import type { ReplayPlayer, Side, UnitDatasetEntry } from "./bindings";
import { pickedSide } from "./replayFactions";

/**
 * A player's `faction` in the summary. `units` is the recorded game's unit list
 * in id order, or null, and `sides` the game's sides.
 *
 * With no pick it is the start script's side. A picked faction name goes as it
 * was sent, because the hub compares it with the message. A picked start unit
 * is the game's name for its side, and null when that cannot be worked out. The
 * hub only checks that case when its catalogue knows the unit's faction, and
 * the script's side is not what the player picked.
 */
export function hubFaction(
  player: Pick<ReplayPlayer, "side" | "pick">,
  units: readonly UnitDatasetEntry[] | null,
  sides: readonly Side[],
): string | null {
  const { pick, side } = player;
  if (!pick) return side ?? null;
  if (pick.name !== undefined) return pick.name;
  return pickedSide(pick, units, sides) ?? null;
}

/**
 * The unit ids the players' picks name, which the summary's `units` must list
 * even when nobody built them. A replay with no unit list of its own gives the
 * hub no other name for a start unit.
 */
export function hubPickUnitIds(
  players: readonly { spectator?: boolean; pick?: ReplayPlayer["pick"] }[],
): number[] {
  return players.flatMap((p) =>
    !p.spectator && p.pick?.unitDefId !== undefined ? [p.pick.unitDefId] : [],
  );
}
