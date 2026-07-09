import { hashString } from "./layout";

/** A node's non-stellar body when it sits on a voidwater (space) map. */
export type VoidBody = "asteroid" | "comet";

/**
 * The void body for a node: an asteroid field, or a comet for roughly one node
 * in seven (deterministic hash of the id, same approach as the stellar class /
 * binary derivation). Comets stay rare so they read as special.
 */
export function voidBodyFor(nodeId: string): VoidBody {
  return hashString(`${nodeId}-void`) % 7 === 0 ? "comet" : "asteroid";
}

/** Selection-panel label for a void body. */
export function bodyLabel(body: VoidBody): string {
  return body === "comet" ? "comet" : "asteroid field";
}
