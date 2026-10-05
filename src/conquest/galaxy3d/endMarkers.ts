import type { GalaxyNode } from "../model";
import type { PlacedModel } from "../placedModels";
import { modelRefName } from "./modelPlacement";

/**
 * Which start and goal markers a terrain map draws for a run. Pure, so the
 * rule that a placed model takes a marker's place is tested without a scene.
 * `endMarkerLayer.ts` draws the result.
 */

export type RunEnd = "start" | "goal";

/** One marker to draw. */
export interface EndMarker {
  /** Index into the document's nodes. */
  nodeIndex: number;
  id: string;
  end: RunEnd;
  /** The location's anchor, in map units. */
  pos: [number, number];
}

/**
 * The markers to draw: one for each location `ends` names, unless the map's
 * author stood a model on it. A gate at the start is the start's marker, and
 * a default marker on top of it would only hide it.
 *
 * A model stands on a location when its position is within `reach` map units
 * of the location's anchor, the edge included. A model anywhere else in a
 * province, such as a tree, leaves the marker alone.
 *
 * A model named in `failed` could not be drawn, so it stands on nothing and
 * the marker is drawn as if it were not placed.
 */
export function endMarkersToDraw(
  nodes: Pick<GalaxyNode, "id" | "pos">[],
  ends: ReadonlyMap<string, { end?: RunEnd }>,
  models:
    | (Pick<PlacedModel, "pos"> & Partial<Pick<PlacedModel, "model">>)[]
    | undefined,
  reach: number,
  failed?: ReadonlySet<string>,
): EndMarker[] {
  const out: EndMarker[] = [];
  nodes.forEach((n, nodeIndex) => {
    const end = ends.get(n.id)?.end;
    if (!end) return;
    const [x, y] = n.pos;
    const covered = (models ?? []).some(
      (m) =>
        Math.hypot(m.pos[0] - x, m.pos[1] - y) <= reach &&
        !(m.model && failed?.has(modelRefName(m.model))),
    );
    if (!covered) out.push({ nodeIndex, id: n.id, end, pos: [x, y] });
  });
  return out;
}
