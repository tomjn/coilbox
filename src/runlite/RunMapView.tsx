import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js";
import { playBounds, type WorldPos } from "../conquest/galaxy3d/layout";
import { buildStarfield } from "../conquest/galaxy3d/starfield";
import { radialTexture } from "../conquest/galaxy3d/textures";
import { columnLayout } from "./columnLayout";
import type { RunEdge, RunNode, RunNodeType, RunSkin } from "./model";

/**
 * The run map: a forward-column node graph rendered with the same three.js
 * conventions as the conquest galaxy view (tilted look-down, transparent
 * renderer, CSS2D labels, gated rAF, `disposables[]` teardown) reusing its pure
 * toolkit (`columnLayout`, `buildStarfield`, `radialTexture`). Each node is a
 * bright core over a soft type-tinted glow; a nebula wash + vignette (CSS behind
 * the transparent canvas) supplies the atmosphere. `galaxy` sits over a
 * starfield; `theatre` over a flat grid for terrestrial games.
 *
 * The graph is small and changes only between nodes, so prop changes rebuild the
 * scene (in the effect deps). All game logic stays outside: clicks report
 * through `onSelect`.
 */

/** Per-type accent colour (matches docs/mockups/roguelite-run.html). */
const TYPE_COLOR: Record<RunNodeType, number> = {
  start: 0x4fe6d6,
  battle: 0xc3d0e6,
  elite: 0xffb64d,
  event: 0xb98cff,
  reward: 0xffcf5c,
  shop: 0x7fe08a,
  boss: 0xff5468,
};

/** Short caption under each node token. */
const TYPE_LABEL: Record<RunNodeType, string> = {
  start: "Command",
  battle: "Battle",
  elite: "Elite",
  event: "Event",
  reward: "Salvage",
  shop: "Depot",
  boss: "Warlord",
};

export type NodeState = "done" | "current" | "open" | "locked";

