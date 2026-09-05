import type { MapDownloadHint } from "../campaign/model";
import type { NodeMaps } from "../challenge/nodeMaps";

/**
 * Shared node-map substitution for conquest and warpath (issue #2441).
 *
 * Both games generate a topology once and bake a map name into each battle
 * node, but the map catalog and the exclusion list behind that name move
 * independently of the saved doc. Three operations keep a stored galaxy or
 * run honest against a catalog that has since changed:
 *
 * - `substituteExcludedMaps` re-points a node whose map has since become
 *   ineligible.
 * - `applyChallengeMaps` (issue #1393) puts every node on the map a shared
 *   challenge named, standing in a replacement where this install cannot
 *   offer it.
 * - `restoreChallengeMap` (issue #1834) undoes one such stand-in once this
 *   install can offer the named map.
 *
 * Conquest and warpath name the field the same (`battle`) and the same three
 * sub-fields (`mapName`, `mapDownload`, `mapSubstitutedFrom`), so there is no
 * real per-game node accessor to parametrise over. The one thing that
 * actually differs is the picking rule: conquest draws from a difficulty
 * tier keyed on node id, warpath draws from a depth-biased pool keyed on node
 * id. Each caller supplies that rule as `pickReplacement`, closed over its
 * own pool, and `resolveAvailable` for the map catalog lookup that decides
 * whether a challenge's named map needs a stand-in at all.
 */

/** A map name plus whatever download hint goes with it, or nothing when the
 * picking rule has no candidates to offer. */
export interface MapPick {
  name: string;
  mapDownload?: MapDownloadHint;
}

/** The battle fields both games' node types agree on. */
export interface SubstitutableBattle {
  mapName: string;
  mapDownload?: MapDownloadHint;
  mapSubstitutedFrom?: string;
}

/** A node carrying an optional battle spec, keyed by a stable id. */
export interface SubstitutableNode<Battle extends SubstitutableBattle> {
  id: string;
  battle?: Battle;
}

/** A doc or run: just its node list, everything else passed through untouched. */
interface SubstitutableDoc<Node> {
  nodes: Node[];
}

/**
 * Swap out node maps that are no longer allowed. Applied on read rather than
 * written back, since authored content a game ships is not ours to rewrite.
 * `pickReplacement` returns undefined when it has no candidates at all
 * (nothing installed, or everything excluded), which is treated the same as
 * every node being left alone.
 *
 * Returns the doc unchanged (by reference) when nothing needed swapping, so
 * callers can memo on identity.
 */
export function substituteExcludedMaps<
  Doc extends SubstitutableDoc<Node>,
  Node extends SubstitutableNode<Battle>,
  Battle extends SubstitutableBattle,
>(
  doc: Doc,
  isExcluded: (mapName: string) => boolean,
  pickReplacement: (node: Node) => MapPick | undefined,
): Doc {
  let changed = false;
  const nodes = doc.nodes.map((node) => {
    const current = node.battle?.mapName;
    if (!current || !isExcluded(current)) return node;
    const replacement = pickReplacement(node);
    if (!replacement) return node;
    changed = true;
    // The old map's download hint goes with it, or the battle screen would
    // still offer to fetch the map we just excluded.
    return {
      ...node,
      battle: {
        ...node.battle,
        mapName: replacement.name,
        mapDownload: undefined,
      },
    } as Node;
  });
  return changed ? ({ ...doc, nodes } as Doc) : doc;
}

/**
 * Put every node on the map a challenge named (issue #1393). A named map this
 * install cannot offer still gets a stand-in from `pickReplacement`, and the
 * node remembers what it should have been in `mapSubstitutedFrom`.
 *
 * Returns the doc unchanged when the challenge names nothing, so a challenge
 * shared before #1393 falls straight through to whatever generation picked.
 */
export function applyChallengeMaps<
  Doc extends SubstitutableDoc<Node>,
  Node extends SubstitutableNode<Battle>,
  Battle extends SubstitutableBattle,
>(
  doc: Doc,
  nodeMaps: NodeMaps | undefined,
  resolveAvailable: (mapName: string) => MapPick | undefined,
  pickReplacement: (node: Node) => MapPick | undefined,
): Doc {
  if (!nodeMaps) return doc;
  let changed = false;
  const nodes = doc.nodes.map((node) => {
    const battle = node.battle;
    const wanted = nodeMaps[node.id];
    if (!battle || !wanted) return node;
    const available = resolveAvailable(wanted);
    const used = available ?? pickReplacement(node);
    const substitutedFrom = !available && used ? wanted : undefined;
    const mapName = used?.name ?? wanted;
    if (
      battle.mapName === mapName &&
      battle.mapSubstitutedFrom === substitutedFrom
    ) {
      return node;
    }
    changed = true;
    return {
      ...node,
      battle: {
        ...battle,
        mapName,
        mapDownload: used?.mapDownload,
        mapSubstitutedFrom: substitutedFrom,
      },
    } as Node;
  });
  return changed ? ({ ...doc, nodes } as Doc) : doc;
}

/**
 * Put one node back on the map its challenge named (issue #1834), now that
 * this install can offer it. One node at a time, because the offer to end a
 * stand-in is made on that node's own panel.
 *
 * Returns the doc unchanged when the node is not standing in for anything.
 */
export function restoreChallengeMap<
  Doc extends SubstitutableDoc<Node>,
  Node extends SubstitutableNode<Battle>,
  Battle extends SubstitutableBattle,
>(doc: Doc, nodeId: string): Doc {
  const node = doc.nodes.find((n) => n.id === nodeId);
  const wanted = node?.battle?.mapSubstitutedFrom;
  if (!node?.battle || !wanted) return doc;
  const nodes = doc.nodes.map((n) =>
    n.id === nodeId && n.battle
      ? ({
          ...n,
          battle: {
            ...n.battle,
            mapName: wanted,
            // The stand-in's download hint goes with the stand-in, and the
            // map taking its place is already here.
            mapDownload: undefined,
            mapSubstitutedFrom: undefined,
          },
        } as Node)
      : n,
  );
  return { ...doc, nodes } as Doc;
}
