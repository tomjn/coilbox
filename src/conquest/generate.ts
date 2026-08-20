import type { NodeMaps } from "../challenge/nodeMaps";
import type { Faction, GalaxyDoc, GalaxyNode } from "./model";
import { MAX_DIFFICULTY, NEUTRAL } from "./model";
import type { ConquestNames } from "./names";
import { factionSpecs, makeStarNamer, resolveConquestNames } from "./names";
import { DEFAULT_RADIUS_LY, systemsWithin } from "./realstars";
import { hashString, mulberry32, pick, type Rng } from "./rng";

/**
 * Procedural galaxy generation — the fallback when a game ships no authored
 * galaxy. Produces the exact same {@link GalaxyDoc} shape, so everything
 * downstream is agnostic to how a galaxy was made. Fully deterministic from
 * the seed; the wizard offers a reroll by changing it.
 */

/** Minimal structural shapes of installed content (keeps this module pure). */
export interface GenMap {
  name: string;
  width?: number;
  height?: number;
}
/** How node positions are scattered on the strategic plane. `realstars` is not
 * a scatter at all: it reads the real solar neighbourhood from the catalogue. */
export type GalaxyLayout = "scatter" | "spiral" | "clusters" | "ring";

/**
 * One node's worth of position and identity, before it becomes a
 * {@link GalaxyNode}. Procedural scatters emit bare coordinates with `z: 0`
 * and no name, so naming and star class fall back to the usual hashes. The
 * real-star source fills all of it in.
 *
 * This is the seam the whole real-star mode hangs off. Everything downstream
 * of it (capitals, difficulty, map tiering, factions) is unchanged.
 */
export interface SourceStar {
  pos: [number, number, number];
  /** Real name. Absent, so `starName()` supplies one. */
  name?: string;
  /** Spectral type per component, brightest first. Absent on procedural nodes. */
  spectral?: string[];
  /** Sol. Becomes the player capital instead of the westernmost node. */
  home?: boolean;
}

/**
 * Systems within this many light years of each other get a jump lane. Chosen
 * by measuring the real catalogue: 8 light years gives 1.7 to 2.2 lanes per
 * system across every offered radius, matching the density of the procedural
 * maps. Shorter ranges fragment the neighbourhood badly, leaving the
 * connectivity repair to invent most of the map.
 */
export const JUMP_RANGE_LY = 8;

/**
 * Most lanes a single system gets. Without a cap, a star sitting in a crowded
 * pocket becomes a hub with eight or more lanes, which reads as noise on the
 * map and makes that system a chokepoint the strategy never intended.
 */
export const MAX_LANES_PER_SYSTEM = 4;

/** Added to a bridge's cost when either end is already at the lane cap. Larger
 * than the galaxy so an unsaturated bridge always wins when one exists. */
const SATURATED_BRIDGE_PENALTY = 1000;

/** Smallest map first. The difficulty tiers are windows over this order. */
function mapsByArea(maps: GenMap[]): GenMap[] {
  return [...maps].sort(
    (a, b) =>
      (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0),
  );
}

/** The slice of the area-sorted pool a node of this difficulty draws from. */
function mapTier(byArea: GenMap[], difficulty: number): GenMap[] {
  if (byArea.length === 0) return [];
  const per = byArea.length / MAX_DIFFICULTY;
  const start = Math.floor((difficulty - 1) * per);
  const end = Math.max(start + 1, Math.floor(difficulty * per));
  return byArea.slice(start, end);
}

