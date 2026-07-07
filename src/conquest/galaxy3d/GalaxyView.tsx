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
// `tint` = how far the hot centre lerps toward white (dwarfs stay saturated,
// hot stars blow out); `glow` scales the corona/flare intensity.
const STAR_TYPES = [
  { name: "red dwarf", color: "#c92f12", size: 0.62, tint: 0.14, glow: 0.55 },
  { name: "orange dwarf", color: "#ff8c3a", size: 0.8, tint: 0.28, glow: 0.75 },
  { name: "yellow star", color: "#ffd76e", size: 1.0, tint: 0.45, glow: 1 },
  { name: "white star", color: "#f2f5ff", size: 1.05, tint: 0.7, glow: 1 },
  { name: "white dwarf", color: "#cfe4ff", size: 0.55, tint: 0.65, glow: 0.7 },
  { name: "blue giant", color: "#7fa8ff", size: 1.45, tint: 0.5, glow: 1.25 },
  { name: "red giant", color: "#ff5230", size: 1.55, tint: 0.3, glow: 1.2 },
] as const;
const GIANT_TYPES = [5, 6]; // indices into STAR_TYPES
// Dwarfs are common, giants rare — mirrors a real stellar population.
const TYPE_WEIGHTS = [3, 3, 2, 2, 1, 1, 1];
const WEIGHT_TOTAL = TYPE_WEIGHTS.reduce((a, b) => a + b, 0);

