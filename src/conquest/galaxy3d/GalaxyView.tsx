import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js";
import type { GalaxyDoc, Incursion } from "../model";
import { NEUTRAL } from "../model";
import { mulberry32 } from "../rng";
import { hashString, layoutNodes, PLAY_EXTENT, playBounds } from "./layout";
import { buildStarfield } from "./starfield";

/**
 * The 3D strategic map: a tilted look-down over the galactic plane. The
 * playable nodes are a small subsection of a much larger decorative disc —
 * two Points layers (far spiral disc + near scatter, real depth so panning
 * parallaxes for free) sit under an interactive play layer of instanced star
 * cores, additive glows, ownership-tinted lanes and CSS2D name labels.
 *
 * Follows the MapPreview3D conventions: one imperative build effect with a
 * `cancelled` flag and a `disposables[]` teardown, transparent renderer,
 * capped pixel ratio, and a single gated rAF loop (continuous only while
 * something animates; reduce-motion drops to on-demand rendering). Ownership,
 * selection and incursion changes mutate the live scene through refs — no
 * scene rebuild after launch.
 *
 * All game logic stays outside: this component reports node clicks through
 * `onSelect` and renders whatever `owners`/`incursion` say.
 */

export interface GalaxyDisplay {
  reduceMotion: boolean;
  effects: boolean;
  performanceMode: boolean;
}

interface GalaxyViewProps {
  galaxy: GalaxyDoc;
  /** nodeId -> faction id / neutral (from run state; doc owners for preview). */
  owners: Record<string, string>;
  /** The faction the run is played as (frontier lanes highlight against it). */
  playerFactionId: string;
  selectedId?: string | null;
  incursion?: Incursion;
  onSelect?: (nodeId: string | null) => void;
  display?: Partial<GalaxyDisplay>;
  className?: string;
}

const NEUTRAL_COLOR = "#6b7280";

/** Radial-gradient sprite texture (glows and nebulae). */
function radialTexture(size: number, stops: [number, string][]): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    for (const [at, color] of stops) g.addColorStop(at, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Patch a PointsMaterial with per-point size and a `uTime` twinkle. */
function patchTwinkle(
  material: THREE.PointsMaterial,
  uTime: { value: number },
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = `
      attribute float aSize;
      attribute float aPhase;
      attribute float aSpeed;
      uniform float uTime;
      varying float vTwinkle;
      ${shader.vertexShader.replace(
        "gl_PointSize = size;",
        `gl_PointSize = size * aSize;
         vTwinkle = 0.72 + 0.28 * sin(uTime * aSpeed + aPhase);`,
      )}`;
    // Points rasterize as squares; a radial falloff on gl_PointCoord rounds
    // them into soft star dots without needing a texture.
    shader.fragmentShader = `
      varying float vTwinkle;
      ${shader.fragmentShader.replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        `float starDist = length(gl_PointCoord - vec2(0.5));
         // A crisp hot core plus a faint halo reads as a sharp star rather
         // than a blurry blob.
         float core = smoothstep(0.28, 0.05, starDist);
         float halo = smoothstep(0.5, 0.18, starDist) * 0.3;
         float starMask = core * 1.5 + halo;
         if (starMask < 0.02) discard;
         vec4 diffuseColor = vec4( diffuse, opacity * vTwinkle * starMask );`,
      )}`;
  };
}

