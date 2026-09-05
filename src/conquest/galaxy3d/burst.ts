import * as THREE from "three";
import type { WorldPos } from "./layout";
import { radialTexture, ringBurstTexture } from "./textures";

/**
 * Win burst: a one-shot shockwave ring + flare on a node (the star just
 * won). Two reused sprites, repositioned per burst, faded by the caller's
 * animation loop via `tick`.
 */

const BURST_MS = 1300;

const easeOut = (t: number) => 1 - (1 - t) ** 3;

export interface WinBurst {
  /** Reads `burstRef.current` and, if it names a node, starts a new burst there. */
  apply: () => void;
  /** Advance the shockwave/flare animation. Call once per animation frame. */
  tick: (now: number) => void;
}

export function createWinBurst(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  positions: Map<string, WorldPos>,
  burstRef: { current: string | null | undefined },
  reduceMotion: boolean,
): WinBurst {
  const burstFlareTex = radialTexture(128, [
    [0, "#ffffffff"],
    [0.3, "#fff3c8dd"],
    [0.7, "#ffcf6633"],
    [1, "#ffcf6600"],
  ]);
  const burstRingTex = ringBurstTexture(128);
  disposables.push(burstFlareTex, burstRingTex);
  const burstFlareMat = new THREE.SpriteMaterial({
    map: burstFlareTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const burstRingMat = new THREE.SpriteMaterial({
    map: burstRingTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  disposables.push(burstFlareMat, burstRingMat);
  const burstFlare = new THREE.Sprite(burstFlareMat);
  const burstRing = new THREE.Sprite(burstRingMat);
  for (const s of [burstFlare, burstRing]) {
    s.visible = false;
    s.raycast = () => {};
    s.renderOrder = 6;
    scene.add(s);
  }
  let burstAnim: { t0: number } | null = null;

  const apply = () => {
    const id = burstRef.current;
    if (!id || reduceMotion) return; // no animated burst under reduce-motion
    const p = positions.get(id);
    if (!p) return;
    const at: [number, number, number] = [p[0], p[1] + 0.3, p[2]];
    burstFlare.position.set(...at);
    burstRing.position.set(...at);
    burstAnim = { t0: performance.now() };
  };

  const tick = (now: number) => {
    // Win burst: shockwave ring expands and fades, flare spikes then dies.
    if (!burstAnim) return;
    const e = (now - burstAnim.t0) / BURST_MS;
    if (e >= 1) {
      burstAnim = null;
      burstFlare.visible = false;
      burstRing.visible = false;
    } else {
      burstFlare.visible = true;
      burstRing.visible = true;
      const flareIn = e < 0.12 ? e / 0.12 : 1;
      burstFlareMat.opacity = flareIn * (1 - e) ** 1.5;
      burstFlare.scale.setScalar(6 + 26 * easeOut(e));
      burstRingMat.opacity = (1 - e) * 0.85;
      burstRing.scale.setScalar(3 + 52 * easeOut(e));
    }
  };

  return { apply, tick };
}