export interface RunMapViewProps {
  nodes: RunNode[];
  edges: RunEdge[];
  skin: RunSkin;
  currentId: string;
  visited: string[];
  reachable: string[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  reduceMotion?: boolean;
  className?: string;
}

function stateOf(
  id: string,
  currentId: string,
  visited: Set<string>,
  reachable: Set<string>,
): NodeState {
  if (id === currentId) return "current";
  if (reachable.has(id)) return "open";
  if (visited.has(id)) return "done";
  return "locked";
}

/** Core/glow world size by type + state. */
function tokenScale(type: RunNodeType, state: NodeState): number {
  const base = type === "boss" ? 8 : type === "start" ? 6.5 : 5.5;
  return base * (state === "current" ? 1.2 : state === "open" ? 1.05 : 0.92);
}

function stateOpacity(state: NodeState): number {
  return state === "locked" ? 0.4 : state === "done" ? 0.75 : 1;
}

export function RunMapView({
  nodes,
  edges,
  skin,
  currentId,
  visited,
  reachable,
  selectedId,
  onSelect,
  reduceMotion = false,
  className,
}: RunMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const visitedKey = visited.join(",");
  const reachableKey = reachable.join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: node/edge identity is captured via the *Key strings; onSelect flows through a ref
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const disposables: { dispose(): void }[] = [];
    let renderer: THREE.WebGLRenderer | undefined;
    let labelRenderer: CSS2DRenderer | undefined;
    let controls: OrbitControls | undefined;
    let observer: ResizeObserver | undefined;
    let animationFrame: number | undefined;

    const scene = new THREE.Scene();
    const positions = columnLayout(nodes);
    const bounds = playBounds(positions.values());
    const spanX = Math.max(1, bounds.maxX - bounds.minX);
    const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
    const focus = new THREE.Vector3(
      (bounds.minX + bounds.maxX) / 2,
      0,
      (bounds.minZ + bounds.maxZ) / 2,
    );

    const visitedSet = new Set(visited);
    const reachableSet = new Set(reachable);
    const nodeIds = nodes.map((n) => n.id);
    const at = (id: string): WorldPos => positions.get(id) ?? [0, 0, 0];

    // Soft round sprite textures: a wide gentle glow and a tight bright core.
    const glowTex = radialTexture(128, [
      [0, "#ffffff"],
      [0.25, "#ffffffcc"],
      [1, "#00000000"],
    ]);
    const coreTex = radialTexture(128, [
      [0, "#ffffff"],
      [0.35, "#ffffff"],
      [0.6, "#ffffff88"],
      [1, "#00000000"],
    ]);
    const starTex = radialTexture(64, [
      [0, "#ffffff"],
      [0.4, "#ffffffcc"],
      [1, "#00000000"],
    ]);
    disposables.push(glowTex, coreTex, starTex);

    /* ---------------------------- backdrop --------------------------------- */

    if (skin === "galaxy") {
      // Round, additive stars (a mapped PointsMaterial — a bare one renders
      // square quads).
      const sf = buildStarfield({
        count: 1100,
        radius: Math.max(spanX, spanZ) * 1.8,
        thickness: spanZ * 0.9,
        yOffset: -6,
        seed: `run-${nodeIds.join()}`,
        center: [focus.x, 0, focus.z],
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(sf.positions, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(sf.colors, 3));
      const mat = new THREE.PointsMaterial({
        size: 1.1,
        map: starTex,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geo, mat);
      points.raycast = () => {};
      scene.add(points);
      disposables.push(geo, mat);

      // Nebula wash: a few big, faint, tinted glow sprites on the plane.
      const nebula: [number, number, number][] = [
        [0x1b3a6b, -spanX * 0.3, spanZ * 0.4],
        [0x3a1533, spanX * 0.35, -spanZ * 0.3],
        [0x0c3a37, spanX * 0.1, spanZ * 0.1],
      ];
      for (const [tint, dx, dz] of nebula) {
        const nMat = new THREE.SpriteMaterial({
          map: glowTex,
          color: tint,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const neb = new THREE.Sprite(nMat);
        neb.position.set(focus.x + dx, -4, focus.z + dz);
        neb.scale.setScalar(Math.max(spanX, spanZ) * 0.9);
        neb.raycast = () => {};
        scene.add(neb);
        disposables.push(nMat);
      }
    } else {
      const grid = new THREE.GridHelper(
        Math.max(spanX, spanZ) * 2,
        24,
        0x2a3550,
        0x172035,
      );
      grid.position.set(focus.x, -0.5, focus.z);
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.5;
      grid.raycast = () => {};
      scene.add(grid);
      disposables.push(grid.geometry, grid.material as THREE.Material);
    }

    /* ------------------------------ lanes ---------------------------------- */

    const laneGroups: {
      state: "done" | "open" | "base";
      color: number;
      opacity: number;
      verts: number[];
    }[] = [
      { state: "done", color: 0xffb64d, opacity: 0.85, verts: [] },
      { state: "open", color: 0x4fe6d6, opacity: 0.9, verts: [] },
      { state: "base", color: 0x46536e, opacity: 0.4, verts: [] },
    ];
    for (const [a, b] of edges) {
      const pa = at(a);
      const pb = at(b);
      const laneState =
        visitedSet.has(a) && visitedSet.has(b)
          ? "done"
          : a === currentId && reachableSet.has(b)
            ? "open"
            : "base";
      laneGroups
        .find((g) => g.state === laneState)
        ?.verts.push(pa[0], 0.1, pa[2], pb[0], 0.1, pb[2]);
    }
    for (const g of laneGroups) {
      if (g.verts.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(g.verts, 3),
      );
      const mat = new THREE.LineBasicMaterial({
        color: g.color,
        transparent: true,
        opacity: g.opacity,
      });
      const seg = new THREE.LineSegments(geo, mat);
      seg.raycast = () => {};
      scene.add(seg);
      disposables.push(geo, mat);
    }

    /* --------------------------- node tokens ------------------------------- */

    const labelObjects: CSS2DObject[] = [];
    for (const node of nodes) {
      const p = at(node.id);
      const state = stateOf(node.id, currentId, visitedSet, reachableSet);
      const color = new THREE.Color(TYPE_COLOR[node.type]);
      const opacity = stateOpacity(state);
      const s = tokenScale(node.type, state);

      // Soft glow (type colour) behind a bright, near-white core.
      const glowMat = new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        opacity: 0.55 * opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(s * 2.1);
      glow.position.set(p[0], 0.5, p[2]);
      glow.raycast = () => {};
      scene.add(glow);
      disposables.push(glowMat);

      const coreMat = new THREE.SpriteMaterial({
        map: coreTex,
        color: color.clone().lerp(new THREE.Color(0xffffff), 0.55),
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const core = new THREE.Sprite(coreMat);
      core.scale.setScalar(s);
      core.position.set(p[0], 0.55, p[2]);
      core.raycast = () => {};
      scene.add(core);
      disposables.push(coreMat);

      // Ring for the current node / selection.
      if (node.id === selectedId || state === "current") {
        const ringGeo = new THREE.RingGeometry(s * 0.62, s * 0.72, 40);
        const ringMat = new THREE.MeshBasicMaterial({
          color: node.id === selectedId ? 0xffffff : color,
          transparent: true,
          opacity: 0.95,
          side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(p[0], 0.25, p[2]);
        ring.raycast = () => {};
        scene.add(ring);
        disposables.push(ringGeo, ringMat);
      }

      // Readable CSS2D caption: a chip, not bare text.
      const el = document.createElement("div");
      el.textContent = TYPE_LABEL[node.type];
      const labelColor = color
        .clone()
        .lerp(new THREE.Color(0xffffff), 0.4)
        .getHexString();
      el.style.cssText = `font:600 11px/1.3 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#${labelColor};opacity:${state === "locked" ? 0.5 : 1};white-space:nowrap;pointer-events:none;padding:1px 6px;border-radius:4px;background:rgba(6,9,16,.72);transform:translateY(${s * 3.2}px)`;
      const label = new CSS2DObject(el);
      label.position.set(p[0], 0.5, p[2]);
      scene.add(label);
      labelObjects.push(label);
    }

    // Invisible pick mesh aligned to nodes.
    const pickGeo = new THREE.SphereGeometry(5, 8, 8);
    const pickMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const picks = new THREE.InstancedMesh(pickGeo, pickMat, nodes.length);
    const dummy = new THREE.Object3D();
    nodes.forEach((node, i) => {
      const p = at(node.id);
      dummy.position.set(p[0], 0.5, p[2]);
      dummy.updateMatrix();
      picks.setMatrixAt(i, dummy.matrix);
    });
    picks.instanceMatrix.needsUpdate = true;
    scene.add(picks);
    disposables.push(pickGeo, pickMat, { dispose: () => picks.dispose() });

    /* ------------------------ renderer + camera ---------------------------- */

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    renderer.domElement.style.cssText =
      "display:block;width:100%;height:100%;position:absolute;inset:0;";

    labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.style.cssText =
      "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:1;";
    container.appendChild(labelRenderer.domElement);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);

    // Frame to fit the (wide) span rather than a single scalar: derive the
    // distance that puts spanX inside the horizontal FOV and spanZ inside the
    // vertical, whichever needs more room, with padding.
    const w0 = container.clientWidth || 16;
    const h0 = container.clientHeight || 9;
    const vFov = THREE.MathUtils.degToRad(50);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (w0 / h0));
    const fitDist = Math.max(
      spanX / 2 / Math.tan(hFov / 2),
      spanZ / 2 / Math.tan(vFov / 2),
    );
    const dist = fitDist * 1.35 + 20;
    // A gentle tilt: mostly looking down the forward plane from above/behind.
    camera.position.set(focus.x, dist * 0.62, focus.z + dist * 0.62);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(focus);
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = 1.2;
    controls.screenSpacePanning = false;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.minDistance = 15;
    controls.maxDistance = dist * 2.2;
    controls.zoomToCursor = true;
    controls.enableDamping = !reduceMotion;

    const render = () => {
      if (!renderer || !labelRenderer) return;
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    };
    controls.addEventListener("change", render);

    /* ------------------------------ picking -------------------------------- */

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt: [number, number] | null = null;

    const pickAt = (event: PointerEvent): number => {
      const rect = renderer?.domElement.getBoundingClientRect();
      if (!rect) return -1;
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(picks, false)[0];
      return hit?.instanceId ?? -1;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!renderer) return;
      renderer.domElement.style.cursor = pickAt(event) >= 0 ? "pointer" : "";
    };
    const onPointerDown = (event: PointerEvent) => {
      downAt = [event.clientX, event.clientY];
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!downAt) return;
      const moved = Math.hypot(
        event.clientX - downAt[0],
        event.clientY - downAt[1],
      );
      downAt = null;
      if (moved > 5 || event.button !== 0) return;
      const idx = pickAt(event);
      onSelectRef.current?.(idx >= 0 ? nodeIds[idx] : null);
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    /* -------------------------- render / resize ---------------------------- */

    if (!reduceMotion) {
      const animate = () => {
        animationFrame = requestAnimationFrame(animate);
        controls?.update();
        render();
      };
      animationFrame = requestAnimationFrame(animate);
    }

    const resize = () => {
      if (!renderer || !labelRenderer) return;
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      labelRenderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    return () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      renderer?.domElement.removeEventListener("pointermove", onPointerMove);
      renderer?.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer?.domElement.removeEventListener("pointerup", onPointerUp);
      controls?.dispose();
      for (const label of labelObjects) label.removeFromParent();
      for (const d of disposables) d.dispose();
      labelRenderer?.domElement.remove();
      if (renderer) {
        renderer.domElement.remove();
        renderer.dispose();
      }
    };
  }, [
    nodes,
    edges,
    skin,
    currentId,
    visitedKey,
    reachableKey,
    selectedId,
    reduceMotion,
  ]);

  // The nebula wash + vignette live in CSS behind the transparent canvas, the
  // same atmospheric layering the mockup uses.
  return (
    <div
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        background:
          "radial-gradient(60% 60% at 30% 20%, rgba(18,48,90,.35), transparent 60%)," +
          "radial-gradient(50% 50% at 75% 80%, rgba(58,21,51,.3), transparent 60%)," +
          "radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(0,0,0,.6))",
      }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}
