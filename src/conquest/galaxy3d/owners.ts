import * as THREE from "three";
import type { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { GalaxyDoc } from "../model";
import { NEUTRAL } from "../model";
import { factionSides } from "./factionShape";
import type { LanePair, LaneSeg } from "./GalaxyView";

/**
 * Ownership styling: per-node ring shape/colour/opacity, owner-tinted label
 * colour, theatre-disc tint, and the three lane overlays (quiet neutral base,
 * same-faction, contested frontier) re-categorised on every ownership, fog or
 * hover change. `styleRing` is exported because selection and hover both
 * borrow it to put a ring they were overriding back to its plain ownership
 * style.
 */

/** The quiet blue-grey of an unowned lane (the base lane pair's colour). */
const BASE_LANE_HEX = 0x93a7c8;

/** Split segments into short dashes (for the contested-lane overlay). */
function dashSegments(
  segments: LaneSeg[],
  dashLen: number,
  gapLen: number,
): LaneSeg[] {
  const out: LaneSeg[] = [];
  for (const [x1, y1, z1, x2, y2, z2] of segments) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len === 0) continue;
    const at3 = (t: number): [number, number, number] => [
      x1 + (x2 - x1) * t,
      y1 + (y2 - y1) * t,
      z1 + (z2 - z1) * t,
    ];
    for (let at = 0; at < len; at += dashLen + gapLen) {
      const end = Math.min(at + dashLen, len);
      // Skip stubby leftovers, a dash shorter than its own caps looks messy.
      if (end - at < dashLen * 0.5) break;
      out.push([...at3(at / len), ...at3(end / len)] as LaneSeg);
    }
  }
  return out;
}

export interface Owners {
  /** Recolour every ring/label and re-categorise every lane for the current
   * ownership + fog + hover state. Skips the currently selected ring, which
   * the selection concern owns. */
  apply: () => void;
  /** Reset a single ring (by node index) to its plain ownership style
   * (shape, colour, opacity, theatre-disc tint). Called by `apply` for every
   * unselected ring, and by selection/hover to revert a ring they were
   * overriding. */
  styleRing: (i: number) => void;
}