export interface GenerateOptions {
  seed: number;
  game: { shortname: string };
  maps: GenMap[];
  /** Total nodes, clamped to 8..80. */
  nodeCount: number;
  /** Enemy factions, clamped to 1..3. */
  factionCount: number;
  /** Point-scatter shape; `random` picks one from the seed. Default `scatter`. */
  layout?: GalaxyLayout | "random" | "realstars";
  /** Real-star mode only. Catalogue radius in light years, which decides the
   * node count. Ignored by every other layout. */
  radiusLy?: number;
  /** Strategic-map presentation; sets `theme.skin`. Default `galaxy`. */
  skin?: "galaxy" | "theatre";
  /**
   * Starting systems per faction (1..4): the capital plus that many minus one
   * nearest neighbours. Omitted keeps the capital plus *all* its neighbours.
   */
  startingSystems?: number;
  /** Hide systems more than two jumps from your territory (sets `rules.fogOfWar`). */
  fogOfWar?: boolean;
  /** Naming pools / faction presets from a profile and/or the branding catalog. */
  names?: ConquestNames;
  /** Document id; defaults to `generated-<seed>`. */
  id?: string;
  title?: string;
}

type Pt = [number, number];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

type Pt3 = [number, number, number];
const dist3 = (a: Pt3, b: Pt3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Lift a flat scatter into source stars, which is what the generator consumes. */
const flatSource = (pts: Pt[]): SourceStar[] =>
  pts.map((p) => ({ pos: [p[0], p[1], 0] }));

/** Standard-normal sample (Box–Muller, one output). */
function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/**
 * Pack `count` points with a minimum spacing by dart-throwing: draw a
 * candidate from `sample`, accept it if it clears every placed point, and ease
 * the spacing as the plane crowds so the loop always finishes. Shared by all
 * layouts so only the candidate distribution differs.
 */
function packWithSampler(
  rng: Rng,
  count: number,
  radius: number,
  sample: () => Pt,
): Pt[] {
  const minDist = (radius * 1.6) / Math.sqrt(count);
  const pts: Pt[] = [];
  let relax = 0;
  while (pts.length < count) {
    const p = sample();
    // Varied spacing: each candidate rolls its own acceptance distance
    // (0.65..1.35 of the base, mean 1.0) so the field gets tight pairs and
    // open gaps instead of a uniform carpet.
    const need = minDist * (0.65 + rng() * 0.7) - relax;
    if (pts.every((q) => dist(p, q) >= need)) {
      pts.push(p);
      relax = 0;
    } else {
      relax += minDist / 50;
    }
  }
  return pts;
}

/** Even disc scatter — the original galaxy shape. */
function scatterDisc(rng: Rng, count: number, radius: number): Pt[] {
  return packWithSampler(rng, count, radius, () => {
    const r = radius * Math.sqrt(rng());
    const t = rng() * Math.PI * 2;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
}

/** Two-armed log-spiral: stars hug winding arms with gaussian scatter. */
function scatterSpiral(rng: Rng, count: number, radius: number): Pt[] {
  const arms = 2 + Math.floor(rng() * 2); // 2 or 3
  const wind = 3.2;
  return packWithSampler(rng, count, radius, () => {
    const arm = Math.floor(rng() * arms);
    const r = radius * (0.12 + 0.88 * Math.sqrt(rng()));
    const spread = 0.16 + 0.22 * (r / radius);
    const angle =
      (arm * 2 * Math.PI) / arms +
      Math.log(1 + r / radius) * wind +
      gaussian(rng) * spread;
    return [Math.cos(angle) * r, Math.sin(angle) * r];
  });
}

/** Several gaussian blobs — connectivity repair bridges them into a whole. */
function scatterClusters(rng: Rng, count: number, radius: number): Pt[] {
  const k = 3 + Math.floor(rng() * 3); // 3..5 clusters
  const centres: Pt[] = Array.from({ length: k }, () => {
    const r = radius * 0.62 * Math.sqrt(rng());
    const t = rng() * Math.PI * 2;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  const spread = radius * 0.28;
  return packWithSampler(rng, count, radius, () => {
    const c = centres[Math.floor(rng() * k)];
    return [c[0] + gaussian(rng) * spread, c[1] + gaussian(rng) * spread];
  });
}

/** An annulus: an open core with the systems ringing it. */
function scatterRing(rng: Rng, count: number, radius: number): Pt[] {
  return packWithSampler(rng, count, radius, () => {
    const r = radius * (0.55 + 0.45 * rng());
    const t = rng() * Math.PI * 2;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
}

/** Resolve a (possibly `random`) layout to a concrete one, seed-deterministic. */
function resolveLayout(
  layout: GenerateOptions["layout"],
  rng: Rng,
): GalaxyLayout {
  // `realstars` never reaches here, since it bypasses the scatters entirely.
  if (!layout || layout === "scatter" || layout === "realstars") {
    return "scatter";
  }
  if (layout === "random") {
    return pick(rng, ["scatter", "spiral", "clusters", "ring"] as const);
  }
  return layout;
}

/** Scatter points for a resolved layout. */
function scatterFor(
  layout: GalaxyLayout,
  rng: Rng,
  count: number,
  radius: number,
): Pt[] {
  switch (layout) {
    case "spiral":
      return scatterSpiral(rng, count, radius);
    case "clusters":
      return scatterClusters(rng, count, radius);
    case "ring":
      return scatterRing(rng, count, radius);
    default:
      return scatterDisc(rng, count, radius);
  }
}

/** The real solar neighbourhood within `radiusLy` of Sol, as source stars. */
function realStarSource(radiusLy: number): SourceStar[] {
  return systemsWithin(radiusLy).map((s) => ({
    pos: [s.pos[0], s.pos[1], s.pos[2]],
    name: s.name,
    spectral: s.components,
    home: s.home,
  }));
}

/** Do segments a-b and c-d properly intersect (shared endpoints excluded)? */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** k-nearest-neighbour lanes, crossing-pruned, then reconnected. */
function buildLinks(pts: Pt[]): [number, number][] {
  const k = 3;
  const linkSet = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (let i = 0; i < pts.length; i++) {
    const near = pts
      .map((p, j) => ({ j, d: dist(pts[i], p) }))
      .filter(({ j }) => j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, k);
    for (const { j } of near) linkSet.add(key(i, j));
  }
  let links = [...linkSet].map(
    (s) => s.split(":").map(Number) as [number, number],
  );

  // Prune crossings: keep the shorter lane of any crossing pair.
  links.sort((l, m) => dist(pts[l[0]], pts[l[1]]) - dist(pts[m[0]], pts[m[1]]));
  const kept: [number, number][] = [];
  for (const l of links) {
    const crosses = kept.some(
      (m) =>
        !l.includes(m[0]) &&
        !l.includes(m[1]) &&
        segmentsCross(pts[l[0]], pts[l[1]], pts[m[0]], pts[m[1]]),
    );
    if (!crosses) kept.push(l);
  }
  links = kept;

  return repairConnectivity(pts.length, links, (a, b) => dist(pts[a], pts[b]));
}

/**
 * Bridge disconnected components until the graph is whole: union-find over the
 * existing lanes, then repeatedly join the closest pair spanning two
 * components. Shared by both linkers, since an unreachable system is
 * unplayable however the lanes were chosen.
 */
function repairConnectivity(
  count: number,
  links: [number, number][],
  distOf: (a: number, b: number) => number,
): [number, number][] {
  const out = [...links];
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    // Path compression keeps repeated lookups cheap.
    let cur = x;
    while (parent[cur] !== root) {
      const next = parent[cur];
      parent[cur] = root;
      cur = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  for (const [a, b] of out) union(a, b);
  for (;;) {
    const roots = new Set(parent.map((_, i) => find(i)));
    if (roots.size <= 1) break;
    const [first, ...rest] = [...roots];
    let best: [number, number] = [-1, -1];
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      if (find(i) !== first) continue;
      for (let j = 0; j < count; j++) {
        if (!rest.includes(find(j))) continue;
        const d = distOf(i, j);
        if (d < bestD) {
          bestD = d;
          best = [i, j];
        }
      }
    }
    out.push(best);
    union(best[0], best[1]);
  }
  return out;
}

/**
 * Jump-range lanes for real 3D positions: link every pair within `range` light
 * years, then repair. The 2D crossing prune is deliberately absent, because two
 * lanes properly crossing in 3D is vanishingly rare and testing it in
 * projection would cut lanes that never actually meet.
 *
 * The real data gives this texture for free. Crowded regions end up densely
 * connected while isolated stars hang off one or two lanes, which no uniform
 * nearest-neighbour rule would produce.
 */
function buildRangeLinks(
  stars: SourceStar[],
  range: number,
): [number, number][] {
  const candidates: { pair: [number, number]; d: number }[] = [];
  for (let i = 0; i < stars.length; i++) {
    for (let j = i + 1; j < stars.length; j++) {
      const d = dist3(stars[i].pos, stars[j].pos);
      if (d <= range) candidates.push({ pair: [i, j], d });
    }
  }
  // Shortest lanes first, so when a crowded system hits its cap the lanes it
  // keeps are the ones to its nearest neighbours.
  candidates.sort((a, b) => a.d - b.d);
  const degree = new Array<number>(stars.length).fill(0);
  const links: [number, number][] = [];
  for (const { pair } of candidates) {
    const [a, b] = pair;
    if (
      degree[a] >= MAX_LANES_PER_SYSTEM ||
      degree[b] >= MAX_LANES_PER_SYSTEM
    ) {
      continue;
    }
    links.push(pair);
    degree[a]++;
    degree[b]++;
  }
  // Bridges are costed as if saturated systems were far away, so the repair
  // reaches for a system with room before it breaks the cap. When every
  // candidate is full the penalty applies to all of them equally and the
  // closest pair still wins, because reachability beats tidiness: an
  // unreachable system is unplayable.
  return repairConnectivity(stars.length, links, (a, b) => {
    const d = dist3(stars[a].pos, stars[b].pos);
    const full =
      degree[a] >= MAX_LANES_PER_SYSTEM || degree[b] >= MAX_LANES_PER_SYSTEM;
    return full ? d + SATURATED_BRIDGE_PENALTY : d;
  });
}

/** BFS hop distances from a start node over an adjacency list. */
function hopDistances(count: number, links: [number, number][], start: number) {
  const adj: number[][] = Array.from({ length: count }, () => []);
  for (const [a, b] of links) {
    adj[a].push(b);
    adj[b].push(a);
  }
  const d = new Array<number>(count).fill(-1);
  d[start] = 0;
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    for (const n of adj[cur]) {
      if (d[n] === -1) {
        d[n] = d[cur] + 1;
        queue.push(n);
      }
    }
  }
  return d;
}

/**
 * Generate a complete, playable galaxy for a game from its installed maps and
 * AIs. Layout is a spaced disc scatter; lanes are pruned k-nearest neighbours;
 * the player capital sits on one edge with enemy capitals spread far away;
 * difficulty ramps with hop distance from the player capital; bigger maps are
 * biased toward harder nodes. All factions are playable.
 */
export function generateGalaxy(
  opts: GenerateOptions,
  now: string = new Date().toISOString(),
): GalaxyDoc {
  const rng = mulberry32(opts.seed);
  const enemyCount = Math.min(3, Math.max(1, Math.round(opts.factionCount)));
  const names = resolveConquestNames(opts.names);
  // limitToNamed caps the galaxy to the named-star pool (no fallback names);
  // the 8-node floor still applies, so pools smaller than 8 fill the few extra
  // names via the numeral fallback.
  // Real-star galaxies take their size and their names from the catalogue, so
  // neither the node-count knob nor the naming-pool cap applies to them.
  const realStars = opts.layout === "realstars";
  const radiusLy = opts.radiusLy ?? DEFAULT_RADIUS_LY;
  const layout = realStars ? "scatter" : resolveLayout(opts.layout, rng);

  let source: SourceStar[];
  if (realStars) {
    source = realStarSource(radiusLy);
  } else {
    const requested = Math.round(opts.nodeCount);
    const capped =
      names.limitToNamed && names.starNames.length > 0
        ? Math.min(requested, names.starNames.length)
        : requested;
    source = flatSource(
      scatterFor(layout, rng, Math.min(80, Math.max(8, capped)), 100),
    );
  }
  const nodeCount = source.length;

  const pts = source.map((s) => [s.pos[0], s.pos[1]] as Pt);
  const links = realStars
    ? buildRangeLinks(source, JUMP_RANGE_LY)
    : buildLinks(pts);

  // Distances are measured in 3D throughout. Procedural sources are flat, so
  // this is identical to the old planar maths for them.
  const distAt = (a: number, b: number) => dist3(source[a].pos, source[b].pos);

  // Player capital: Sol when the source names a home, else the westernmost
  // node. Enemy capitals: farthest-point sampling so multiple factions start
  // spread apart.
  const home = source.findIndex((s) => s.home);
  const playerCapital =
    home >= 0
      ? home
      : pts.reduce((best, p, i) => (p[0] < pts[best][0] ? i : best), 0);
  const capitals = [playerCapital];
  for (let f = 0; f < enemyCount; f++) {
    let far = -1;
    let farD = -1;
    for (let i = 0; i < source.length; i++) {
      if (capitals.includes(i)) continue;
      const d = Math.min(...capitals.map((c) => distAt(i, c)));
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    capitals.push(far);
  }

  // Factions: player first, then enemies. Names/colours/sides come from the
  // resolved pools (a game's lore factions when supplied, else synthesized);
  // aggression uses a preset when given, else a generated spread.
  const usedNames = new Set<string>();
  const starName = makeStarNamer(rng, names);
  const specs = factionSpecs(rng, names, enemyCount + 1);
  const factions: Faction[] = specs.map((spec, i) => ({
    id: i === 0 ? "player" : `enemy-${i}`,
    name: spec.name,
    color: spec.color,
    aggression: i === 0 ? 0 : (spec.aggression ?? 0.3 + rng() * 0.2),
    side: spec.side,
    // No AI is pinned here: the opponent is chosen when the battle is
    // synthesised, from the node's difficulty against whatever the player has
    // installed (see `synthesize.ts`). Only a hand-authored galaxy names one.
  }));

  // Ownership: each capital plus a ring of its nearest neighbours. Without a
  // `startingSystems` cap this is *all* neighbours (the original behaviour);
  // with one it is the capital plus that many minus one nearest neighbours, so
  // a lean start still leaves an attackable frontier on turn 0.
  const owners = new Array<string>(nodeCount).fill(NEUTRAL);
  const adj: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const [a, b] of links) {
    adj[a].push(b);
    adj[b].push(a);
  }
  // Real-star galaxies start lean by default. The full-frontier default hands
  // every capital all its neighbours, and a small radius is dense enough that
  // this leaves no neutral territory at all: at 8 light years, all six systems
  // would be owned on turn 0 with nothing to fight over.
  const startCount =
    opts.startingSystems === undefined
      ? realStars
        ? 1
        : undefined
      : Math.min(4, Math.max(1, Math.round(opts.startingSystems)));
  capitals.forEach((cap, f) => {
    owners[cap] = factions[f].id;
    const neighbours = adj[cap]
      .filter((n) => !capitals.includes(n))
      .sort((a, b) => distAt(cap, a) - distAt(cap, b));
    const take = startCount === undefined ? neighbours.length : startCount - 1;
    for (const n of neighbours.slice(0, take)) {
      if (owners[n] === NEUTRAL) owners[n] = factions[f].id;
    }
  });

  // Difficulty ramps with hop distance from the player capital; enemy
  // capitals are always max difficulty.
  const hops = hopDistances(nodeCount, links, playerCapital);
  const maxHop = Math.max(1, ...hops.filter((h) => h >= 0));
  const difficulty = hops.map((h, i) => {
    if (capitals.slice(1).includes(i)) return MAX_DIFFICULTY;
    const t = (h < 0 ? maxHop : h) / maxHop;
    return Math.max(1, Math.min(MAX_DIFFICULTY, Math.ceil(t * MAX_DIFFICULTY)));
  });

  // Maps by area, bucketed into difficulty tiers (bigger -> harder), cycling
  // within a tier so a small pool still varies.
  const byArea = mapsByArea(opts.maps);
  const tierFor = (d: number) => mapTier(byArea, d);
  const tierCursor = new Map<number, number>();
  const mapFor = (d: number): string => {
    const tier = tierFor(d);
    const poolAll = tier.length > 0 ? tier : byArea;
    if (poolAll.length === 0) return "";
    const cursor = tierCursor.get(d) ?? Math.floor(rng() * poolAll.length);
    tierCursor.set(d, cursor + 1);
    return poolAll[cursor % poolAll.length].name;
  };

  const nodes: GalaxyNode[] = source.map((s, i) => ({
    id: `node-${i}`,
    name: s.name ?? starName(usedNames),
    // Catalogue positions are already rounded and are in light years, so they
    // keep their precision. Scatter positions keep the original 0.1 rounding.
    pos: realStars
      ? [s.pos[0], s.pos[1], s.pos[2]]
      : [Math.round(s.pos[0] * 10) / 10, Math.round(s.pos[1] * 10) / 10],
    star: s.spectral ? { spectral: s.spectral } : undefined,
    owner: owners[i],
    kind: capitals.includes(i) ? "capital" : undefined,
    difficulty: difficulty[i],
    battle: { mapName: mapFor(difficulty[i]) },
  }));

  return {
    schemaVersion: 1,
    id: opts.id ?? `generated-${opts.seed >>> 0}`,
    type: "conquest-galaxy",
    title: opts.title ?? `${opts.game.shortname} Conquest`,
    description: realStars
      ? `The ${nodeCount} real star systems within ${radiusLy} light years of Sol.`
      : `A procedurally generated conquest of ${nodeCount} systems.`,
    game: { shortname: opts.game.shortname },
    playerFactionId: factions[0].id,
    playableFactionIds: factions.map((f) => f.id),
    factions,
    nodes,
    links: links.map(([a, b]) => [`node-${a}`, `node-${b}`]),
    rules: opts.fogOfWar ? { fogOfWar: true } : undefined,
    theme: opts.skin === "theatre" ? { skin: "theatre" } : undefined,
    createdAt: now,
    updatedAt: now,
    generated: {
      seed: opts.seed,
      nodeCount,
      factionCount: enemyCount,
      layout: opts.layout ?? "scatter",
      radiusLy: realStars ? radiusLy : undefined,
      skin: opts.skin === "theatre" ? "theatre" : "galaxy",
      startingSystems: startCount,
      fogOfWar: opts.fogOfWar ? true : undefined,
    },
  };
}

/**
 * Swap out node maps that are no longer allowed in conquest. A galaxy is
 * generated once and saved, but the exclusion lists behind it move: a catalog
 * update or a fresh opt-out mid-conquest can make a node's map ineligible.
 * Rather than strand the player on it, re-pick from the same difficulty tier a
 * fresh node would have drawn from.
 *
 * The choice is keyed on the node id, not on generation order, so the same node
 * lands on the same replacement on every load. Applied on read rather than
 * written back, since authored galaxies a game ships are not ours to rewrite.
 *
 * `maps` is everything installed. Returns the doc unchanged when nothing needed
 * swapping, so callers can memo on identity.
 */
export function substituteExcludedMaps(
  galaxy: GalaxyDoc,
  maps: GenMap[],
  isExcluded: (mapName: string) => boolean,
): GalaxyDoc {
  const byArea = mapsByArea(maps.filter((m) => !isExcluded(m.name)));
  if (byArea.length === 0) return galaxy;

  let changed = false;
  const nodes = galaxy.nodes.map((node) => {
    const current = node.battle.mapName;
    if (!current || !isExcluded(current)) return node;
    const tier = mapTier(byArea, node.difficulty);
    const pool = tier.length > 0 ? tier : byArea;
    const replacement = pool[hashString(node.id) % pool.length].name;
    changed = true;
    // The old map's download hint goes with it, or the battle screen would still
    // offer to fetch the map we just excluded.
    return {
      ...node,
      battle: { ...node.battle, mapName: replacement, mapDownload: undefined },
    };
  });
  return changed ? { ...galaxy, nodes } : galaxy;
}

/**
 * Put every system on the map the challenge says it uses (issue #1393).
 *
 * Generation draws maps from whatever this machine has installed, so two people
 * rebuilding the same seed get the same systems and lanes but not the same
 * battlefields. The challenge names the maps it resolved to, and this is where
 * that naming wins over the local draw.
 *
 * A named map this install cannot offer (not installed, or opted out of
 * conquest) still gets a stand-in from the same difficulty tier a fresh node
 * would draw from, keyed on the node id so it is stable. The system remembers
 * what it should have been in `mapSubstitutedFrom`, which is the whole
 * difference: a visible substitution from a known original rather than a
 * quietly different galaxy.
 *
 * `maps` is what this install can offer. Returns the doc unchanged when there
 * is nothing to name, so a challenge shared before #1393 falls straight through
 * to the maps generation already picked.
 */
export function applyChallengeMaps(
  galaxy: GalaxyDoc,
  nodeMaps: NodeMaps | undefined,
  maps: GenMap[],
): GalaxyDoc {
  if (!nodeMaps) return galaxy;
  const available = new Set(maps.map((m) => m.name));
  const byArea = mapsByArea(maps);

  let changed = false;
  const nodes = galaxy.nodes.map((node) => {
    const wanted = nodeMaps[node.id];
    if (!wanted) return node;
    let used = wanted;
    if (!available.has(wanted) && byArea.length > 0) {
      const tier = mapTier(byArea, node.difficulty);
      const pool = tier.length > 0 ? tier : byArea;
      used = pool[hashString(node.id) % pool.length].name;
    }
    const substitutedFrom = used === wanted ? undefined : wanted;
    if (
      node.battle.mapName === used &&
      node.battle.mapSubstitutedFrom === substitutedFrom
    ) {
      return node;
    }
    changed = true;
    // The generated map's download hint goes with it, or the battle screen
    // would offer to fetch a map this node no longer uses.
    return {
      ...node,
      battle: {
        ...node.battle,
        mapName: used,
        mapDownload: undefined,
        mapSubstitutedFrom: substitutedFrom,
      },
    };
  });
  return changed ? { ...galaxy, nodes } : galaxy;
}

/** The content environment a reroll resolves at call time (never persisted). */
export interface RegenerateEnv {
  maps: GenMap[];
  names?: ConquestNames;
}

/**
 * Reroll a generated galaxy in place: same id, title and generation knobs,
 * new seed, content environment re-resolved by the caller. Returns null for
 * docs without persisted knobs (authored galaxies, or generated ones saved
 * before the knobs existed).
 */
export function regenerateGalaxy(
  galaxy: GalaxyDoc,
  env: RegenerateEnv,
  seed: number,
  now: string = new Date().toISOString(),
): GalaxyDoc | null {
  const g = galaxy.generated;
  if (!g || g.nodeCount === undefined || g.factionCount === undefined) {
    return null;
  }
  const doc = generateGalaxy(
    {
      seed,
      game: { shortname: galaxy.game.shortname },
      maps: env.maps,
      nodeCount: g.nodeCount,
      factionCount: g.factionCount,
      layout: g.layout,
      radiusLy: g.radiusLy,
      skin: g.skin,
      startingSystems: g.startingSystems,
      fogOfWar: g.fogOfWar,
      names: env.names,
      id: galaxy.id,
      title: galaxy.title,
    },
    now,
  );
  return { ...doc, createdAt: galaxy.createdAt };
}
