import { aiKey } from "../play/participants";
import type { Faction, GalaxyDoc, GalaxyNode } from "./model";
import { MAX_DIFFICULTY, NEUTRAL } from "./model";
import { mulberry32, pick, type Rng, shuffled } from "./rng";

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

export interface GenerateOptions {
  seed: number;
  game: { shortname: string };
  maps: GenMap[];
  ais: GenAi[];
  /** Total nodes, clamped to 8..40. */
  nodeCount: number;
  /** Enemy factions, clamped to 1..3. */
  factionCount: number;
  /** Document id; defaults to `generated-<seed>`. */
  id?: string;
  title?: string;
}

const STAR_FIRST = [
  "Al",
  "Be",
  "Cal",
  "Dra",
  "Eri",
  "Fom",
  "Gal",
  "Hel",
  "Ika",
  "Jun",
  "Kel",
  "Lyr",
  "Mira",
  "Nadi",
  "Oph",
  "Pol",
  "Quo",
  "Rig",
  "Sar",
  "Tau",
  "Ur",
  "Vel",
  "Wez",
  "Xi",
  "Yed",
  "Zos",
];
const STAR_LAST = [
  "an",
  "ara",
  "bar",
  "dar",
  "el",
  "eus",
  "gol",
  "ion",
  "ith",
  "mar",
  "nak",
  "os",
  "phus",
  "ran",
  "sha",
  "tis",
  "una",
  "vor",
  "wen",
  "zar",
];
const FACTION_ADJ = [
  "Crimson",
  "Obsidian",
  "Auric",
  "Verdant",
  "Umbral",
  "Radiant",
  "Ashen",
  "Sovereign",
];
/**
 * Faction colours: fully saturated so territory rings and UI chips read
 * unmistakably against the muted starfield. Player first (blue).
 */
const FACTION_COLORS = [
  "#2f7dff", // vivid blue (player default)
  "#ff3524", // red
  "#ffb300", // amber
  "#00c853", // green
] as const;

const FACTION_NOUN = [
  "Dominion",
  "Concord",
  "Ascendancy",
  "Compact",
  "Hegemony",
  "Syndicate",
  "Covenant",
  "Remnant",
];

/** A pronounceable star name, unique within one generation run. */
function starName(rng: Rng, used: Set<string>): string {
  for (let attempt = 0; ; attempt++) {
    let name = pick(rng, STAR_FIRST) + pick(rng, STAR_LAST);
    if (attempt > 8) name = `${name} ${Math.floor(rng() * 90) + 10}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
}

type Pt = [number, number];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Scatter points in a disc with a minimum spacing (dart throwing). */
function scatter(rng: Rng, count: number, radius: number): Pt[] {
  const minDist = (radius * 1.6) / Math.sqrt(count);
  const pts: Pt[] = [];
  let relax = 0;
  while (pts.length < count) {
    const r = radius * Math.sqrt(rng());
    const t = rng() * Math.PI * 2;
    const p: Pt = [r * Math.cos(t), r * Math.sin(t)];
    if (pts.every((q) => dist(p, q) >= minDist - relax)) {
      pts.push(p);
      relax = 0;
    } else {
      // Ease the spacing if the disc is getting crowded, so we always finish.
      relax += minDist / 50;
    }
  }
  return pts;
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
  const nodeCount = Math.min(40, Math.max(8, Math.round(opts.nodeCount)));
  const enemyCount = Math.min(3, Math.max(1, Math.round(opts.factionCount)));

  const pts = scatter(rng, nodeCount, 100);
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

  // Factions: player first, then enemies, colours cycled from the palette.
  const usedNames = new Set<string>();
  const nouns = shuffled(rng, FACTION_NOUN);
  const factionNames = shuffled(rng, FACTION_ADJ).map(
    (adj, i) => `${adj} ${nouns[i % nouns.length]}`,
  );
  const factions: Faction[] = [];
  for (let i = 0; i <= enemyCount; i++) {
    factions.push({
      id: i === 0 ? "player" : `enemy-${i}`,
      name: factionNames[i],
      color: FACTION_COLORS[i % FACTION_COLORS.length],
      aggression: i === 0 ? 0 : 0.3 + rng() * 0.2,
      aiKey:
        opts.ais.length > 0 ? aiKey(opts.ais[i % opts.ais.length]) : undefined,
    });
  }

  // Ownership: capitals plus their immediate neighbours; everything else
  // starts neutral so early expansion has low-stakes targets.
  const owners = new Array<string>(nodeCount).fill(NEUTRAL);
  const adj: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const [a, b] of links) {
    adj[a].push(b);
    adj[b].push(a);
  }
  capitals.forEach((cap, f) => {
    owners[cap] = factions[f].id;
    for (const n of adj[cap]) {
      if (!capitals.includes(n) && owners[n] === NEUTRAL) {
        owners[n] = factions[f].id;
      }
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
    name: starName(rng, usedNames),
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
    createdAt: now,
    updatedAt: now,
    generated: { seed: opts.seed },
  };
}
