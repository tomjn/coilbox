import type { GalaxyDoc, GalaxyNode } from "../model";
import { NEUTRAL } from "../model";
import { pairKey } from "./roads";

/**
 * Which state every location, link and blocked border of a terrain map is in:
 * what the player can attack, where their frontier runs, what the selected
 * location reaches, where an incursion is, and for a Warpath run the path
 * taken and the choices ahead. Pure, so the rules are tested without a scene.
 * `cueLayer.ts` hands the result to the province, city and line drawing.
 */

/** How a link is drawn on a terrain map. */
export type LinkCueKind = "road" | "crossing" | "border";

/**
 * What a link says about the two locations it joins:
 *
 * - `owned`: both ends belong to one faction
 * - `contested`: exactly one end is the player's, the galaxy's dashed lane
 * - `taken`: a step of a Warpath run the player has already made
 * - `choice`: a step open from the player's current location on a run
 * - `plain`: none of those
 */
export type LinkTone = "plain" | "owned" | "contested" | "taken" | "choice";

export interface LocationCue {
  /** The player can attack it this turn, or move to it on a run. */
  attackable: boolean;
  /** A neighbour of the selected location. */
  emphasised: boolean;
  /** An incursion is under way here. */
  threatened: boolean;
}

export interface LinkCue {
  /** The two ends, in the order the link has in the document. */
  a: string;
  b: string;
  kind: LinkCueKind;
  tone: LinkTone;
  /** The shared owner, for the `owned` tone only. */
  owner?: string;
  /** One end is the selected location. */
  emphasised: boolean;
}

/** Two locations that touch and are not neighbours. */
export interface BlockedCue {
  a: string;
  b: string;
}

export interface MapCues {
  /** One entry per node id. */
  locations: Map<string, LocationCue>;
  /** One entry per link whose two ends exist, in link order. */
  links: LinkCue[];
  blocked: BlockedCue[];
}

export interface MapCueInput {
  galaxy: Pick<GalaxyDoc, "links" | "linkKinds" | "blockedBorders"> & {
    nodes: Pick<GalaxyNode, "id" | "outline" | "owner">[];
  };
  /** Live owners by node id. A node left out keeps the document's owner. */
  owners: Record<string, string>;
  playerFactionId: string;
  selectedId?: string | null;
  /** The locations `attackableNodes` returns. Not read on a run. */
  attackable?: ReadonlySet<string>;
  incursionNodeId?: string;
  /**
   * Set on a Warpath run, where links are steps in one direction.
   * `pathLinks` holds the steps already made as `"from to"`.
   */
  run?: { pathLinks?: ReadonlySet<string> };
}

/**
 * How one link is drawn. It agrees with `roadLinks` on what is a road: a link
 * of kind `road`, or any link with a point location end that is not a
 * `crossing`. What is left between two provinces is a border.
 */
export function linkCueKind(
  kind: "border" | "crossing" | "road" | undefined,
  pointA: boolean,
  pointB: boolean,
): LinkCueKind {
  if (kind === "crossing") return "crossing";
  if (kind === "road" || pointA || pointB) return "road";
  return "border";
}

export function mapCues(input: MapCueInput): MapCues {
  const { galaxy, owners, playerFactionId, selectedId, run } = input;
  const nodes = new Map(galaxy.nodes.map((n) => [n.id, n]));
  const ownerOf = (id: string): string =>
    owners[id] ?? nodes.get(id)?.owner ?? NEUTRAL;
  const kinds = new Map(
    (galaxy.linkKinds ?? []).map(([a, b, kind]) => [pairKey(a, b), kind]),
  );

  const locations = new Map<string, LocationCue>();
  for (const n of galaxy.nodes) {
    locations.set(n.id, {
      attackable: !run && !!input.attackable?.has(n.id),
      emphasised: false,
      threatened: n.id === input.incursionNodeId,
    });
  }

  const links: LinkCue[] = [];
  for (const [a, b] of galaxy.links) {
    const nodeA = nodes.get(a);
    const nodeB = nodes.get(b);
    const cueA = locations.get(a);
    const cueB = locations.get(b);
    if (!nodeA || !nodeB || !cueA || !cueB) continue;
    const ownerA = ownerOf(a);
    const ownerB = ownerOf(b);
    const aPlayer = ownerA === playerFactionId;
    const bPlayer = ownerB === playerFactionId;
    let tone: LinkTone = "plain";
    let owner: string | undefined;
    if (run) {
      // The same order the galaxy's lanes use: a step already made first,
      // then a step out of the player's location, and no faction colours.
      if (run.pathLinks?.has(`${a} ${b}`)) tone = "taken";
      else if (aPlayer && !bPlayer) {
        tone = "choice";
        cueB.attackable = true;
      }
    } else if (aPlayer !== bPlayer) {
      tone = "contested";
    } else if (ownerA === ownerB && ownerA !== NEUTRAL) {
      tone = "owned";
      owner = ownerA;
    }
    const emphasised =
      selectedId != null && (a === selectedId || b === selectedId);
    if (emphasised) {
      if (a === selectedId) cueB.emphasised = true;
      if (b === selectedId) cueA.emphasised = true;
    }
    links.push({
      a,
      b,
      kind: linkCueKind(
        kinds.get(pairKey(a, b)),
        !nodeA.outline,
        !nodeB.outline,
      ),
      tone,
      owner,
      emphasised,
    });
  }

  const blocked: BlockedCue[] = [];
  for (const [a, b] of galaxy.blockedBorders ?? []) {
    if (nodes.has(a) && nodes.has(b)) blocked.push({ a, b });
  }

  return { locations, links, blocked };
}
