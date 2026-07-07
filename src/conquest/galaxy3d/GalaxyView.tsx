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

/**
 * Stellar classes for the selectable stars. The star itself is coloured by
 * its class — red dwarfs to blue giants — while *ownership* lives entirely on
 * the ring (and corona ring tint stays stellar too). Class is a deterministic
 * hash of the node id, with capitals biased toward the giant classes so they
 * read important.
 */
const STAR_TYPES = [
  { name: "red dwarf", color: "#ff6a45", size: 0.68 },
  { name: "orange dwarf", color: "#ffa04d", size: 0.85 },
  { name: "yellow star", color: "#ffd76e", size: 1.0 },
  { name: "white star", color: "#f2f5ff", size: 1.05 },
  { name: "white dwarf", color: "#cfe4ff", size: 0.58 },
  { name: "blue giant", color: "#8fb4ff", size: 1.45 },
  { name: "red giant", color: "#ff5f4e", size: 1.55 },
] as const;
const GIANT_TYPES = [5, 6]; // indices into STAR_TYPES

export function starTypeFor(nodeId: string, capital: boolean) {
  const h = hashString(`${nodeId}-stellar`);
  if (capital) return STAR_TYPES[GIANT_TYPES[h % GIANT_TYPES.length]];
  return STAR_TYPES[h % STAR_TYPES.length];
}

/** One lane segment in 3D: [x1, y1, z1, x2, y2, z2]. */
type LaneSeg = [number, number, number, number, number, number];

/**
 * A merged flat-quad geometry for the lanes: `LineBasicMaterial` linewidth is
 * ignored on nearly every platform, so thin translucent quads give the thick,
 * anti-aliased connections lines can't. Endpoint heights interpolate so a
 * lane meets each node's ring at the ring's own height. UVs run along each
 * quad (u = length axis) so a capsule alpha texture rounds the ends; an
 * optional per-segment colour becomes a vertex-colour attribute.
 */
function laneQuadGeometry(
  segments: LaneSeg[],
  width: number,
  colors?: THREE.Color[],
): THREE.BufferGeometry {
  const positions = new Float32Array(segments.length * 4 * 3);
  const uvs = new Float32Array(segments.length * 4 * 2);
  const colorAttr = colors
    ? new Float32Array(segments.length * 4 * 3)
    : undefined;
  const indices: number[] = [];
  segments.forEach(([x1, y1, z1, x2, y2, z2], i) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1;
    // Perpendicular in the plane, half-width each side.
    const px = (-dz / len) * (width / 2);
    const pz = (dx / len) * (width / 2);
    positions.set(
      [
        x1 + px,
        y1,
        z1 + pz,
        x1 - px,
        y1,
        z1 - pz,
        x2 + px,
        y2,
        z2 + pz,
        x2 - px,
        y2,
        z2 - pz,
      ],
      i * 12,
    );
    uvs.set([0, 1, 0, 0, 1, 1, 1, 0], i * 8);
    if (colorAttr && colors) {
      const c = colors[i];
      for (let v = 0; v < 4; v++) {
        colorAttr.set([c.r, c.g, c.b], i * 12 + v * 3);
      }
    }
    const b = i * 4;
    indices.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  if (colorAttr) {
    geo.setAttribute("color", new THREE.BufferAttribute(colorAttr, 3));
  }
  geo.setIndex(indices);
  return geo;
}

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
      // Skip stubby leftovers — a dash shorter than its own caps looks messy.
      if (end - at < dashLen * 0.5) break;
      out.push([...at3(at / len), ...at3(end / len)] as LaneSeg);
    }
  }
  return out;
}