export function starTypeFor(nodeId: string, capital: boolean) {
  const h = hashString(`${nodeId}-stellar`);
  if (capital) return STAR_TYPES[GIANT_TYPES[h % GIANT_TYPES.length]];
  let roll = h % WEIGHT_TOTAL;
  for (let i = 0; i < STAR_TYPES.length; i++) {
    roll -= TYPE_WEIGHTS[i];
    if (roll < 0) return STAR_TYPES[i];
  }
  return STAR_TYPES[2];
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

/**
 * A four-point diffraction-spike flare, computed per-pixel (dither-free):
 * two perpendicular arms with gaussian cross-sections that fade with
 * distance — the classic telescope-photograph star look.
 */
function spikesTexture(size: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(size, size);
    const half = size / 2;
    const armWidth = size * 0.012;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = Math.abs(x + 0.5 - half);
        const dy = Math.abs(y + 0.5 - half);
        const armH =
          Math.exp(-(dy * dy) / (2 * armWidth * armWidth)) *
          Math.max(0, 1 - dx / half) ** 2;
        const armV =
          Math.exp(-(dx * dx) / (2 * armWidth * armWidth)) *
          Math.max(0, 1 - dy / half) ** 2;
        const v = Math.min(1, Math.max(armH, armV) * 1.2);
        const o = (y * size + x) * 4;
        img.data[o] = 255;
        img.data[o + 1] = 255;
        img.data[o + 2] = 255;
        img.data[o + 3] = Math.round(v * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
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
      varying float vSize;
      ${shader.vertexShader.replace(
        "gl_PointSize = size;",
        `gl_PointSize = size * aSize;
         vSize = aSize;
         vTwinkle = 0.72 + 0.28 * sin(uTime * aSpeed + aPhase);`,
      )}`;
    // Points rasterize as squares; a radial falloff on gl_PointCoord rounds
    // them into star dots. Small points render as crisp pinpricks; big ones
    // blend toward a wide soft halo, so the rare bright stars read as
    // glowing orbs (No-Man's-Sky style) instead of scaled-up dots.
    shader.fragmentShader = `
      varying float vTwinkle;
      varying float vSize;
      ${shader.fragmentShader.replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        `float starDist = length(gl_PointCoord - vec2(0.5));
         float soft = smoothstep(1.4, 2.6, vSize);
         float core = smoothstep(mix(0.3, 0.16, soft), 0.04, starDist);
         float halo = exp(-starDist * starDist * 9.0) * mix(0.15, 0.85, soft);
         float starMask = core * mix(1.6, 1.1, soft) + halo;
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
    // Distant sky: the void shouldn't be pure black. A huge gradient dome
    // (vertex-coloured: a faint horizon band, warmed toward the galactic
    // core) plus banks of dim dust clouds out past the zoom/pan limits give
    // the far distance a presence the camera can never reach.
    {
      const domeGeo = new THREE.SphereGeometry(1900, 40, 24);
      const domePos = domeGeo.attributes.position;
      const domeColors = new Float32Array(domePos.count * 3);
      const deep = new THREE.Color("#04050d");
      const band = new THREE.Color("#10162b");
      const warm = new THREE.Color("#1c1410");
      const coreDir = new THREE.Vector2(core[0], core[2]).normalize();
      const v = new THREE.Vector3();
      const c = new THREE.Color();
      for (let i = 0; i < domePos.count; i++) {
        v.fromBufferAttribute(domePos, i);
        // Horizon band: strongest near the galactic plane, fading with |y|.
        const bandT = Math.exp(-((Math.abs(v.y) / 420) ** 2));
        // Warmth toward the core's side of the sky.
        const toward = Math.max(
          0,
          new THREE.Vector2(v.x, v.z).normalize().dot(coreDir),
        );
        c.copy(deep)
          .lerp(band, bandT)
          .add(warm.clone().multiplyScalar(bandT * toward * 0.9));
        domeColors.set([c.r, c.g, c.b], i * 3);
      }
      domeGeo.setAttribute("color", new THREE.BufferAttribute(domeColors, 3));
      const domeMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.BackSide,
        depthWrite: false,
      });
      disposables.push(domeGeo, domeMat);
      const dome = new THREE.Mesh(domeGeo, domeMat);
      dome.renderOrder = -1;
      dome.raycast = () => {};
      scene.add(dome);
    }
    if (!performanceMode && effects) {
      const dustTex = radialTexture(128, [
        [0, "#ffffff55"],
        [0.45, "#ffffff22"],
        [1, "#ffffff00"],
      ]);
      disposables.push(dustTex);
      const dustColors = ["#3a3350", "#243447", "#453026", "#2c3a52"];
      const dustRng = mulberry32(hashString(`${galaxy.id}-dust`));
      const coreAngleXZ = Math.atan2(core[2], core[0]);
      for (let i = 0; i < 8; i++) {
        const mat = new THREE.SpriteMaterial({
          map: dustTex,
          color: dustColors[i % dustColors.length],
          transparent: true,
          opacity: 0.05 + dustRng() * 0.05,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        disposables.push(mat);
        const sprite = new THREE.Sprite(mat);
        // Banked along the core's side of the sky, far beyond the pan clamp.
        const angle = coreAngleXZ + (dustRng() - 0.5) * 1.7;
        const dist = 1200 + dustRng() * 450;
        sprite.position.set(
          Math.cos(angle) * dist,
          -220 + dustRng() * 330,
          Math.sin(angle) * dist,
        );
        const scale = 520 + dustRng() * 520;
        sprite.scale.set(scale, scale * (0.4 + dustRng() * 0.3), 1);
        sprite.raycast = () => {};
        scene.add(sprite);
      }
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
    // No-Man's-Sky-style lines: each lane draws twice — a crisp thin core
    // plus a wide, very faint additive halo — so it reads as a glowing
    // filament rather than a flat ribbon.
    const LANE_CORE_W = 0.16;
    const LANE_HALO_W = 1.05;
    const laneTex = capsuleTexture();
    disposables.push(laneTex);
    interface LanePair {
      core: THREE.Mesh;
      halo: THREE.Mesh;
    }
    const makeLanePair = (opts: {
      color?: number;
      vertexColors?: boolean;
      coreOpacity: number;
      haloOpacity: number;
    }): LanePair => {
      const make = (opacity: number, halo: boolean) => {
        const mat = new THREE.MeshBasicMaterial({
          map: laneTex,
          color: opts.color ?? 0xffffff,
          vertexColors: opts.vertexColors ?? false,
          transparent: true,
          opacity,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: halo ? THREE.AdditiveBlending : THREE.NormalBlending,
        });
        disposables.push(mat);
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        mesh.raycast = () => {};
        scene.add(mesh);
        return mesh;
      };
      return {
        core: make(opts.coreOpacity, false),
        halo: make(opts.haloOpacity, true),
      };
    };
    const setLanePair = (
      pair: LanePair,
      segs: LaneSeg[],
      colors?: THREE.Color[],
    ) => {
      pair.core.geometry.dispose();
      pair.core.geometry = laneQuadGeometry(segs, LANE_CORE_W, colors);
      pair.halo.geometry.dispose();
      pair.halo.geometry = laneQuadGeometry(segs, LANE_HALO_W, colors);
    };
    const disposeLanePair = (pair: LanePair) => {
      pair.core.geometry.dispose();
      pair.halo.geometry.dispose();
    };
    const lanes = makeLanePair({
      color: 0x93a7c8,
      coreOpacity: 0.4,
      haloOpacity: 0.06,
    });
    const factionLanes = makeLanePair({
      vertexColors: true,
      coreOpacity: 0.6,
      haloOpacity: 0.1,
    });
    // Contested routes: fine warm-gold dashes, NMS plotted-course style.
    const frontier = makeLanePair({
      color: 0xffcf8a,
      coreOpacity: 0.95,
      haloOpacity: 0.14,
    });

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

    // Shared sprite textures: a gaussian-falloff hot centre, a wide soft
    // corona, and a four-point diffraction flare.
    const starTex = radialTexture(128, [
      [0, "#ffffffff"],
      [0.12, "#fffffff2"],
      [0.25, "#ffffff88"],
      [0.4, "#ffffff2a"],
      [0.6, "#ffffff08"],
      [1, "#ffffff00"],
    ]);
    const coronaTex = radialTexture(128, [
      [0, "#ffffffcc"],
      [0.4, "#ffffff44"],
      [1, "#ffffff00"],
    ]);
    const spikeTex = spikesTexture(256);
    disposables.push(starTex, coronaTex, spikeTex);

    const coronaSprites: THREE.Sprite[] = [];
    const ownerRingMats: THREE.MeshBasicMaterial[] = [];
    const ownerRings: THREE.Mesh[] = [];
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
    const ringGeo = new THREE.RingGeometry(1.77, 2.08, 40);
    disposables.push(ringGeo);
    galaxy.nodes.forEach((n, i) => {
      const p = positions.get(n.id);
      if (!p) return;
      const type = nodeType[i];
      const stellar = new THREE.Color(type.color);
      // Normal blending (not additive): the hot core is near-opaque, so the
      // decorative starfield behind a node can't shine through it. Dwarfs
      // keep their saturation; hot stars blow out toward white (type.tint).
      const starMat = new THREE.SpriteMaterial({
        map: starTex,
        color: stellar.clone().lerp(new THREE.Color(0xffffff), type.tint),
        transparent: true,
        opacity: 1,
        depthWrite: false,
      });
      const star = new THREE.Sprite(starMat);
      star.position.set(p[0], p[1], p[2]);
      star.scale.setScalar(starScale(i));
      star.raycast = () => {};
      // Diffraction spikes — the telescope-photo flare that sells "star".
      const spikeMat = new THREE.SpriteMaterial({
        map: spikeTex,
        color: stellar.clone().lerp(new THREE.Color(0xffffff), 0.4),
        transparent: true,
        opacity: Math.min(0.85, 0.5 * type.glow),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const spikes = new THREE.Sprite(spikeMat);
      spikes.position.set(p[0], p[1], p[2]);
      spikes.scale.setScalar(starScale(i) * 2.9);
      spikes.raycast = () => {};
      disposables.push(spikeMat);
      scene.add(spikes);
      const coronaMat = new THREE.SpriteMaterial({
        map: coronaTex,
        color: stellar,
        transparent: true,
        opacity: Math.min(0.8, 0.45 * type.glow),
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
      ownerRings.push(ring);
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

    // Incursion marker: an unambiguous warning symbol floating above the
    // threatened star (a pulsing ring read as decoration; a warning triangle
    // doesn't). CSS2D so it stays screen-sized and crisp; the pulse is a CSS
    // animation, dropped when effects are off.
    const incursionEl = document.createElement("div");
    incursionEl.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" ' +
      'viewBox="0 0 24 24" fill="rgba(120,70,0,0.55)" stroke="#ffb020" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2Z"/>' +
      '<path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
    incursionEl.style.cssText =
      "pointer-events:none;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.9));";
    if (effects && !reduceMotion) {
      incursionEl.className = "gx-incursion-marker";
    }
    const incursionMarker = new CSS2DObject(incursionEl);
    incursionMarker.visible = false;
    scene.add(incursionMarker);

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
      galaxy.nodes.forEach((_n, i) => {
        if (i !== sel.idx) styleRing(i);
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
      setLanePair(lanes, baseSegs);
      setLanePair(factionLanes, factionSegs, factionSegColors);
      setLanePair(frontier, dashSegments(frontierSegs, 1.15, 1.05));
    };
    applyOwnersRef.current = applyOwners;

    /** Reset a ring to its plain ownership style (colour + opacity). */
    const styleRing = (i: number) => {
      const mat = ownerRingMats[i];
      if (!mat) return;
      const owner =
        ownersRef.current[galaxy.nodes[i].id] ?? galaxy.nodes[i].owner;
      mat.color.copy(ownerColor(owner));
      mat.opacity =
        owner === playerFactionId ? 1 : owner === NEUTRAL ? 0.3 : 0.75;
    };

    // Selection enlarges the node's own ownership ring and pulses its colour
    // (see the animation loop) — no second ring.
    const sel = { idx: -1 };
    const applySelection = () => {
      const selId = selectedRef.current;
      const idx = selId ? nodeIds.indexOf(selId) : -1;
      if (sel.idx >= 0 && sel.idx !== idx) {
        ownerRings[sel.idx]?.scale.setScalar(1);
        styleRing(sel.idx);
      }
      sel.idx = idx;
      if (idx >= 0) {
        ownerRings[idx]?.scale.setScalar(1.3);
        // Static brighten covers the no-animation paths; the loop overrides
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
          const now = performance.now();
          uTime.value = now / 1000;
          if (sel.idx >= 0) {
            const ring = ownerRings[sel.idx];
            const mat = ownerRingMats[sel.idx];
            if (ring && mat) {
              ring.scale.setScalar(1.3 + 0.06 * Math.sin(now / 280));
              const owner =
                ownersRef.current[galaxy.nodes[sel.idx].id] ??
                galaxy.nodes[sel.idx].owner;
              mat.color
                .copy(ownerColor(owner))
                .lerp(
                  new THREE.Color(0xffffff),
                  0.3 + 0.25 * Math.sin(now / 280),
                );
              mat.opacity = 1;
            }
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
      disposeLanePair(lanes);
      disposeLanePair(factionLanes);
      disposeLanePair(frontier);
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
