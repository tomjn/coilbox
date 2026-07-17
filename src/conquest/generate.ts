import { aiKey } from "../play/participants";
import { type ConquestAiConfig, factionAiPool } from "./ai";
import type { Faction, GalaxyDoc, GalaxyNode } from "./model";
import { MAX_DIFFICULTY, NEUTRAL } from "./model";
import type { ConquestNames } from "./names";
import { factionSpecs, makeStarNamer, resolveConquestNames } from "./names";
import { mulberry32, pick, type Rng } from "./rng";

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
export interface GenAi {
  kind: "native" | "lua";
  shortName: string;
  name?: string;
}

/** How node positions are scattered on the strategic plane. */
export type GalaxyLayout = "scatter" | "spiral" | "clusters" | "ring";

export interface GenerateOptions {
  seed: number;
  game: { shortname: string };
  maps: GenMap[];
  ais: GenAi[];
  /** Total nodes, clamped to 8..80. */
  nodeCount: number;
  /** Enemy factions, clamped to 1..3. */
  factionCount: number;
  /** Point-scatter shape; `random` picks one from the seed. Default `scatter`. */
  layout?: GalaxyLayout | "random";
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
  /** Per-game conquest AI config from the branding catalog (deny-list, pool). */
  aiConfig?: ConquestAiConfig;
  /** Document id; defaults to `generated-<seed>`. */
  id?: string;
  title?: string;
}

type Pt = [number, number];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

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
  if (!layout || layout === "scatter") return "scatter";
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

  // Connectivity repair: union-find, then bridge closest component pairs.
  const parent = pts.map((_, i) => i);
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
  for (const [a, b] of links) union(a, b);
  for (;;) {
    const roots = new Set(pts.map((_, i) => find(i)));
    if (roots.size <= 1) break;
    const [first, ...rest] = [...roots];
    let best: [number, number] = [-1, -1];
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pts.length; i++) {
      if (find(i) !== first) continue;
      for (let j = 0; j < pts.length; j++) {
        if (!rest.includes(find(j))) continue;
        const d = dist(pts[i], pts[j]);
        if (d < bestD) {
          bestD = d;
          best = [i, j];
        }
      }
    }
    links.push(best);
    union(best[0], best[1]);
  }
  return links;
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
  const requested = Math.round(opts.nodeCount);
  const capped =
    names.limitToNamed && names.starNames.length > 0
      ? Math.min(requested, names.starNames.length)
      : requested;
  const nodeCount = Math.min(80, Math.max(8, capped));

  const layout = resolveLayout(opts.layout, rng);
  const pts = scatterFor(layout, rng, nodeCount, 100);
  const links = buildLinks(pts);

  // Player capital: the westernmost node. Enemy capitals: farthest-point
  // sampling so multiple factions start spread apart.
  const playerCapital = pts.reduce(
    (best, p, i) => (p[0] < pts[best][0] ? i : best),
    0,
  );
  const capitals = [playerCapital];
  for (let f = 0; f < enemyCount; f++) {
    let far = -1;
    let farD = -1;
    for (let i = 0; i < pts.length; i++) {
      if (capitals.includes(i)) continue;
      const d = Math.min(...capitals.map((c) => dist(pts[i], pts[c])));
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
  // Faction opponents draw only from real playing AIs — never a do-nothing test
  // bot or a chicken/wildlife AI (which is reserved for neutral garrisons).
  const pool = factionAiPool(opts.ais, opts.aiConfig);
  const factions: Faction[] = specs.map((spec, i) => ({
    id: i === 0 ? "player" : `enemy-${i}`,
    name: spec.name,
    color: spec.color,
    aggression: i === 0 ? 0 : (spec.aggression ?? 0.3 + rng() * 0.2),
    side: spec.side,
    aiKey: pool.length > 0 ? aiKey(pool[i % pool.length]) : undefined,
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
  const startCount =
    opts.startingSystems === undefined
      ? undefined
      : Math.min(4, Math.max(1, Math.round(opts.startingSystems)));
  capitals.forEach((cap, f) => {
    owners[cap] = factions[f].id;
    const neighbours = adj[cap]
      .filter((n) => !capitals.includes(n))
      .sort((a, b) => dist(pts[cap], pts[a]) - dist(pts[cap], pts[b]));
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
  const byArea = [...opts.maps].sort(
    (a, b) =>
      (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0),
  );
  const tierFor = (d: number) => {
    if (byArea.length === 0) return [];
    const per = byArea.length / MAX_DIFFICULTY;
    const start = Math.floor((d - 1) * per);
    const end = Math.max(start + 1, Math.floor(d * per));
    return byArea.slice(start, end);
  };
  const tierCursor = new Map<number, number>();
  const mapFor = (d: number): string => {
    const tier = tierFor(d);
    const poolAll = tier.length > 0 ? tier : byArea;
    if (poolAll.length === 0) return "";
    const cursor = tierCursor.get(d) ?? Math.floor(rng() * poolAll.length);
    tierCursor.set(d, cursor + 1);
    return poolAll[cursor % poolAll.length].name;
  };

  const nodes: GalaxyNode[] = pts.map((p, i) => ({
    id: `node-${i}`,
    name: starName(usedNames),
    pos: [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10],
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
    description: `A procedurally generated conquest of ${nodeCount} systems.`,
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
      skin: opts.skin === "theatre" ? "theatre" : "galaxy",
      startingSystems: startCount,
      fogOfWar: opts.fogOfWar ? true : undefined,
    },
  };
}

/** The content environment a reroll resolves at call time (never persisted). */
export interface RegenerateEnv {
  maps: GenMap[];
  ais: GenAi[];
  names?: ConquestNames;
  aiConfig?: ConquestAiConfig;
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
      ais: env.ais,
      nodeCount: g.nodeCount,
      factionCount: g.factionCount,
      layout: g.layout,
      skin: g.skin,
      startingSystems: g.startingSystems,
      fogOfWar: g.fogOfWar,
      names: env.names,
      aiConfig: env.aiConfig,
      id: galaxy.id,
      title: galaxy.title,
    },
    now,
  );
  return { ...doc, createdAt: galaxy.createdAt };
}