/** A white capsule (rounded-ends bar) alpha texture for the lane quads. */
function capsuleTexture(): THREE.Texture {
  const w = 128;
  const h = 32;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(1, 1, w - 2, h - 2, h / 2 - 1);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Parse `#rrggbb` / `#rrggbbaa` into 0-255 channels. */
function hexRgba(hex: string): [number, number, number, number] {
  const h = hex.replace("#", "");
  const n = Number.parseInt(h.length === 6 ? `${h}ff` : h, 16);
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

/**
 * Radial-gradient sprite texture (star cores, glows and nebulae), computed
 * per-pixel into ImageData rather than via `createRadialGradient`: WebKit's
 * CoreGraphics dithers canvas gradients with per-channel noise, which — once
 * magnified and additively blended — showed up as coloured speckles on the
 * stars. Pure maths has no dither.
 */
function radialTexture(size: number, stops: [number, string][]): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const rgba = stops.map(([at, color]) => [at, hexRgba(color)] as const);
    const img = ctx.createImageData(size, size);
    const half = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.min(
          1,
          Math.hypot(x + 0.5 - half, y + 0.5 - half) / half,
        );
        // Find the bracketing stops and lerp between them.
        let lo = rgba[0];
        let hi = rgba[rgba.length - 1];
        for (let i = 0; i < rgba.length - 1; i++) {
          if (d >= rgba[i][0] && d <= rgba[i + 1][0]) {
            lo = rgba[i];
            hi = rgba[i + 1];
            break;
          }
        }
        const span = hi[0] - lo[0];
        const t = span > 0 ? (d - lo[0]) / span : 0;
        const o = (y * size + x) * 4;
        for (let c = 0; c < 4; c++) {
          img.data[o + c] = Math.round(lo[1][c] + (hi[1][c] - lo[1][c]) * t);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
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

    const makeStars = (
      count: number,
      radius: number,
      thickness: number,
      yOffset: number,
      seedSuffix: string,
      pointSize: number,
      center?: [number, number, number],
      palette?: string[],
    ) => {
      const stars = buildStarfield({
        count,
        radius,
        thickness,
        yOffset,
        seed: galaxy.id + seedSuffix,
        palette: palette ?? galaxy.theme?.starPalette,
        center,
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

    // The decorative galaxy is far bigger than the playable patch, and the
    // playable stars sit out in its arms rather than at its centre: the disc
    // is centred on a distant galactic core (direction hashed per galaxy)
    // placed well beyond the pan clamp and zoom range — you can look toward
    // the bright core but never reach it.
    const coreAngle = ((hashString(`${galaxy.id}-core`) % 360) * Math.PI) / 180;
    const CORE_DIST = PLAY_EXTENT * 5.5;
    const core: [number, number, number] = [
      Math.cos(coreAngle) * CORE_DIST,
      -42,
      Math.sin(coreAngle) * CORE_DIST,
    ];
    scene.add(
      makeStars(
        performanceMode ? 9000 : 22000,
        PLAY_EXTENT * 7,
        55,
        0,
        "",
        1.5,
        core,
      ),
    );
    // The core itself: a dense warm cluster plus stacked glow sprites.
    scene.add(
      makeStars(performanceMode ? 1200 : 3000, 65, 30, 0, "-core", 1.7, core, [
        "#ffe9c9",
        "#ffd9a0",
        "#fff4e0",
      ]),
    );
    const coreGlowTex = radialTexture(128, [
      [0, "#ffe7c2ee"],
      [0.35, "#ffdba066"],
      [1, "#ffd99000"],
    ]);
    disposables.push(coreGlowTex);
    for (const [scale, opacity] of [
      [430, 0.1],
      [260, 0.16],
      [130, 0.26],
    ] as const) {
      const mat = new THREE.SpriteMaterial({
        map: coreGlowTex,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      disposables.push(mat);
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(core[0], core[1], core[2]);
      sprite.scale.set(scale, scale * 0.7, 1);
      sprite.raycast = () => {};
      scene.add(sprite);
    }
    // Near layer: a deep scatter around and *below* the play plane, so
    // tilting reveals stars underneath the map and panning parallaxes.
    scene.add(
      makeStars(
        performanceMode ? 2000 : 4500,
        PLAY_EXTENT * 2.4,
        60,
        -14,
        "-near",
        1.0,
      ),
    );

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

    // Lanes: thick translucent capsule quads connecting ring edge to ring
    // edge (each end trimmed back from the node centre and drawn at that
    // node's ring height). Three overlays, all rebuilt when ownership
    // changes: a quiet neutral base, faction-coloured lanes where both ends
    // share an owner, and dashed contested lanes on the player's frontier.
    const LANE_WIDTH = 0.5;
    const RING_Y = -0.4; // matches the ownership rings below
    const LANE_TRIM = 2.45; // just outside the ring's outer radius
    const laneEnd = (id: string): [number, number, number] | null => {
      const p = positions.get(id);
      return p ? [p[0], p[1] + RING_Y, p[2]] : null;
    };
    const trimmedSeg = (aId: string, bId: string): LaneSeg | null => {
      const a = laneEnd(aId);
      const b = laneEnd(bId);
      if (!a || !b) return null;
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (len <= LANE_TRIM * 2 + 0.5) return null;
      const at = (t: number): [number, number, number] => [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ];
      const t0 = LANE_TRIM / len;
      return [...at(t0), ...at(1 - t0)] as LaneSeg;
    };
    const laneTex = capsuleTexture();
    disposables.push(laneTex);
    const makeLaneMesh = (mat: THREE.MeshBasicMaterial) => {
      disposables.push(mat);
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.raycast = () => {};
      scene.add(mesh);
      return mesh;
    };
    const lanes = makeLaneMesh(
      new THREE.MeshBasicMaterial({
        map: laneTex,
        color: 0x93a7c8,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const factionLanes = makeLaneMesh(
      new THREE.MeshBasicMaterial({
        map: laneTex,
        vertexColors: true,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const frontier = makeLaneMesh(
      new THREE.MeshBasicMaterial({
        map: laneTex,
        color: 0xdbe7ff,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );

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
    const starTex = radialTexture(128, [
      [0, "#ffffffff"],
      [0.2, "#ffffffee"],
      [0.42, "#ffffff33"],
      [1, "#ffffff00"],
    ]);
    const coronaTex = radialTexture(128, [
      [0, "#ffffffcc"],
      [0.4, "#ffffff44"],
      [1, "#ffffff00"],
    ]);
    disposables.push(starTex, coronaTex);

    /** Whiten a stellar colour so the star centre stays hot. */
    const starTint = (c: THREE.Color) =>
      c.clone().lerp(new THREE.Color(0xffffff), 0.55);

    const coronaSprites: THREE.Sprite[] = [];
    const ownerRingMats: THREE.MeshBasicMaterial[] = [];
    // Star size = stellar class × role: a red giant capital dwarfs a white
    // dwarf border system, per-node hash keeps the mix stable.
    const nodeType = galaxy.nodes.map((n) =>
      starTypeFor(n.id, n.kind === "capital"),
    );
    const starScale = (i: number) =>
      (galaxy.nodes[i].kind === "capital" ? 4.6 : 3.6) * nodeType[i].size;
    const coronaScale = (i: number, hovered: boolean) => {
      const capital = galaxy.nodes[i].kind === "capital";
      return (capital ? 10.5 : 7.5) * nodeType[i].size * (hovered ? 1.35 : 1);
    };
    const ringGeo = new THREE.RingGeometry(1.7, 2.15, 40);
    disposables.push(ringGeo);
    galaxy.nodes.forEach((n, i) => {
      const p = positions.get(n.id);
      if (!p) return;
      const stellar = new THREE.Color(nodeType[i].color);
      // Normal blending (not additive): the hot core is near-opaque, so the
      // decorative starfield behind a node can't shine through it as
      // coloured speckles.
      const starMat = new THREE.SpriteMaterial({
        map: starTex,
        color: starTint(stellar),
        transparent: true,
        opacity: 1,
        depthWrite: false,
      });
      const star = new THREE.Sprite(starMat);
      star.position.set(p[0], p[1], p[2]);
      star.scale.setScalar(starScale(i));
      star.raycast = () => {};
      const coronaMat = new THREE.SpriteMaterial({
        map: coronaTex,
        color: stellar,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const corona = new THREE.Sprite(coronaMat);
      corona.position.set(p[0], p[1], p[2]);
      corona.scale.setScalar(coronaScale(i, false));
      corona.raycast = () => {};
      // Ownership lives on the ring alone (saturated faction colour).
      const ringMat = new THREE.MeshBasicMaterial({
        color: ownerColor(ownersRef.current[n.id] ?? n.owner),
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p[0], p[1] - 0.4, p[2]);
      ring.raycast = () => {};
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
    controls.minPolarAngle = 0.12; // allow a near-top-down view
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
    controls.maxDistance = 220;
    controls.zoomToCursor = true;
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
        const ringMat = ownerRingMats[i];
        if (ringMat) {
          ringMat.color.copy(ownerColor(owner));
          // Your territory reads solid; enemies dimmer; neutral faint.
          ringMat.opacity =
            owner === playerFactionId ? 1 : owner === NEUTRAL ? 0.3 : 0.75;
        }
      });
      // Re-categorise every lane: contested (exactly one player end, drawn
      // dashed), same-owner (both ends one faction, drawn in its colour),
      // else the quiet neutral base.
      const baseSegs: LaneSeg[] = [];
      const factionSegs: LaneSeg[] = [];
      const factionSegColors: THREE.Color[] = [];
      const frontierSegs: LaneSeg[] = [];
      for (const [a, b] of galaxy.links) {
        const seg = trimmedSeg(a, b);
        if (!seg) continue;
        const ownerA = current[a] ?? NEUTRAL;
        const ownerB = current[b] ?? NEUTRAL;
        const aPlayer = ownerA === playerFactionId;
        const bPlayer = ownerB === playerFactionId;
        if (aPlayer !== bPlayer) {
          frontierSegs.push(seg);
        } else if (ownerA === ownerB && ownerA !== NEUTRAL) {
          factionSegs.push(seg);
          factionSegColors.push(ownerColor(ownerA));
        } else {
          baseSegs.push(seg);
        }
      }
      lanes.geometry.dispose();
      lanes.geometry = laneQuadGeometry(baseSegs, LANE_WIDTH);
      factionLanes.geometry.dispose();
      factionLanes.geometry = laneQuadGeometry(
        factionSegs,
        LANE_WIDTH,
        factionSegColors,
      );
      frontier.geometry.dispose();
      frontier.geometry = laneQuadGeometry(
        dashSegments(frontierSegs, 2.2, 1.7),
        LANE_WIDTH,
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
      lanes.geometry.dispose();
      factionLanes.geometry.dispose();
      frontier.geometry.dispose();
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
