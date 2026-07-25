import type { GalaxyNode } from "../model";
import { hashString } from "./layout";

/** A node's non-stellar body when it sits on a voidwater (space) map. */
export type VoidBody = "asteroid" | "comet";

/**
 * Does this node render as an asteroid field or comet rather than a star?
 *
 * A space battle map is the trigger, but a node with real catalogue data is a
 * real star and stays one whichever map it drew. Otherwise a genuine brown
 * dwarf like 2MA 0415-09 would show up as an asteroid field purely because of
 * the map behind it.
 */
export function isVoidNode(
  node: Pick<GalaxyNode, "battle" | "star">,
  spaceMaps: Set<string> | undefined,
): boolean {
  if (node.star) return false;
  return !!spaceMaps?.has(node.battle.mapName);
}

/**
 * The void body for a node: an asteroid field, or a comet for roughly one node
 * in seven (deterministic hash of the id, same approach as the stellar class /
 * binary derivation). Comets stay rare so they read as special.
 */
export function voidBodyFor(nodeId: string): VoidBody {
  return hashString(`${nodeId}-void`) % 7 === 0 ? "comet" : "asteroid";
}

/**
 * Void bodies for all of a galaxy's space-map nodes, keyed by id, guaranteeing
 * at least one comet so a voidwater galaxy always shows the rare variant. Each
 * node keeps its independent `voidBodyFor` roll; only if the whole set came up
 * comet-free is one node promoted — the one with the lowest tiebreak hash, so
 * the choice is deterministic and independent of node ordering.
 */
export function voidBodiesFor(nodeIds: string[]): Map<string, VoidBody> {
  const bodies = new Map(nodeIds.map((id) => [id, voidBodyFor(id)] as const));
  if (nodeIds.length > 0 && !nodeIds.some((id) => bodies.get(id) === "comet")) {
    let pick = nodeIds[0];
    let best = hashString(`${pick}-comet`);
    for (const id of nodeIds) {
      const h = hashString(`${id}-comet`);
      if (h < best || (h === best && id < pick)) {
        best = h;
        pick = id;
      }
    }
    bodies.set(pick, "comet");
  }
  return bodies;
}

/** Selection-panel label for a void body. */
export function bodyLabel(body: VoidBody): string {
  return body === "comet" ? "comet" : "asteroid field";
}