export function createOwners(
  galaxy: GalaxyDoc,
  playerFactionId: string,
  laneFlow: boolean,
  ownersRef: { current: Record<string, string> },
  pathLinksRef: { current: Set<string> | undefined },
  isVisible: (id: string) => boolean,
  laneDim: (a: string, b: string) => number,
  ownerColor: (owner: string | undefined) => THREE.Color,
  dimOf: (id: string) => number,
  trimmedSeg: (aId: string, bId: string) => LaneSeg | null,
  setLanePair: (
    pair: LanePair,
    segs: LaneSeg[],
    colors?: THREE.Color[],
  ) => void,
  layoutChevrons: (routes: LaneSeg[]) => void,
  lanes: LanePair,
  factionLanes: LanePair,
  frontier: LanePair,
  pathTaken: LanePair,
  labelObjects: CSS2DObject[],
  labelCss: (owner: string | undefined) => string,
  ownerRingMats: THREE.MeshBasicMaterial[],
  ownerRings: THREE.Mesh[],
  discMats: (THREE.MeshBasicMaterial | undefined)[],
  ringGeoFor: (sides: number) => THREE.RingGeometry,
  /** The currently selected node's index, or -1. Selection owns this value.
   * `apply` only reads it to skip restyling the selected ring. */
  getSelectedIndex: () => number,
): Owners {
  /** Reset a ring to its plain ownership style (shape, colour, opacity). */
  const styleRing = (i: number) => {
    const mat = ownerRingMats[i];
    const ring = ownerRings[i];
    if (!mat || !ring) return;
    const owner =
      ownersRef.current[galaxy.nodes[i].id] ?? galaxy.nodes[i].owner;
    ring.geometry = ringGeoFor(
      owner === NEUTRAL ? 0 : factionSides(galaxy, owner),
    );
    mat.color.copy(ownerColor(owner));
    mat.opacity =
      (owner === playerFactionId ? 1 : owner === NEUTRAL ? 0.3 : 0.75) *
      dimOf(galaxy.nodes[i].id);
    // Theatre region markers fill with a dark shade of the owner colour.
    const disc = discMats[i];
    if (disc) {
      disc.color
        .copy(owner === NEUTRAL ? new THREE.Color(0x39404e) : ownerColor(owner))
        .multiplyScalar(owner === NEUTRAL ? 1 : 0.45);
    }
  };

  const apply = () => {
    const current = ownersRef.current;
    const selIdx = getSelectedIndex();
    galaxy.nodes.forEach((n, i) => {
      if (i !== selIdx) styleRing(i);
      const label = labelObjects[i];
      if (label)
        (label.element as HTMLElement).style.color = labelCss(
          current[n.id] ?? n.owner,
        );
    });
    // Re-categorise every lane: contested (exactly one player end, drawn
    // dashed), same-owner (both ends one faction, drawn in its colour),
    // else the quiet neutral base.
    const baseSegs: LaneSeg[] = [];
    const baseSegColors: THREE.Color[] = [];
    const factionSegs: LaneSeg[] = [];
    const factionSegColors: THREE.Color[] = [];
    const frontierSegs: LaneSeg[] = [];
    const frontierEnds: [string, string][] = [];
    const routeSegs: LaneSeg[] = [];
    const pathSegs: LaneSeg[] = [];
    // The quiet base lane, dimmed by whichever end is more faded.
    const pushBase = (seg: LaneSeg, a: string, b: string) => {
      baseSegs.push(seg);
      baseSegColors.push(
        new THREE.Color(BASE_LANE_HEX).multiplyScalar(laneDim(a, b)),
      );
    };
    for (const [a, b] of galaxy.links) {
      const seg = trimmedSeg(a, b);
      if (!seg) continue;
      // Fog: a lane with both ends hidden vanishes. One end hidden draws as
      // the quiet neutral base ("something lies beyond").
      const visA = isVisible(a);
      const visB = isVisible(b);
      if (!visA && !visB) continue;
      if (!visA || !visB) {
        pushBase(seg, a, b);
        continue;
      }
      const ownerA = current[a] ?? NEUTRAL;
      const ownerB = current[b] ?? NEUTRAL;
      const aPlayer = ownerA === playerFactionId;
      const bPlayer = ownerB === playerFactionId;
      if (laneFlow) {
        // Run lanes: the route already travelled is a bright green trail.
        // Forward lanes out of the current node (you -> a choice) are
        // directional routes. Everything else is quiet base, dimmed by
        // emphasis. No faction-coloured lanes, a node's *type* is not an
        // allegiance. `trimmedSeg(a, b)` runs source -> target, so the pulse
        // flows outward.
        if (pathLinksRef.current?.has(`${a} ${b}`)) pathSegs.push(seg);
        else if (aPlayer && !bPlayer) routeSegs.push(seg);
        else pushBase(seg, a, b);
        continue;
      }
      if (aPlayer !== bPlayer) {
        frontierSegs.push(seg);
        frontierEnds.push([a, b]);
      } else if (ownerA === ownerB && ownerA !== NEUTRAL) {
        factionSegs.push(seg);
        // clone: ownerColor returns the shared cached faction colour.
        factionSegColors.push(
          ownerColor(ownerA).clone().multiplyScalar(laneDim(a, b)),
        );
      } else {
        pushBase(seg, a, b);
      }
    }
    setLanePair(lanes, baseSegs, baseSegColors);
    if (laneFlow) {
      setLanePair(factionLanes, []); // runs have no shared-owner lanes
      // Solid, not dashed. Full-brightness colours since run routes carry no
      // hover grading of their own.
      setLanePair(
        frontier,
        routeSegs,
        routeSegs.map(() => new THREE.Color(0xffffff)),
      );
      setLanePair(pathTaken, pathSegs); // green trail behind you
      layoutChevrons(routeSegs);
    } else {
      setLanePair(factionLanes, factionSegs, factionSegColors);
      // Dashed per segment rather than in one pass, so each dash inherits
      // the brightness of the lane it came from.
      const dashes: LaneSeg[] = [];
      const dashColors: THREE.Color[] = [];
      frontierSegs.forEach((seg, i) => {
        const [endA, endB] = frontierEnds[i];
        const tint = new THREE.Color(0xffffff).multiplyScalar(
          laneDim(endA, endB),
        );
        for (const dash of dashSegments([seg], 1.5, 1.2)) {
          dashes.push(dash);
          dashColors.push(tint);
        }
      });
      setLanePair(frontier, dashes, dashColors);
    }
  };

  return { apply, styleRing };
}