export function GalaxyView({
  galaxy,
  owners,
  playerFactionId,
  selectedId,
  incursion,
  onSelect,
  display,
  className,
}: GalaxyViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Live-mutation channels into the built scene (no rebuild on change).
  const ownersRef = useRef(owners);
  const selectedRef = useRef<string | null | undefined>(selectedId);
  const incursionRef = useRef(incursion);
  const onSelectRef = useRef(onSelect);
  const applyOwnersRef = useRef<(() => void) | null>(null);
  const applySelectionRef = useRef<(() => void) | null>(null);
  const renderRef = useRef<(() => void) | null>(null);

  onSelectRef.current = onSelect;

  const reduceMotion =
    display?.reduceMotion ??
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const effects = display?.effects ?? true;
  const performanceMode = display?.performanceMode ?? false;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Unlike MapPreview3D there is no async asset load here — the whole scene
    // builds synchronously — so no `cancelled` flag is needed.
    const disposables: { dispose(): void }[] = [];
    let renderer: THREE.WebGLRenderer | undefined;
    let labelRenderer: CSS2DRenderer | undefined;
    let controls: OrbitControls | undefined;
    let observer: ResizeObserver | undefined;
    let animationFrame: number | undefined;

    const scene = new THREE.Scene();
    const uTime = { value: 0 };

    const positions = layoutNodes(galaxy.nodes);
    const bounds = playBounds(positions.values());
    const nodeIds = galaxy.nodes.map((n) => n.id);
    const factionColor = new Map(
      galaxy.factions.map((f) => [f.id, new THREE.Color(f.color)]),
    );
    const ownerColor = (owner: string | undefined): THREE.Color =>
      (owner ? factionColor.get(owner) : undefined) ??
      new THREE.Color(NEUTRAL_COLOR);

    /* ------------------------- decorative backdrop ------------------------- */

    const starCount = performanceMode ? 5000 : 12000;
    const makeStars = (
      count: number,
      radius: number,
      thickness: number,
      yOffset: number,
      seedSuffix: string,
      pointSize: number,
    ) => {
      const stars = buildStarfield({
        count,
        radius,
        thickness,
        yOffset,
        seed: galaxy.id + seedSuffix,
        palette: galaxy.theme?.starPalette,
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(stars.positions, 3),
      );
      geo.setAttribute("color", new THREE.BufferAttribute(stars.colors, 3));
      geo.setAttribute("aSize", new THREE.BufferAttribute(stars.sizes, 1));
      geo.setAttribute("aPhase", new THREE.BufferAttribute(stars.phases, 1));
      geo.setAttribute("aSpeed", new THREE.BufferAttribute(stars.speeds, 1));
      const mat = new THREE.PointsMaterial({
        size: pointSize,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      patchTwinkle(mat, uTime);
      disposables.push(geo, mat);
      const points = new THREE.Points(geo, mat);
      // Decoration never intercepts picking.
      points.raycast = () => {};
      return points;
    };

    // Far layer: the galactic disc, several times wider than the play region
    // and slightly below it — we look down onto the plane at an angle.
    scene.add(makeStars(starCount, PLAY_EXTENT * 4, 30, -22, "", 1.4));
    // Near layer: sparse dim scatter around the play plane; being at a
    // different depth it parallaxes against the far disc as the camera pans.
    if (!performanceMode) {
      scene.add(makeStars(1500, PLAY_EXTENT * 1.8, 16, -6, "-near", 1.0));
    }

    // A few soft nebula sprites tint the disc (skipped in performance mode).
    if (!performanceMode && effects) {
      const nebulaColors = galaxy.theme?.nebulaColors ?? [
        "#4756b8",
        "#8a4bb8",
        "#2a6f8f",
      ];
      const nebulaRng = mulberry32(hashString(`${galaxy.id}-nebula`));
      nebulaColors.slice(0, 4).forEach((color, i) => {
        const tex = radialTexture(128, [
          [0, `${color}ff`],
          [0.5, `${color}55`],
          [1, `${color}00`],
        ]);
        const mat = new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          opacity: 0.09,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        disposables.push(tex, mat);
        const sprite = new THREE.Sprite(mat);
        const angle = nebulaRng() * Math.PI * 2 + i;
        const dist = PLAY_EXTENT * (0.7 + nebulaRng() * 1.6);
        sprite.position.set(
          Math.cos(angle) * dist,
          -14 - nebulaRng() * 8,
          Math.sin(angle) * dist,
        );
        const scale = PLAY_EXTENT * (1.2 + nebulaRng() * 1.2);
        sprite.scale.set(scale, scale * 0.6, 1);
        sprite.raycast = () => {};
        scene.add(sprite);
      });
    }

    /* ----------------------------- play layer ------------------------------ */

    // Lanes: a quiet neutral base (ownership already lives on the nodes —
    // coloured lanes just made the map noisy) with a bright overlay re-drawing
    // frontier lanes (player side ↔ attackable side) so "where can I go"
    // reads at a glance.
    const laneGeo = new THREE.BufferGeometry();
    const lanePos = new Float32Array(galaxy.links.length * 6);
    galaxy.links.forEach(([a, b], i) => {
      const pa = positions.get(a);
      const pb = positions.get(b);
      if (!pa || !pb) return;
      lanePos.set(pa, i * 6);
      lanePos.set(pb, i * 6 + 3);
    });
    laneGeo.setAttribute("position", new THREE.BufferAttribute(lanePos, 3));
    const laneMat = new THREE.LineBasicMaterial({
      color: 0x93a7c8,
      transparent: true,
      opacity: 0.2,
    });
    disposables.push(laneGeo, laneMat);
    const lanes = new THREE.LineSegments(laneGeo, laneMat);
    lanes.raycast = () => {};
    scene.add(lanes);

    const frontierGeo = new THREE.BufferGeometry();
    const frontierMat = new THREE.LineBasicMaterial({
      color: 0xd6e4ff,
      transparent: true,
      opacity: 0.95,
    });
    disposables.push(frontierGeo, frontierMat);
    const frontier = new THREE.LineSegments(frontierGeo, frontierMat);
    frontier.raycast = () => {};
    scene.add(frontier);

    // Node hit targets: one invisible InstancedMesh gives the raycaster a
    // generous, stable click area. The visible star is drawn by sprites — a
    // node reads as a *star* (hot white centre, coloured corona), not an
    // opaque billiard ball, and ownership is encoded by the corona tint plus
    // a crisp flat ring on the plane.
    const coreGeo = new THREE.SphereGeometry(1, 8, 6);
    const coreMat = new THREE.MeshBasicMaterial({ visible: false });
    disposables.push(coreGeo, coreMat);
    const cores = new THREE.InstancedMesh(
      coreGeo,
      coreMat,
      galaxy.nodes.length,
    );
    const m = new THREE.Matrix4();
    galaxy.nodes.forEach((n, i) => {
      const p = positions.get(n.id);
      if (!p) return;
      const scale = n.kind === "capital" ? 2.6 : 2.0;
      m.makeScale(scale, scale, scale).setPosition(p[0], p[1], p[2]);
      cores.setMatrixAt(i, m);
    });
    scene.add(cores);
    disposables.push({ dispose: () => cores.dispose() });

    // Shared sprite textures: a tight hot centre for the star itself and a
    // wide soft falloff for the coloured corona.
    const starTex = radialTexture(64, [
      [0, "#ffffffff"],
      [0.2, "#ffffffee"],
      [0.42, "#ffffff33"],
      [1, "#ffffff00"],
    ]);
    const coronaTex = radialTexture(64, [
      [0, "#ffffffcc"],
      [0.4, "#ffffff44"],
      [1, "#ffffff00"],
    ]);
    disposables.push(starTex, coronaTex);

    /** Whiten an owner colour so the star centre stays hot. */
    const starTint = (c: THREE.Color) =>
      c.clone().lerp(new THREE.Color(0xffffff), 0.72);

    const starMats: THREE.SpriteMaterial[] = [];
    const coronaMats: THREE.SpriteMaterial[] = [];
    const coronaSprites: THREE.Sprite[] = [];
    const ownerRingMats: THREE.MeshBasicMaterial[] = [];
    const starScale = (i: number) =>
      galaxy.nodes[i].kind === "capital" ? 5.4 : 3.8;
    const coronaScale = (i: number, hovered: boolean) => {
      const capital = galaxy.nodes[i].kind === "capital";
      return (capital ? 12.5 : 8.5) * (hovered ? 1.35 : 1);
    };
    const ringGeo = new THREE.RingGeometry(1.75, 2.0, 40);
    disposables.push(ringGeo);
    galaxy.nodes.forEach((n, i) => {
      const p = positions.get(n.id);
      if (!p) return;
      const owner = ownerColor(ownersRef.current[n.id] ?? n.owner);
      const starMat = new THREE.SpriteMaterial({
        map: starTex,
        color: starTint(owner),
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const star = new THREE.Sprite(starMat);
      star.position.set(p[0], p[1], p[2]);
      star.scale.setScalar(starScale(i));
      star.raycast = () => {};
      const coronaMat = new THREE.SpriteMaterial({
        map: coronaTex,
        color: owner,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const corona = new THREE.Sprite(coronaMat);
      corona.position.set(p[0], p[1], p[2]);
      corona.scale.setScalar(coronaScale(i, false));
      corona.raycast = () => {};
      const ringMat = new THREE.MeshBasicMaterial({
        color: owner,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p[0], p[1] - 0.4, p[2]);
      ring.raycast = () => {};
      starMats.push(starMat);
      coronaMats.push(coronaMat);
      coronaSprites.push(corona);
      ownerRingMats.push(ringMat);
      disposables.push(starMat, coronaMat, ringMat);
      scene.add(star, corona, ring);
    });

    // The player's homeworld gets a second, wider ring so "this is you, guard
    // it" is always legible at a glance.
    const homeworld = galaxy.nodes.find(
      (n) => n.kind === "capital" && n.owner === playerFactionId,
    );
    if (homeworld) {
      const p = positions.get(homeworld.id);
      const homeGeo = new THREE.RingGeometry(2.5, 2.68, 48);
      const homeMat = new THREE.MeshBasicMaterial({
        color: ownerColor(playerFactionId),
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      disposables.push(homeGeo, homeMat);
      const home = new THREE.Mesh(homeGeo, homeMat);
      home.rotation.x = -Math.PI / 2;
      if (p) home.position.set(p[0], p[1] - 0.4, p[2]);
      home.raycast = () => {};
      scene.add(home);
    }

    // Selection + incursion rings, flat on the plane under the node.
    const makeRing = (color: number) => {
      const geo = new THREE.RingGeometry(2.6, 3.05, 48);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      disposables.push(geo, mat);
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.raycast = () => {};
      scene.add(ring);
      return ring;
    };
    const selectionRing = makeRing(0xe8f0ff);
    const incursionRing = makeRing(0xffa726);

    /* ------------------------------- labels -------------------------------- */

    const labelObjects: CSS2DObject[] = [];
    if (!performanceMode) {
      galaxy.nodes.forEach((n) => {
        const p = positions.get(n.id);
        if (!p) return;
        const el = document.createElement("div");
        el.textContent = n.name;
        el.style.cssText =
          "pointer-events:none;font-size:11px;letter-spacing:0.04em;" +
          "color:rgba(226,232,240,0.85);text-shadow:0 1px 3px rgba(0,0,0,0.9);" +
          "transform:translateY(10px);";
        const label = new CSS2DObject(el);
        label.position.set(p[0], p[1] - 2.4, p[2]);
        labelObjects.push(label);
        scene.add(label);
      });
    }

    /* ------------------------ renderer + camera ---------------------------- */

    renderer = new THREE.WebGLRenderer({
      antialias: !performanceMode,
      alpha: true,
    });
    renderer.setClearColor(0x000000, 0); // page background shows through
    renderer.setPixelRatio(
      performanceMode ? 1 : Math.min(window.devicePixelRatio, 2),
    );
    container.appendChild(renderer.domElement);
    renderer.domElement.style.cssText =
      "display:block;width:100%;height:100%;position:absolute;inset:0;";

    labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.style.cssText =
      "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
    container.appendChild(labelRenderer.domElement);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2500);
    // Start tilted down onto the plane (~55° from vertical), pulled back to
    // frame the whole play region.
    camera.position.set(0, PLAY_EXTENT * 0.72, PLAY_EXTENT * 0.95);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    // A strategy-map control scheme: drag pans across the plane, the view
    // stays a tilted look-down (no free orbit, no flat top-down, no edge-on).
    controls.minPolarAngle = 0.9;
    controls.maxPolarAngle = 1.25;
    controls.minAzimuthAngle = -0.4;
    controls.maxAzimuthAngle = 0.4;
    controls.screenSpacePanning = false;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.minDistance = 25;
    controls.maxDistance = 170;
    controls.enableDamping = !reduceMotion;

    // Hard-clamp the pan target to the play region (+ margin): you can browse
    // the decorative disc's edge but never lose the playable subsection.
    const MARGIN = 25;
    const clampTarget = () => {
      if (!controls) return;
      const t = controls.target;
      t.x = Math.min(bounds.maxX + MARGIN, Math.max(bounds.minX - MARGIN, t.x));
      t.z = Math.min(bounds.maxZ + MARGIN, Math.max(bounds.minZ - MARGIN, t.z));
      t.y = 0;
    };

    const render = () => {
      if (!renderer || !labelRenderer) return;
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    };
    renderRef.current = render;
    controls.addEventListener("change", () => {
      clampTarget();
      render();
    });

    /* ---------------------- live-mutation callbacks ------------------------ */

    const applyOwners = () => {
      const current = ownersRef.current;
      galaxy.nodes.forEach((n, i) => {
        const owner = current[n.id] ?? n.owner;
        const c = ownerColor(owner);
        starMats[i]?.color.copy(starTint(c));
        coronaMats[i]?.color.copy(c);
        const ringMat = ownerRingMats[i];
        if (ringMat) {
          ringMat.color.copy(c);
          // Your territory reads solid; enemies dimmer; neutral faint.
          ringMat.opacity =
            owner === playerFactionId ? 0.95 : owner === NEUTRAL ? 0.3 : 0.6;
        }
      });
      // Rebuild the frontier overlay (player-owned end ↔ non-player end).
      const frontierPos: number[] = [];
      for (const [a, b] of galaxy.links) {
        const aPlayer = current[a] === playerFactionId;
        const bPlayer = current[b] === playerFactionId;
        if (aPlayer !== bPlayer) {
          const pa = positions.get(a);
          const pb = positions.get(b);
          if (pa && pb) frontierPos.push(...pa, ...pb);
        }
      }
      frontierGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(frontierPos), 3),
      );
    };
    applyOwnersRef.current = applyOwners;

    const applySelection = () => {
      const sel = selectedRef.current;
      const selPos = sel ? positions.get(sel) : undefined;
      selectionRing.visible = !!selPos;
      if (selPos) selectionRing.position.set(selPos[0], selPos[1], selPos[2]);
      const inc = incursionRef.current;
      const incPos = inc ? positions.get(inc.nodeId) : undefined;
      incursionRing.visible = !!incPos;
      if (incPos) incursionRing.position.set(incPos[0], incPos[1], incPos[2]);
    };
    applySelectionRef.current = applySelection;

    applyOwners();
    applySelection();

    /* ------------------------------ picking -------------------------------- */

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered = -1;
    let downAt: [number, number] | null = null;

    const pickAt = (event: PointerEvent): number => {
      const rect = renderer?.domElement.getBoundingClientRect();
      if (!rect) return -1;
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(cores, false)[0];
      return hit?.instanceId ?? -1;
    };

    const onPointerMove = (event: PointerEvent) => {
      const idx = pickAt(event);
      if (idx === hovered) return;
      if (hovered >= 0)
        coronaSprites[hovered]?.scale.setScalar(coronaScale(hovered, false));
      hovered = idx;
      if (hovered >= 0)
        coronaSprites[hovered]?.scale.setScalar(coronaScale(hovered, true));
      if (renderer) {
        renderer.domElement.style.cursor = hovered >= 0 ? "pointer" : "";
      }
      if (reduceMotion) render();
    };
    const onPointerDown = (event: PointerEvent) => {
      downAt = [event.clientX, event.clientY];
    };
    const onPointerUp = (event: PointerEvent) => {
      // A click, not a pan: the pointer barely moved between down and up.
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

    /* ---------------------------- animation loop --------------------------- */

    // Continuous only when motion is allowed: twinkle time, ring pulses and
    // control damping. Under reduce-motion the scene renders on demand
    // (controls change / resize / prop mutations) and stays perfectly still.
    if (!reduceMotion) {
      const animate = () => {
        animationFrame = requestAnimationFrame(animate);
        if (effects) {
          uTime.value = performance.now() / 1000;
          const pulse = 1 + 0.08 * Math.sin(performance.now() / 300);
          if (selectionRing.visible) selectionRing.scale.setScalar(pulse);
          if (incursionRing.visible) {
            incursionRing.scale.setScalar(
              1 + 0.14 * Math.sin(performance.now() / 180),
            );
          }
        }
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
      renderRef.current = null;
      applyOwnersRef.current = null;
      applySelectionRef.current = null;
    };
  }, [galaxy, playerFactionId, reduceMotion, effects, performanceMode]);

  // Prop changes mutate the live scene (and render a frame when the loop is
  // idle under reduce-motion).
  useEffect(() => {
    ownersRef.current = owners;
    applyOwnersRef.current?.();
    if (reduceMotion) renderRef.current?.();
  }, [owners, reduceMotion]);

  useEffect(() => {
    selectedRef.current = selectedId;
    incursionRef.current = incursion;
    applySelectionRef.current?.();
    if (reduceMotion) renderRef.current?.();
  }, [selectedId, incursion, reduceMotion]);

  // The caller's className must make this element positioned (e.g. `absolute
  // inset-0` or `relative h-96`) — the canvas and label layers inside anchor
  // to it with `position: absolute`.
  return (
    <div
      ref={containerRef}
      className={className}
      style={{ overflow: "hidden" }}
    />
  );
}
