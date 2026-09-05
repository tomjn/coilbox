import * as THREE from "three";
import type { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { GalaxyDoc, Incursion } from "../model";
import type { WorldPos } from "./layout";

/**
 * Selection: enlarges and brightens the selected node's own ownership ring
 * (no second ring), pulses its colour while the animation loop runs, and
 * positions the incursion marker above whichever node the incursion targets.
 * `styleRing` comes in from owners.ts so reverting the previously selected
 * ring uses the same plain-ownership styling owners.ts applies to every
 * other ring, rather than a second copy of that logic.
 */

export interface Selection {
  /** Re-derive the selected ring's enlarge/brighten style and the incursion
   * marker position from `selectedRef`/`incursionRef`. Reverts the
   * previously selected ring to its plain ownership style. */
  apply: () => void;
  /** Advance the selected ring's colour pulse. Call once per animation
   * frame, only while `effects` is on. */
  tick: (now: number) => void;
  /** The currently selected node's index, or -1. Read by owners.ts (to skip
   * restyling the selected ring) and by hover (to leave the selected ring's
   * highlight alone). */
  getIndex: () => number;
}

export function createSelection(
  galaxy: GalaxyDoc,
  nodeIds: string[],
  selectedRef: { current: string | null | undefined },
  incursionRef: { current: Incursion | undefined },
  positions: Map<string, WorldPos>,
  incursionMarker: CSS2DObject,
  ownerRings: THREE.Mesh[],
  ownerRingMats: THREE.MeshBasicMaterial[],
  ownerColor: (owner: string | undefined) => THREE.Color,
  ownersRef: { current: Record<string, string> },
  styleRing: (i: number) => void,
): Selection {
  const sel = { idx: -1 };

  const apply = () => {
    const selId = selectedRef.current;
    const idx = selId ? nodeIds.indexOf(selId) : -1;
    if (sel.idx >= 0 && sel.idx !== idx) {
      ownerRings[sel.idx]?.scale.setScalar(1);
      styleRing(sel.idx);
    }
    sel.idx = idx;
    if (idx >= 0) {
      ownerRings[idx]?.scale.setScalar(1.3);
      // Static brighten covers the no-animation paths. The loop overrides
      // it with a colour pulse while motion is on.
      const mat = ownerRingMats[idx];
      if (mat) {
        mat.color.lerp(new THREE.Color(0xffffff), 0.3);
        mat.opacity = 1;
      }
    }
    const inc = incursionRef.current;
    const incPos = inc ? positions.get(inc.nodeId) : undefined;
    incursionMarker.visible = !!incPos;
    if (incPos) {
      incursionMarker.position.set(incPos[0], incPos[1] + 4.2, incPos[2]);
    }
  };

  const tick = (now: number) => {
    if (sel.idx < 0) return;
    const ring = ownerRings[sel.idx];
    const mat = ownerRingMats[sel.idx];
    if (!ring || !mat) return;
    ring.scale.setScalar(1.3 + 0.06 * Math.sin(now / 280));
    const owner =
      ownersRef.current[galaxy.nodes[sel.idx].id] ??
      galaxy.nodes[sel.idx].owner;
    mat.color
      .copy(ownerColor(owner))
      .lerp(new THREE.Color(0xffffff), 0.3 + 0.25 * Math.sin(now / 280));
    mat.opacity = 1;
  };

  return { apply, tick, getIndex: () => sel.idx };
}
