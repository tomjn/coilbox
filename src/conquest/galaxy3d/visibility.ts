import * as THREE from "three";
import type { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { GalaxyDoc } from "../model";
import type { NodeEmphasis } from "./GalaxyView";
import { hashString, type WorldPos } from "./layout";
import { checkTexture, radialTexture } from "./textures";

/**
 * Fog of war plus graded emphasis: per-node dim/hide styling for stars,
 * coronas, spikes, ownership rings, labels, companions and opaque
 * structures, plus two emphasis extras, a "done" check marker and an
 * ambient combat flash, each built lazily the first time a node needs one.
 */

const FOG_DIM = 0.16;
const FLASH_MS = 200;

/** The subset of a binary companion's fields visibility dims/hides. */
export interface VisibilityCompanion {
  i: number;
  star: THREE.Sprite;
  corona: THREE.Sprite;
  starBase: number;
  coronaBase: number;
}

/** The subset of an opaque ring-station's dim state visibility darkens. */
export interface VisibilityStructureDim {
  i: number;
  color: THREE.Color;
  base: THREE.Color;
}

export interface Visibility {
  /** Re-style every node/lane-adjacent visual for the current fog + emphasis. */
  apply: () => void;
  /** Advance the ambient combat flash pulse. Call once per animation frame,
   * only while `effects` is on (reduce-motion never calls this). */
  tick: (now: number) => void;
}

export function createVisibility(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  galaxy: GalaxyDoc,
  positions: Map<string, WorldPos>,
  skin: "galaxy" | "theatre",
  isVisible: (id: string) => boolean,
  dimOf: (id: string) => number,
  emphasisRef: { current: Map<string, NodeEmphasis> | undefined },
  warlordNodeIdx: Set<number>,
  starMats: (THREE.SpriteMaterial | undefined)[],
  coronaSprites: (THREE.Sprite | undefined)[],
  spikeSprites: (THREE.Object3D | undefined)[],
  ownerRings: THREE.Mesh[],
  labelObjects: CSS2DObject[],
  companions: VisibilityCompanion[],
  structureDims: VisibilityStructureDim[],
): Visibility {
  // Pristine per-node glow opacities, captured now (before fog/emphasis run),
  // so a de-emphasised node dims by a factor and restores to exactly its
  // class-dependent brightness. Corona/spike opacity is glow-dependent, not
  // a constant.
  const coronaBaseOp = coronaSprites.map(
    (s) => (s?.material as THREE.SpriteMaterial | undefined)?.opacity ?? 1,
  );
  const spikeBaseOp = spikeSprites.map(
    (s) =>
      (s as { material?: { opacity?: number } } | undefined)?.material
        ?.opacity ?? 1,
  );

  // "Done" markers (emphasis `marker: "check"`): a check glyph over a node.
  // Created lazily per node the first time it needs one, so conquest, which
  // never sets a marker, allocates nothing. One shared texture/material.
  const checkSprites: (THREE.Sprite | undefined)[] = new Array(
    galaxy.nodes.length,
  ).fill(undefined);
  let checkTex: THREE.Texture | undefined;
  let checkMat: THREE.SpriteMaterial | undefined;
  const ensureCheck = (i: number): THREE.Sprite | undefined => {
    const existing = checkSprites[i];
    if (existing) return existing;
    const p = positions.get(galaxy.nodes[i].id);
    if (!p) return undefined;
    if (!checkTex) {
      checkTex = checkTexture(64);
      disposables.push(checkTex);
    }
    if (!checkMat) {
      checkMat = new THREE.SpriteMaterial({
        map: checkTex,
        color: 0x8affc0,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        depthTest: false, // always legible over the (dimmed) node
      });
      disposables.push(checkMat);
    }
    const sprite = new THREE.Sprite(checkMat);
    sprite.position.set(p[0], p[1] + 0.3, p[2]);
    sprite.scale.setScalar(galaxy.nodes[i].kind === "capital" ? 3.6 : 3.0);
    sprite.renderOrder = 5;
    sprite.raycast = () => {};
    scene.add(sprite);
    checkSprites[i] = sprite;
    return sprite;
  };

  // Ambient combat flashes (emphasis `flash`): a small warm pop over upcoming
  // battle sites every few seconds, staggered per node, faded by the node's
  // own emphasis so distant fronts flicker fainter. Lazily created. The loop
  // drives the pulse when motion is on (so reduce-motion stays still).
  const flashSprites: (THREE.Sprite | undefined)[] = new Array(
    galaxy.nodes.length,
  ).fill(undefined);
  const flashEnabled = new Set<number>();
  const flashClock = galaxy.nodes.map((n) => ({
    phase: (hashString(`${n.id}-fp`) % 1000) / 1000,
    period: 2200 + (hashString(`${n.id}-fperiod`) % 1800),
  }));
  let flashTex: THREE.Texture | undefined;
  const ensureFlash = (i: number): THREE.Sprite | undefined => {
    const existing = flashSprites[i];
    if (existing) return existing;
    const p = positions.get(galaxy.nodes[i].id);
    if (!p) return undefined;
    if (!flashTex) {
      flashTex = radialTexture(64, [
        [0, "#ffffffff"],
        [0.3, "#ffd9a0cc"],
        [0.7, "#ff883322"],
        [1, "#ff880000"],
      ]);
      disposables.push(flashTex);
    }
    const mat = new THREE.SpriteMaterial({
      map: flashTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    disposables.push(mat);
    // Offset off the star centre so it reads as a battlefront flash, not a
    // second star.
    const h = hashString(`${galaxy.nodes[i].id}-flashoff`);
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(
      p[0] + (((h % 100) / 100) * 2 - 1) * 0.7,
      p[1] + 0.2,
      p[2] + ((((h >> 7) % 100) / 100) * 2 - 1) * 0.7,
    );
    sprite.renderOrder = 4;
    sprite.raycast = () => {};
    sprite.visible = false;
    scene.add(sprite);
    flashSprites[i] = sprite;
    return sprite;
  };

  // Fog of war: dim and unlabel systems the player can't see, and hide their
  // ownership rings, coronas, spikes and companions. Lanes are handled in
  // applyOwners. Picking skips fogged nodes (see pickAt).
  const apply = () => {
    if (skin === "theatre") return; // theatre region markers have no fog styling
    galaxy.nodes.forEach((n, i) => {
      const vis = isVisible(n.id);
      // Graded emphasis dims but keeps a node present (glow/ring/label stay).
      // Fog fully hides its glow, ring and label. The two compose (fog wins
      // on hiding, emphasis scales what remains) but no caller uses both.
      // The warlord finale never dims. It's the run's destination beacon.
      const factor = warlordNodeIdx.has(i) ? 1 : dimOf(n.id);
      const starMat = starMats[i];
      if (starMat) starMat.opacity = (vis ? 1 : FOG_DIM) * factor;
      const corona = coronaSprites[i];
      if (corona) {
        corona.visible = vis;
        (corona.material as THREE.SpriteMaterial).opacity =
          coronaBaseOp[i] * factor;
      }
      const spike = spikeSprites[i];
      if (spike) {
        spike.visible = vis;
        const sm = (spike as { material?: { opacity?: number } }).material;
        if (sm) sm.opacity = spikeBaseOp[i] * factor;
      }
      const ring = ownerRings[i];
      if (ring) ring.visible = vis; // ring opacity is set in styleRing
      const label = labelObjects[i];
      if (label) {
        label.visible = vis;
        (label.element as HTMLElement).style.opacity = String(factor);
      }
      // Completed marker: show a check over crossed nodes.
      const marker = emphasisRef.current?.get(n.id)?.marker;
      if (marker === "check" && vis) {
        const cs = ensureCheck(i);
        if (cs) cs.visible = true;
      } else if (checkSprites[i]) {
        (checkSprites[i] as THREE.Sprite).visible = false;
      }
      // Ambient combat flash: enabled here, pulsed in the animation loop.
      if (emphasisRef.current?.get(n.id)?.flash && vis) {
        ensureFlash(i);
        flashEnabled.add(i);
      } else {
        flashEnabled.delete(i);
        const fs = flashSprites[i];
        if (fs) fs.visible = false;
      }
    });
    for (const c of companions) {
      const id = galaxy.nodes[c.i].id;
      const vis = isVisible(id);
      const factor = dimOf(id);
      c.star.visible = vis;
      c.corona.visible = vis;
      (c.star.material as THREE.SpriteMaterial).opacity = c.starBase * factor;
      (c.corona.material as THREE.SpriteMaterial).opacity =
        c.coronaBase * factor;
    }
    // Opaque ring-stations dim by darkening their metal (they can't fade).
    // The warlord fortress is exempt. The finale stays full-bright.
    for (const s of structureDims) {
      const d = warlordNodeIdx.has(s.i) ? 1 : dimOf(galaxy.nodes[s.i].id);
      s.color.copy(s.base).multiplyScalar(d);
    }
  };

  // Ambient combat flashes: a brief pop on a per-node cycle, faded by the
  // node's emphasis so distant fronts flicker fainter.
  const tick = (now: number) => {
    for (const i of flashEnabled) {
      const fs = flashSprites[i];
      if (!fs) continue;
      const { phase, period } = flashClock[i];
      const local = (now + phase * period) % period;
      if (local < FLASH_MS) {
        const a = Math.sin((Math.PI * local) / FLASH_MS);
        const capital = galaxy.nodes[i].kind === "capital";
        fs.visible = true;
        (fs.material as THREE.SpriteMaterial).opacity =
          0.55 * a * dimOf(galaxy.nodes[i].id);
        fs.scale.setScalar((2.0 + 1.4 * a) * (capital ? 1.3 : 1));
      } else if (fs.visible) {
        fs.visible = false;
      }
    }
  };

  return { apply, tick };
}
