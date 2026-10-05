import type { GalaxyDoc, GalaxyNode, NodeBattleSpec } from "../model";

/**
 * The fingerprint of a hand-made map: a short text that is the same for two
 * copies of a map exactly when a conquest or a Warpath run plays the same on
 * both. A challenge code carries it beside the map's id, so a player with a
 * different version of the map is told so and the challenge does not start.
 *
 * What changes the fingerprint:
 *
 * - the game's `shortname`
 * - each faction's id, aggression, AI and side, whether the player may pick
 *   it, and the order the factions are listed in
 * - each location's id, owner, whether it is a capital, its difficulty, its
 *   battle (the map, enemy count, AI, start positions, mod options, disabled
 *   units and handicap), its Warpath kind, and the order the locations are
 *   listed in
 * - the scenario a location plays: its setup, teams, zones, units, triggers,
 *   objectives and the rest of what the scenario builder exported
 * - which locations are joined and how: borders from the province image,
 *   crossings and roads
 * - blocked borders
 * - the Warpath start and goal
 *
 * What does not:
 *
 * - the map's title and description, and a location's name and blurb
 * - a scenario's file name, its own name and description, its dates and its
 *   dialogue clips
 * - a faction's name and colour, and the faction picked by default
 * - the map picture, the heightmap and its scale, the map's size in map units
 *   and the placed models
 * - where a marker sits (`anchor` and `pos`)
 * - the colour a province is painted in
 * - a repaint of the province image that leaves every province touching the
 *   same neighbours
 * - how the images are compressed, and the pinned archive name of the game
 * - a battle's download hint
 *
 * The order of factions and locations counts because play depends on it: the
 * battles coilbox picks for blank locations are drawn in location order, so
 * the same seed gives different battles after a reorder.
 *
 * Province shapes count only through their neighbours. Play never reads a
 * shape, only who touches whom. The outlines are also the one part of a map
 * that is not safe to hash: they are simplified with floating point distances,
 * and the pixels they are traced from are decoded by the webview, which may
 * round a part transparent pixel differently on each operating system. A pixel
 * count per province would move with that rounding. The neighbour list is
 * whole numbers and only moves when two provinces start or stop touching.
 *
 * A play-relevant field added later must be left out of the hashed text when
 * a map does not use it, so the fingerprint of every existing map stays as it
 * is.
 */

/**
 * The size of a fingerprint in bits, written as 16 hex digits.
 *
 * It only has to tell versions of one map apart, because the code names the
 * map by id as well. Among 1000 versions of one map the chance that any two
 * share a fingerprint is about 1000 * 1000 / 2^65, which is 3 in 10^14. It is
 * not a defence against a map built to collide. Somebody who did that would
 * only spoil a comparison of results.
 */
export const FINGERPRINT_BITS = 64;

type Plain =
  | string
  | number
  | boolean
  | null
  | undefined
  | Plain[]
  | { [key: string]: Plain };

/** JSON with object keys in code unit order and absent values left out. */
function canonicalJson(value: Plain): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v ?? null)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** An author's battle as it counts for play. Absent for a blank battle, which
 * coilbox fills when a conquest starts. */
function battleOf(battle: NodeBattleSpec): Plain {
  if (battle.mapName === "") return undefined;
  return {
    mapName: battle.mapName,
    enemyAiCount: battle.enemyAiCount,
    enemyAiKey: battle.enemyAiKey,
    startPosType: battle.startPosType,
    modOptionValues: battle.modOptionValues,
    disabledUnits: battle.disabledUnits
      ? [...battle.disabledUnits].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      : undefined,
    handicap: battle.handicap,
  };
}

/**
 * The scenario a location plays in place of a skirmish, as it counts for
 * play: the scenario itself as the reader parsed it, and not the name of its
 * file. A scenario changed under the same file name is a different fight, and
 * the same scenario under a new file name is not.
 *
 * Its id, name, description, dates and the editor's id counters are left out,
 * as are the dialogue clips, which are sound. Everything else stays in, the
 * game build it was exported on included. The scenario builder writes many
 * fields and picking through them for the ones a mission reads would go stale
 * the first time one is added. The cost is that exporting the scenario again
 * after any other change gives a new version of the map, which errs on the
 * side of saying so.
 */
function scenarioOf(node: GalaxyNode): Plain {
  if (!node.scenario) return undefined;
  const {
    id: _id,
    name: _name,
    description: _description,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    idCounters: _idCounters,
    ...play
  } = node.scenario.doc;
  // A parsed scenario is plain JSON.
  return play as unknown as Plain;
}

/**
 * The text that is hashed, exported so a test can show what went in. See the
 * top of this file for what it holds.
 */
export function fingerprintText(doc: GalaxyDoc): string {
  const playable = new Set(doc.playableFactionIds ?? [doc.playerFactionId]);
  return canonicalJson({
    game: doc.game.shortname,
    factions: doc.factions.map((f) => ({
      id: f.id,
      aggression: f.aggression,
      aiKey: f.aiKey,
      side: f.side,
      playable: playable.has(f.id) ? undefined : false,
    })),
    locations: doc.nodes.map((n) => ({
      id: n.id,
      owner: n.owner,
      capital: n.kind === "capital" ? true : undefined,
      difficulty: n.difficulty,
      battle: battleOf(n.battle),
      warpath: doc.warpath?.kinds[n.id],
      scenario: scenarioOf(n),
    })),
    links: (
      doc.linkKinds ?? doc.links.map(([a, b]): [string, string] => [a, b])
    ).map((link) => [...link]),
    blockedBorders: doc.blockedBorders?.map((pair) => [...pair]),
    warpath: doc.warpath
      ? { start: doc.warpath.startId, goal: doc.warpath.goalId }
      : undefined,
  });
}

/**
 * Hash a text to 64 bits as 16 hex digits. Two 32-bit states are multiplied
 * through every UTF-16 code unit and then mixed into each other, all in
 * `Math.imul`, so the answer is the same on every platform.
 */
function hash64(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ unit, 2654435761);
    h2 = Math.imul(h2 ^ unit, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (v: number) => (v >>> 0).toString(16).padStart(8, "0");
  return hex(h2) + hex(h1);
}

/** The fingerprint of a hand-made map as its reader gave it. */
export function handmadeMapFingerprint(doc: GalaxyDoc): string {
  return hash64(fingerprintText(doc));
}
