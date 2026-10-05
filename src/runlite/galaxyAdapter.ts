import type {
  NodeBodyKind,
  NodeEmphasis,
  NodeIdentity,
} from "../conquest/galaxy3d/GalaxyView";
import { hashString } from "../conquest/galaxy3d/layout";
import { type Faction, type GalaxyDoc, NEUTRAL } from "../conquest/model";
import { isBattleNode, type RogueliteRun, type RunNodeType } from "./model";
import { successors } from "./progress";

/**
 * Adapt a run into a conquest {@link GalaxyDoc} so the run map renders through
 * the real `GalaxyView` — getting its full visual language (stellar classes,
 * binaries, coronas, asteroid/comet void bodies, connection styling) and its
 * camera (focus-on-select zoom, snap-back rotation, eased transitions) for free,
 * instead of a lesser bespoke renderer.
 *
 * The mapping: each run node becomes a system positioned by its `(col, row)`
 * (GalaxyView reprojects the 2D `pos`); node *type* is a pseudo-faction so the
 * ownership ring carries the type colour; the current node is owned by the
 * player, so the camera frames it and the lanes out of it light up as frontier.
 * Edges become undirected links (GalaxyView draws them the same either way).
 */

const TYPE_COLOR: Record<RunNodeType, string> = {
  start: "#4fe6d6",
  // Battles read as danger — a clear red, distinct from the boss's pink and
  // elite's orange.
  battle: "#e0473a",
  elite: "#ffb64d",
  event: "#b98cff",
  reward: "#ffcf5c",
  shop: "#7fe08a",
  boss: "#ff5468",
};

const TYPE_LABEL: Record<RunNodeType, string> = {
  start: "Command",
  battle: "Battle",
  elite: "Elite",
  event: "Event",
  reward: "Salvage",
  shop: "Depot",
  boss: "Warlord",
};

const RUN_TYPES = Object.keys(TYPE_COLOR) as RunNodeType[];

/**
 * Curated per-run backdrop palettes. A run picks one by its seed so every run
 * reads as its own place - a bold nebula swathe plus matching starfield tints,
 * far more distinct than conquest's restrained default. `nebula` drives
 * GalaxyView's nebula-swathe layer (only rendered when present); `stars` tints
 * the decorative starfield.
 */
const RUN_PALETTES: { nebula: string[]; stars: string[] }[] = [
  { nebula: ["#ff5a3c", "#ff9d4d", "#7a1f12"], stars: ["#ffd9a0", "#ffb877"] },
  { nebula: ["#2ad2ff", "#4f7bff", "#0e3a5c"], stars: ["#cfeaff", "#a0c8ff"] },
  { nebula: ["#b06bff", "#ff5ea8", "#3a1a5c"], stars: ["#e6ccff", "#ffc0e0"] },
  { nebula: ["#3ce08a", "#2ad2ff", "#123a2a"], stars: ["#c8ffe0", "#a0ffd0"] },
  { nebula: ["#ffcf5c", "#ff8c3a", "#5c3a12"], stars: ["#fff0c0", "#ffd9a0"] },
  { nebula: ["#ff6b8a", "#ff4f4f", "#5c1224"], stars: ["#ffd0da", "#ffb0c0"] },
];

/** The backdrop palette for a run, chosen deterministically from its seed. */
export function runPalette(seed: number): {
  nebula: string[];
  stars: string[];
} {
  const i =
    ((Math.trunc(seed) % RUN_PALETTES.length) + RUN_PALETTES.length) %
    RUN_PALETTES.length;
  return RUN_PALETTES[i];
}

/** The faction id the run is "played as" (the current node), so the galaxy
 * view frames it and highlights its outgoing lanes. */
export const PLAYER_FACTION = "you";
/** A muted faction for already-crossed nodes, so they read as spent. */
const DONE_FACTION = "done";

/** The faction of a location the player passed through on a land map. It has
 * the player's colour, and is a faction of its own so that only the location
 * the player stands on lights the lanes ahead. */
const TAKEN_FACTION = "taken";

const typeFaction = (type: RunNodeType) => `type-${type}`;

