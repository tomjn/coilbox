/**
 * The faction a player picked in the match (#5489), in the words the game uses.
 *
 * The decoder records each pick as it was sent: a start unit's definition id, or
 * for some games the faction's name. This turns a pick into a side name, which
 * stands in place of the start script's `side`. A pick that cannot be named
 * keeps the script's side.
 */
import type {
  GameItem,
  RecordedPick,
  ReplayUnitDefSets,
  Side,
  StatRecord,
  UnitDatasetEntry,
} from "./bindings";
import {
  closestInstalledGame,
  pickUnitSource,
  resolveBuildUnit,
} from "./replayBuildOrders";
import { storedListFor } from "./replayUnitDefs";

/**
 * The side a pick stands for, spelled as the game's side data spells it.
 * `units` is the recorded game's unit list in id order and `sides` the game's
 * sides. A picked name needs neither, and is returned as sent when no side
 * matches it. A pick the replay named itself needs no `units`. Undefined for a
 * unit id that cannot be named, or that names no side's start unit.
 */
export function pickedSide(
  pick: RecordedPick,
  units: UnitDatasetEntry[] | null,
  sides: readonly Side[],
): string | undefined {
  const name = pick.name?.toLowerCase();
  if (name !== undefined)
    return sides.find((s) => s.name.toLowerCase() === name)?.name ?? pick.name;
  if (pick.unitDefId === undefined) return undefined;
  const unit = (
    pick.unit ?? resolveBuildUnit(pick.unitDefId, units)?.name
  )?.toLowerCase();
  if (unit === undefined) return undefined;
  return sides.find((s) => s.startUnit?.toLowerCase() === unit)?.name;
}

/**
 * `players` with each picked side in place of the script's. The same array when
 * no side changes, so a caller can use it as a memo key.
 */
export function withPickedSides<
  P extends { side?: string; pick?: RecordedPick },
>(players: P[], units: UnitDatasetEntry[] | null, sides: readonly Side[]): P[] {
  let changed = false;
  const out = players.map((p) => {
    const side = p.pick && pickedSide(p.pick, units, sides);
    if (!side || side === p.side) return p;
    changed = true;
    return { ...p, side };
  });
  return changed ? out : players;
}

/** Whether a pick's unit id can only be named from a unit list. */
export function needsUnitList(pick: RecordedPick | undefined): boolean {
  return pick?.unitDefId !== undefined && pick.unit === undefined;
}

/** What {@link resolveStatSides} reads. */
export interface StatFactionReads {
  /** The installed games, from the unitsync scan. */
  games: GameItem[];
  sides: (archive: string) => Promise<Side[]>;
  /** A game's own unit list, in id order. */
  units: (archive: string) => Promise<UnitDatasetEntry[]>;
  /** The unit lists kept for a replay. */
  kept: (gameId: string) => Promise<ReplayUnitDefSets | null>;
}

/** Records whose every pick has been named this session. */
const named = new Map<string, StatRecord["players"]>();

/** For tests: forget everything, as a fresh session would. */
export function resetStatSidesForTests(): void {
  named.clear();
}

async function recordPlayers(
  record: StatRecord,
  read: StatFactionReads,
): Promise<StatRecord["players"]> {
  const key = `${record.path}|${record.filename}|${record.sizeBytes}|${record.modifiedMs}`;
  const before = named.get(key);
  if (before) return before;

  // Every version of a game spells its sides and start units the same way.
  const game = closestInstalledGame(record.gameType, read.games);
  const sides = game ? await read.sides(game.primaryArchive.name) : [];

  // A unit id counts into the recorded version's list and no other. A remix's
  // ids are those of the game it was made from, which a record does not name.
  let units: UnitDatasetEntry[] | null = null;
  const byUnit = record.players.some((p) => needsUnitList(p.pick));
  if (byUnit && !record.remixed) {
    const kept = record.gameId ? await read.kept(record.gameId) : null;
    const source = pickUnitSource(
      record.gameType,
      read.games,
      storedListFor(kept, "stream"),
    );
    if (source.kind === "stored") units = source.list.units;
    else if (source.kind === "installed")
      units = await read.units(source.game.primaryArchive.name);
  }

  const players = withPickedSides(record.players, units, sides);
  const all = record.players.every(
    (p) => !p.pick || pickedSide(p.pick, units, sides) !== undefined,
  );
  if (all && sides.length > 0) named.set(key, players);
  return players;
}

/**
 * The stats records with each picked side in place of the script's. One replay
 * at a time, so a library does not start a read for every game at once. A replay
 * whose reads fail keeps the script's sides.
 */
export async function resolveStatSides(
  records: StatRecord[],
  read: StatFactionReads,
): Promise<StatRecord[]> {
  const out: StatRecord[] = [];
  for (const record of records) {
    if (!record.players.some((p) => p.pick)) {
      out.push(record);
      continue;
    }
    try {
      const players = await recordPlayers(record, read);
      out.push(players === record.players ? record : { ...record, players });
    } catch {
      out.push(record);
    }
  }
  return out;
}