/** The factions a run's nodes are drawn as: you, cleared, and one per type. */
function runFactions(): Faction[] {
  return [
    { id: PLAYER_FACTION, name: "You", color: TYPE_COLOR.start },
    { id: DONE_FACTION, name: "Cleared", color: "#5a6577" },
    ...RUN_TYPES.map((t) => ({
      id: typeFaction(t),
      name: TYPE_LABEL[t],
      color: TYPE_COLOR[t],
    })),
  ];
}

/** Build the GalaxyDoc for a run (memoise on run identity — a new object
 * rebuilds the scene; owners/selection/focus update live without a rebuild). */
export function runToGalaxyDoc(run: RogueliteRun): GalaxyDoc {
  const factions = runFactions();

  // Centre each column vertically so columns line up around the lane, instead
  // of all starting at row 0 (which skews the connecting lanes and makes them
  // cross). A column of k nodes spans rows centred on 0.
  const perCol = new Map<number, number>();
  for (const n of run.nodes) perCol.set(n.col, (perCol.get(n.col) ?? 0) + 1);

  const nodes = run.nodes.map((n) => ({
    id: n.id,
    name: TYPE_LABEL[n.type],
    pos: [n.col, n.row - ((perCol.get(n.col) ?? 1) - 1) / 2] as [
      number,
      number,
    ],
    owner: typeFaction(n.type),
    // Start and boss are the run's endpoints — render them as giant stars.
    kind:
      n.type === "boss" || n.type === "start"
        ? ("capital" as const)
        : undefined,
    difficulty: Math.max(1, Math.min(5, n.battle?.techTier ?? 2)),
    battle: { mapName: n.battle?.mapName ?? "" },
  }));

  const links = run.edges.map(([a, b]) => [a, b] as [string, string]);

  const palette = runPalette(run.settings.seed);

  return {
    schemaVersion: 1,
    // Seed the id: GalaxyView hashes it for the backdrop (core direction, dust,
    // nebula placement), so this is what makes each run's sky its own.
    id: `run-${run.settings.seed}`,
    type: "conquest-galaxy",
    title: "Warpath",
    description: "",
    game: run.settings.game,
    playerFactionId: PLAYER_FACTION,
    factions,
    nodes,
    links,
    theme: {
      skin: run.settings.skin,
      starPalette: palette.stars,
      nebulaColors: palette.nebula,
    },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

/** Live ownership, encoding run state through the ring colour: crossed nodes
 * are muted, the current node is the player's (cyan "you are here", framed by
 * the camera), and everything else flies its bright type colour. */
export function runOwners(run: RogueliteRun): Record<string, string> {
  const visited = new Set(run.progress.visited);
  const owners: Record<string, string> = {};
  for (const n of run.nodes) {
    owners[n.id] = visited.has(n.id) ? DONE_FACTION : typeFaction(n.type);
  }
  owners[run.progress.currentNodeId] = PLAYER_FACTION;
  return owners;
}

/** Opacity for each graded-emphasis tier (see {@link runEmphasis}). The path
 * ahead stays more present than the spent path behind; forks you can no longer
 * reach fall right back. */
export const RUN_DIM = {
  /** A node you've already crossed — kept fairly bright: it's your history, and
   * its check-mark should read clearly, not fade like the road not taken. */
  done: 0.7,
  /** Reachable ahead but not an immediate choice — the road onward. Kept clearly
   * present so the branches still open to you read as live possibilities. */
  future: 0.62,
  /** A branch you passed on / can no longer reach — pushed well back so a dead
   * fork never competes with a path you can still take. */
  unreachable: 0.12,
} as const;

/** A link key matching GalaxyView's directed `[from, to]` lane order. */
const linkKey = (a: string, b: string) => `${a} ${b}`;

/**
 * The links of the path actually taken: consecutive visited nodes by column
 * (you occupy one node per column, so the visited set sorted by column *is* your
 * route), for GalaxyView to highlight green. Robust to column-skipping edges —
 * a pair is only highlighted if a real edge joins it.
 */
export function runPathLinks(run: RogueliteRun): Set<string> {
  return new Set(runPathSteps(run).map(([a, b]) => linkKey(a, b)));
}

/** The steps behind {@link runPathLinks}, as pairs of run node ids. */
function runPathSteps(run: RogueliteRun): [string, string][] {
  const edges = new Set(run.edges.map(([a, b]) => linkKey(a, b)));
  const visited = run.nodes
    .filter((n) => run.progress.visited.includes(n.id))
    .sort((a, b) => a.col - b.col);
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < visited.length; i++) {
    const step: [string, string] = [visited[i].id, visited[i + 1].id];
    if (edges.has(linkKey(...step))) out.push(step);
  }
  return out;
}

/** Repeated node types that read as a distinct body — but only for a seeded
 * fraction of them, so a long run never shows ten identical stations. */
const IDENTITY_BODY: Partial<Record<RunNodeType, NodeBodyKind>> = {
  shop: "station",
  reward: "wreck",
  event: "anomaly",
};

/** Battle sites keep their star, tinted toward a hostile red (elite a hotter,
 * whiter danger) so the threat reads without a bespoke body. */
const DANGER_TINT: Partial<Record<RunNodeType, string>> = {
  battle: "#e0473a",
  elite: "#ff6a2a",
};

/** Chance (%) a repeated body-type rolls its special body. Low enough that most
 * depots/salvage/events stay plain stars and the special ones read as accents. */
const BODY_CHANCE = 30;

/** Chance (%) a depot reads as a dyson swarm rather than a ring-station, capped
 * at {@link DYSON_CAP} per run so they stay a rare, striking sight. */
const DYSON_DEPOT_CHANCE = 14;
/** Most a single run will show (a swarm is a set-piece, not a common body). */
const DYSON_CAP = 2;

/**
 * Per-node visual identity for the warpath map (GalaxyView's `identities` prop,
 * warpath-only). The singular endpoints are always special — the start is an
 * allied beacon, the warlord its own lair; battle sites take a danger tint; and a
 * seeded ~30% of the repeated service nodes (depot/salvage/event) read as a
 * station / wreck / anomaly rather than a plain star, kept sparse so they punctuate
 * the run instead of tiling it. Conquest never sets this, so its sky is unchanged.
 */
export function runIdentities(run: RogueliteRun): Map<string, NodeIdentity> {
  const out = new Map<string, NodeIdentity>();
  let dysonCount = 0;
  for (const n of run.nodes) {
    if (n.type === "start") {
      out.set(n.id, { body: "beacon" });
      continue;
    }
    if (n.type === "boss") {
      out.set(n.id, { body: warlordBodyFor(run.settings.seed) });
      continue;
    }
    const tint = DANGER_TINT[n.type];
    if (tint) {
      out.set(n.id, { starTint: tint });
      continue;
    }
    // A rare depot reads as a dyson swarm (a bright star cocooned in orbiting
    // collector panels) instead of the ring-station — capped per run so it stays
    // a set-piece.
    if (
      n.type === "shop" &&
      dysonCount < DYSON_CAP &&
      hashString(`${n.id}-dyson`) % 100 < DYSON_DEPOT_CHANCE
    ) {
      out.set(n.id, { body: "dyson-swarm" });
      dysonCount++;
      continue;
    }
    const body = IDENTITY_BODY[n.type];
    if (body && hashString(`${n.id}-identity`) % 100 < BODY_CHANCE) {
      out.set(n.id, { body });
    }
  }
  return out;
}

/** The warlord's lair varies per run so no two warpaths end at the same sight:
 * a stylised black hole or a blood-red hypergiant. (A fortress station was
 * dropped — the finale shouldn't read as just another depot.) */
const WARLORD_BODIES: NodeBodyKind[] = [
  "warlord-blackhole",
  "warlord-hypergiant",
];

export function warlordBodyFor(seed: number): NodeBodyKind {
  const i =
    ((Math.trunc(seed) % WARLORD_BODIES.length) + WARLORD_BODIES.length) %
    WARLORD_BODIES.length;
  return WARLORD_BODIES[i];
}

/** Every node reachable by following forward edges from `fromId` (inclusive). */
export function forwardReachable(
  run: RogueliteRun,
  fromId: string,
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const [a, b] of run.edges) {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  }
  const seen = new Set<string>([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const nb of adj.get(id) ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return seen;
}

/**
 * Graded de-emphasis for the run map, complementing {@link runOwners}. The
 * current node and its immediate choices stay full-bright (absent from the map);
 * everything else fades by how it relates to *now*: the crossed path muted, the
 * road ahead dimmed-but-clear, forks you can no longer take pushed right back.
 * Feeds GalaxyView's `emphasis` prop.
 */
export function runEmphasis(run: RogueliteRun): Map<string, NodeEmphasis> {
  const current = run.progress.currentNodeId;
  const nextIds = new Set(successors(run, current).map((n) => n.id));
  const reachable = forwardReachable(run, current);
  const visited = new Set(run.progress.visited);
  const emphasis = new Map<string, NodeEmphasis>();
  for (const n of run.nodes) {
    if (n.id === current) continue; // where you stand — full brightness
    if (visited.has(n.id)) {
      // Crossed: muted and marked done with a check (no combat there anymore).
      emphasis.set(n.id, { opacity: RUN_DIM.done, marker: "check" });
      continue;
    }
    const entry: NodeEmphasis = {};
    // Immediate choices stay full-bright (no opacity key); anything further is
    // dimmed by reachability.
    if (!nextIds.has(n.id)) {
      entry.opacity = reachable.has(n.id)
        ? RUN_DIM.future
        : RUN_DIM.unreachable;
    }
    // Battle sites still ahead flicker with distant combat.
    if (isBattleNode(n.type)) entry.flash = true;
    if (entry.opacity !== undefined || entry.flash) emphasis.set(n.id, entry);
  }
  return emphasis;
}

// ---------------------------------------------------------------------------
// A run across a land map (see `./mapRun.ts`). The map document goes to the
// view as it is, with the run's state laid over it. No position is invented:
// every location is drawn where the map has it. The functions above still do
// the work, and these move their answers from run node ids to location ids.
// ---------------------------------------------------------------------------

/**
 * Which map location each run node stands for, by run node id. Null when the
 * run was not made on this map: a node with no location, a location the map
 * does not have, or a step between two locations the map does not join. The
 * caller falls back to the column layout, which every run can be drawn in.
 */
export function runLocations(
  run: RogueliteRun,
  map: GalaxyDoc,
): Map<string, string> | null {
  const known = new Set(map.nodes.map((n) => n.id));
  const out = new Map<string, string>();
  for (const n of run.nodes) {
    if (!n.location || !known.has(n.location)) return null;
    out.set(n.id, n.location);
  }
  if (new Set(out.values()).size !== out.size) return null;
  const joined = new Set(
    map.links.flatMap(([a, b]) => [linkKey(a, b), linkKey(b, a)]),
  );
  for (const [a, b] of run.edges) {
    if (!joined.has(linkKey(out.get(a) ?? "", out.get(b) ?? ""))) return null;
  }
  return out;
}

/**
 * The map document for the view, with the run laid over it. Each location on a
 * route takes its run node's type colour, tier and battle map. The rest is
 * scenery and is neutral.
 *
 * The view lights a lane as a way forward when its first end is the player's,
 * so each step of the run is written from the earlier location to the later.
 * A link from a route location to scenery is written scenery first, which
 * never lights. A link between two route locations that is not a step joins
 * two of the same rank. It cannot be travelled in this run, and it would
 * light as a choice whichever way round it was written, so it stays as the
 * map has it and {@link mapRunClosedLinks} names it for the view.
 */
export function mapRunToGalaxyDoc(
  run: RogueliteRun,
  map: GalaxyDoc,
  locations: Map<string, string>,
): GalaxyDoc {
  const nodeAt = new Map(
    run.nodes.map((n) => [locations.get(n.id) ?? n.id, n]),
  );
  const steps = stepKeys(run, locations);

  return {
    ...map,
    title: "Warpath",
    game: run.settings.game,
    playerFactionId: PLAYER_FACTION,
    playableFactionIds: undefined,
    rules: undefined,
    factions: [
      ...runFactions(),
      { id: TAKEN_FACTION, name: "Taken", color: TYPE_COLOR.start },
    ],
    nodes: map.nodes.map((place) => {
      const n = nodeAt.get(place.id);
      if (!n) {
        return {
          ...place,
          owner: NEUTRAL,
          kind: undefined,
          battle: { mapName: "" },
        };
      }
      return {
        ...place,
        owner: typeFaction(n.type),
        kind:
          n.type === "boss" || n.type === "start"
            ? ("capital" as const)
            : undefined,
        difficulty: Math.max(1, Math.min(5, n.battle?.techTier ?? 2)),
        battle: { mapName: n.battle?.mapName ?? "" },
      };
    }),
    links: map.links.map(([a, b]): [string, string] =>
      steps.has(linkKey(b, a)) || (nodeAt.has(a) && !nodeAt.has(b))
        ? [b, a]
        : [a, b],
    ),
  };
}

/** The steps of a run as link keys between location ids, earlier end first. */
function stepKeys(run: RogueliteRun, locations: Map<string, string>) {
  return new Set(
    run.edges.map(([a, b]) =>
      linkKey(locations.get(a) ?? a, locations.get(b) ?? b),
    ),
  );
}

/**
 * The links between two route locations that are no step of the run, as the
 * view's link keys. They are written as {@link mapRunToGalaxyDoc} writes
 * them, which for these is the order the map has. The view draws such a link
 * and never lights it as a way forward.
 */
export function mapRunClosedLinks(
  run: RogueliteRun,
  map: GalaxyDoc,
  locations: Map<string, string>,
): Set<string> {
  const onRoute = new Set(locations.values());
  const steps = stepKeys(run, locations);
  const out = new Set<string>();
  for (const [a, b] of map.links) {
    if (!onRoute.has(a) || !onRoute.has(b)) continue;
    if (steps.has(linkKey(a, b)) || steps.has(linkKey(b, a))) continue;
    out.add(linkKey(a, b));
  }
  return out;
}

/**
 * The locations on no route from the start to the goal. The view draws them
 * and keeps the pointer off them: no hover, no cursor, no selection.
 */
export function mapRunScenery(
  map: GalaxyDoc,
  locations: Map<string, string>,
): Set<string> {
  const onRoute = new Set(locations.values());
  return new Set(
    map.nodes.filter((place) => !onRoute.has(place.id)).map((p) => p.id),
  );
}

/** Move a set of answers keyed by run node id onto location ids. */
function byLocation<T>(
  answers: Iterable<[string, T]>,
  locations: Map<string, string>,
): [string, T][] {
  return [...answers].map(([id, value]) => [locations.get(id) ?? id, value]);
}

/** Live ownership on a land map. The location the player stands on is theirs,
 * the ones they passed through are taken, the rest of the route keeps its type
 * colour whether it is still ahead or was gone around, and scenery is neutral. */
export function mapRunOwners(
  run: RogueliteRun,
  map: GalaxyDoc,
  locations: Map<string, string>,
): Record<string, string> {
  const owners: Record<string, string> = {};
  for (const place of map.nodes) owners[place.id] = NEUTRAL;
  for (const [id, owner] of byLocation(
    Object.entries(runOwners(run)),
    locations,
  )) {
    owners[id] = owner === DONE_FACTION ? TAKEN_FACTION : owner;
  }
  return owners;
}

/** Emphasis on a land map. Scenery is pushed right back. A location the player
 * went around stays as clear as the road ahead, so it reads as still held by
 * the enemy and not as scenery. */
export function mapRunEmphasis(
  run: RogueliteRun,
  map: GalaxyDoc,
  locations: Map<string, string>,
): Map<string, NodeEmphasis> {
  const out = new Map<string, NodeEmphasis>();
  const onRoute = new Set(locations.values());
  for (const place of map.nodes) {
    if (!onRoute.has(place.id)) {
      out.set(place.id, { opacity: RUN_DIM.unreachable });
    }
  }
  for (const [id, entry] of byLocation(runEmphasis(run), locations)) {
    out.set(
      id,
      entry.opacity === RUN_DIM.unreachable
        ? { ...entry, opacity: RUN_DIM.future }
        : entry,
    );
  }
  return out;
}

/**
 * The start and goal markers and the danger tints, by location id. The two
 * ends also say which end they are, which is what a terrain map draws its
 * start and goal markers from.
 */
export function mapRunIdentities(
  run: RogueliteRun,
  locations: Map<string, string>,
): Map<string, NodeIdentity> {
  const out = new Map(byLocation(runIdentities(run), locations));
  for (const n of run.nodes) {
    if (n.type !== "start" && n.type !== "boss") continue;
    const at = locations.get(n.id) ?? n.id;
    out.set(at, {
      ...out.get(at),
      end: n.type === "start" ? "start" : "goal",
    });
  }
  return out;
}

/** The path taken, as link keys between location ids. */
export function mapRunPathLinks(
  run: RogueliteRun,
  locations: Map<string, string>,
): Set<string> {
  const at = (id: string) => locations.get(id) ?? id;
  return new Set(runPathSteps(run).map(([a, b]) => linkKey(at(a), at(b))));
}
