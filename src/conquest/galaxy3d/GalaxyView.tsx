import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { assetUrl } from "../../lib/assetUrl";
import type { GalaxyDoc, GalaxyNode, Incursion } from "../model";
import { NEUTRAL } from "../model";
import { mulberry32 } from "../rng";
import { bodyLabel, type VoidBody, voidBodiesFor } from "./bodies";
import { factionSides } from "./factionShape";
import {
  hashString,
  layoutNodes,
  playBounds,
  playExtentFor,
  type WorldPos,
} from "./layout";
import { buildStarfield } from "./starfield";
import {
  accretionTexture,
  anomalyTexture,
  asteroidTexture,
  cometTailTexture,
  gasGiantTexture,
  greebleTexture,
  radialTexture,
  spaceEnvTexture,
  spikesTexture,
} from "./textures";

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

/**
 * Per-node graded emphasis for the run map (see {@link GalaxyViewProps.emphasis}).
 * A struct rather than a bare opacity so more emphasis dimensions (glow, tint,
 * …) can be added later without churning the prop's type.
 */
export interface NodeEmphasis {
  /** Opacity multiplier for the node and its lanes, 0..1. Absent means 1. */
  opacity?: number;
  /** A small glyph drawn over the node. `check` = a completed/crossed marker. */
  marker?: "check";
  /** Occasional ambient combat flashes over the node (upcoming battle sites). */
  flash?: boolean;
}

/**
 * Warpath-only per-node identity (see {@link GalaxyViewProps.identities}). Some
 * run nodes read as a distinct body — a depot station, a salvage wreck, an event
 * anomaly, the start beacon, or the warlord's lair — instead of a plain star;
 * others keep their star tinted toward a danger hue. Default-off, so conquest —
 * which omits the prop — is unchanged.
 */
export type NodeBodyKind =
  | "station"
  | "wreck"
  | "anomaly"
  | "beacon"
  | "warlord-blackhole"
  | "warlord-hypergiant"
  | "warlord-fortress";

export interface NodeIdentity {
  /** Replace the node's star with a special body. */
  body?: NodeBodyKind;
  /**
   * Nudge the (still-stellar) star toward this `#rrggbb` — danger red for battle
   * sites. Kept subtle and stellar-plausible by the caller.
   */
  starTint?: string;
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
  /**
   * Fog of war: the node ids the player can see. `undefined` means no fog —
   * everything is shown. Fogged nodes render as dim, unlabelled, unselectable
   * ghosts; lanes into the fog fade out.
   */
  visibleIds?: Set<string>;
  /**
   * Graded de-emphasis, distinct from fog: for each listed node id, the node
   * (and lanes touching it) render at reduced opacity but stay fully present —
   * ring, label and glow are kept, not hidden. `undefined`/absent means full
   * brightness. An object per node (not a bare number) so future emphasis
   * dimensions can be added without a new prop. Default-off; conquest omits it.
   */
  emphasis?: Map<string, NodeEmphasis>;
  /**
   * Run-map lane styling. When true, the player's *outgoing* frontier lanes
   * (the choices ahead) render as solid directional routes with an
   * outward-travelling pulse, and the incoming lane you already crossed is
   * muted rather than dashed. Default `false` keeps conquest's contested dashes.
   */
  laneFlow?: boolean;
  /**
   * Directed link keys (`"from to"`) to draw as a highlighted route already
   * travelled — the run's path taken, kept green and bright up to the current
   * node. Only honoured with {@link laneFlow}. Default-off.
   */
  pathLinks?: Set<string>;
  /**
   * Fire a one-shot celebratory burst (shockwave + flare) on this node — e.g.
   * the star of a battle just won. Set it to the node id to play; set back to
   * null when done so the next win replays. No burst under reduce-motion.
   */
  burstNodeId?: string | null;
  /** Map spring-names known to be space maps; their nodes render as asteroids. */
  spaceMaps?: Set<string>;
  /**
   * Warpath-only per-node identity: special bodies (station / wreck / anomaly /
   * beacon / warlord) and danger star-tints, keyed by node id. Applied at build
   * time (a new map rebuilds the scene, like `galaxy`), since it derives from the
   * run's stable structure. Default-off; conquest omits it so its sky is
   * byte-identical.
   */
  identities?: Map<string, NodeIdentity>;
  /**
   * Warpath-only: redden and darken the nebula toward the warlord (the far
   * column), so the sky grows more ominous with map depth. Applied at build time
   * from each cloud's world-X. Default `false`; conquest keeps its even haze.
   */
  depthMood?: boolean;
  /**
   * Zoom the camera in on a node (e.g. the system being fought over) and lock
   * user controls; `null`/undefined eases back to the framed overview. Driven
   * live, no scene rebuild.
   */
  focusNodeId?: string | null;
  display?: Partial<GalaxyDisplay>;
  className?: string;
}

const NEUTRAL_COLOR = "#6b7280";
/** The quiet blue-grey of an unowned lane (the base lane pair's colour). */
const BASE_LANE_HEX = 0x93a7c8;

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
  { name: "blue giant", color: "#7fa8ff", size: 1.9, tint: 0.5, glow: 1.25 },
  { name: "red giant", color: "#ff5230", size: 2.05, tint: 0.3, glow: 1.2 },
] as const;
const GIANT_TYPES = [5, 6]; // indices into STAR_TYPES
// Dwarfs are common, giants rare — mirrors a real stellar population.
const TYPE_WEIGHTS = [3, 3, 2, 2, 1, 1, 1];
const WEIGHT_TOTAL = TYPE_WEIGHTS.reduce((a, b) => a + b, 0);

export type StarType = (typeof STAR_TYPES)[number];

export function starTypeFor(nodeId: string, capital: boolean): StarType {
  const h = hashString(`${nodeId}-stellar`);
  if (capital) return STAR_TYPES[GIANT_TYPES[h % GIANT_TYPES.length]];
  let roll = h % WEIGHT_TOTAL;
  for (let i = 0; i < STAR_TYPES.length; i++) {
    roll -= TYPE_WEIGHTS[i];
    if (roll < 0) return STAR_TYPES[i];
  }
  return STAR_TYPES[2];
}

// A companion is drawn from the small/dim classes so a binary reads as a
// primary with a lesser partner (dwarfs), never two giants.
const COMPANION_TYPES = [0, 1, 4]; // red dwarf, orange dwarf, white dwarf

export interface StarSystem {
  primary: StarType;
  /** Present ~1 in 6 systems — the map/backdrop draws a second, smaller star. */
  companion?: StarType;
}

/**
 * The stellar system for a node: its primary class plus, deterministically for
 * roughly one node in six, a dwarf companion. Same hash-of-id approach as
 * {@link starTypeFor} so map, panel and battle backdrop always agree.
 */
export function starSystemFor(nodeId: string, capital: boolean): StarSystem {
  const primary = starTypeFor(nodeId, capital);
  const binary = hashString(`${nodeId}-binary`) % 6 === 0;
  const companion = binary
    ? STAR_TYPES[
        COMPANION_TYPES[
          hashString(`${nodeId}-companion`) % COMPANION_TYPES.length
        ]
      ]
    : undefined;
  return { primary, companion };
}

/** A human label for a node's stellar system (selection panel). */
export function starSystemLabel(system: StarSystem): string {
  return system.companion
    ? `binary pair — ${system.primary.name} + ${system.companion.name}`
    : system.primary.name;
}

/**
 * Rare exotic stellar phenomena, shared across conquest and warpath so both skies
 * gain a few unusual systems. Kept sparse (a few percent) and physically-grounded
 * — a blue-white pulsar, a pulsing variable, a ringed gas giant, a dying carbon
 * star. The warlord's black hole is deliberately *not* here (boss-only). Rolled
 * on an independent `-exotic` hash, so no existing star assignment shifts.
 */
export type ExoticClass = "pulsar" | "variable" | "gasgiant" | "carbon";

const EXOTIC_LABEL: Record<ExoticClass, string> = {
  pulsar: "pulsar",
  variable: "variable star",
  gasgiant: "ringed gas giant",
  carbon: "carbon star",
};

/** The exotic class for a node, or `undefined` for an ordinary star (~94%). */
export function exoticClassFor(nodeId: string): ExoticClass | undefined {
  const h = hashString(`${nodeId}-exotic`) % 1000;
  if (h < 15) return "pulsar";
  if (h < 30) return "variable";
  if (h < 45) return "gasgiant";
  if (h < 60) return "carbon";
  return undefined;
}

/**
 * Selection-panel label for a node. `voidBody` (from the galaxy-wide
 * `voidBodiesFor`) is set for space-map nodes and undefined otherwise. Non-void,
 * non-capital nodes may be a rare exotic; otherwise the stellar-system name.
 */
export function nodeBodyLabel(
  nodeId: string,
  capital: boolean,
  voidBody: VoidBody | undefined,
): string {
  if (voidBody) return bodyLabel(voidBody);
  if (!capital) {
    const exotic = exoticClassFor(nodeId);
    if (exotic) return EXOTIC_LABEL[exotic];
  }
  return starSystemLabel(starSystemFor(nodeId, capital));
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

/**
 * A light-filament texture for the lane quads: a gaussian profile across the
 * width (no hard edge at any zoom) rolled off smoothly at both ends.
 * `sigma` is the gaussian width as a fraction of the quad's height — small
 * for the crisp core line, large for the soft halo.
 */
function filamentTexture(sigma: number): THREE.Texture {
  const w = 256;
  const h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const v = (y + 0.5) / h - 0.5;
      const across = Math.exp(-(v * v) / (2 * sigma * sigma));
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w;
        // Ease in/out over the end 12% so dashes and lane ends stay soft.
        const along = Math.min(1, Math.min(u, 1 - u) / 0.12);
        const a = across * along * (2 - along);
        const o = (y * w + x) * 4;
        img.data[o] = 255;
        img.data[o + 1] = 255;
        img.data[o + 2] = 255;
        img.data[o + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A single soft chevron pointing toward +x, drawn white with a gaussian glow so
 * it reads as a light arrowhead under additive blending. Used as travelling
 * direction markers along the run's open routes (`laneFlow`).
 */
function chevronTexture(size: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = size * 0.14;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = size * 0.16;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const m = size * 0.5;
    const s = size * 0.3;
    ctx.beginPath();
    ctx.moveTo(m - s * 0.5, m - s);
    ctx.lineTo(m + s * 0.7, m); // tip toward +x
    ctx.lineTo(m - s * 0.5, m + s);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A soft glowing annulus — the expanding shockwave ring of a win burst.
 */
function ringBurstTexture(size: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = size * 0.05;
    ctx.shadowColor = "#ffe9b0";
    ctx.shadowBlur = size * 0.1;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A soft check-mark glyph on a transparent field, drawn white with a glow so it
 * reads as a completed marker over a node under normal blending. Tinted per use.
 */
function checkTexture(size: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.shadowColor = "#000000";
    ctx.shadowBlur = size * 0.1;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = size * 0.15;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(size * 0.26, size * 0.52);
    ctx.lineTo(size * 0.44, size * 0.7);
    ctx.lineTo(size * 0.76, size * 0.32);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Procedural theatre-map chart: a dark slate plane with a faint grid and a
 * per-pixel vignette — the fallback when a theatre theme ships no backdrop.
 * Shared with the battle backdrop for theatre-skinned galaxies.
 */
export function theatreChartTexture(): THREE.Texture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#141a24";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(148, 168, 200, 0.07)";
    ctx.lineWidth = 1;
    const step = size / 24;
    for (let i = 0; i <= 24; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * step);
      ctx.lineTo(size, i * step);
      ctx.stroke();
    }
    // Per-pixel vignette (a canvas radial gradient would dither).
    const img = ctx.getImageData(0, 0, size, size);
    const half = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - half, y - half) / half;
        const dim = 1 - 0.55 * Math.min(1, d) ** 2;
        const o = (y * size + x) * 4;
        img.data[o] *= dim;
        img.data[o + 1] *= dim;
        img.data[o + 2] *= dim;
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
  visibleIds,
  emphasis,
  laneFlow = false,
  pathLinks,
  burstNodeId,
  spaceMaps,
  identities,
  depthMood = false,
  focusNodeId,
  display,
  className,
}: GalaxyViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Live-mutation channels into the built scene (no rebuild on change).
  const ownersRef = useRef(owners);
  const selectedRef = useRef<string | null | undefined>(selectedId);
  const incursionRef = useRef(incursion);
  const visibleRef = useRef<Set<string> | undefined>(visibleIds);
  const emphasisRef = useRef<Map<string, NodeEmphasis> | undefined>(emphasis);
  const pathLinksRef = useRef<Set<string> | undefined>(pathLinks);
  const burstRef = useRef<string | null | undefined>(burstNodeId);
  const applyBurstRef = useRef<(() => void) | null>(null);
  const focusRef = useRef<string | null | undefined>(focusNodeId);
  const onSelectRef = useRef(onSelect);
  const applyOwnersRef = useRef<(() => void) | null>(null);
  const applySelectionRef = useRef<(() => void) | null>(null);
  const applyVisibilityRef = useRef<(() => void) | null>(null);
  const applyFocusRef = useRef<(() => void) | null>(null);
  const renderRef = useRef<(() => void) | null>(null);
  // The warp-in plays on a fresh mount but not when only the previewed faction
  // changes. Comparing against the previous faction is robust to StrictMode's
  // throwaway first mount (a persistent "played" flag would be consumed by it).
  const prevFactionRef = useRef<string | undefined>(undefined);
  // The camera pose carried across a faction-switch rebuild, so recentring on
  // the new faction's worlds eases instead of snapping.
  const camPoseRef = useRef<{
    pos: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);

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

    const skin = galaxy.theme?.skin ?? "galaxy";
    // Bigger galaxies get a proportionally bigger plane (constant density);
    // the backdrop, nebulae and camera framing all scale with it.
    const extent = playExtentFor(galaxy.nodes.length);
    const positions = layoutNodes(galaxy.nodes, extent);
    // A theatre map is a flat chart: drop the galactic Y jitter.
    if (skin === "theatre") {
      for (const p of positions.values()) p[1] = 0;
    }
    const bounds = playBounds(positions.values());
    const nodeIds = galaxy.nodes.map((n) => n.id);
    const factionColor = new Map(
      galaxy.factions.map((f) => [f.id, new THREE.Color(f.color)]),
    );
    const ownerColor = (owner: string | undefined): THREE.Color =>
      (owner ? factionColor.get(owner) : undefined) ??
      new THREE.Color(NEUTRAL_COLOR);
    // Fog of war: `undefined` visible set means no fog (show everything).
    const isVisible = (id: string): boolean =>
      !visibleRef.current || visibleRef.current.has(id);

    // Graded emphasis: a node's opacity multiplier (1 when not listed / no map).
    const dimOf = (id: string): number =>
      emphasisRef.current?.get(id)?.opacity ?? 1;
    // A lane is only as bright as its dimmer end, so a lane into a faded node
    // fades with it.
    const laneDim = (a: string, b: string): number =>
      Math.min(dimOf(a), dimOf(b));

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

    if (skin === "theatre") buildTheatreBackdrop();
    if (skin === "galaxy") buildGalaxyBackdrop();

    /**
     * Theatre skin: a flat tactical-map plane under the play layer — an
     * authored backdrop image when the theme ships one (local/data refs),
     * else a procedural dark chart (grid + vignette). Used by terrestrial
     * games (e.g. Spring 1944) where a starfield makes no sense.
     */
    function buildTheatreBackdrop() {
      const size = extent * 3.4;
      const planeGeo = new THREE.PlaneGeometry(size, size);
      const planeMat = new THREE.MeshBasicMaterial({
        map: theatreChartTexture(),
        depthWrite: false,
      });
      disposables.push(planeGeo, planeMat);
      if (planeMat.map) disposables.push(planeMat.map);
      const plane = new THREE.Mesh(planeGeo, planeMat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = -1.2;
      plane.raycast = () => {};
      plane.renderOrder = -1;
      scene.add(plane);
      const backdrop = galaxy.theme?.backdrop;
      const url =
        backdrop?.kind === "local"
          ? assetUrl(backdrop.path)
          : backdrop?.kind === "data"
            ? backdrop.dataUri
            : undefined;
      if (url) {
        new THREE.TextureLoader().load(url, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          planeMat.map?.dispose();
          planeMat.map = tex;
          planeMat.needsUpdate = true;
          disposables.push(tex);
          renderRef.current?.();
        });
      }
    }

    function buildGalaxyBackdrop() {
      // The decorative galaxy is far bigger than the playable patch, and the
      // playable stars sit out in its arms rather than at its centre: the disc
      // is centred on a distant galactic core (direction hashed per galaxy)
      // placed well beyond the pan clamp and zoom range — you can look toward
      // the bright core but never reach it.
      const coreAngle =
        ((hashString(`${galaxy.id}-core`) % 360) * Math.PI) / 180;
      const CORE_DIST = extent * 5.5;
      const core: [number, number, number] = [
        Math.cos(coreAngle) * CORE_DIST,
        -42,
        Math.sin(coreAngle) * CORE_DIST,
      ];
      scene.add(
        makeStars(
          performanceMode ? 9000 : 22000,
          extent * 7,
          55,
          0,
          "",
          1.5,
          core,
        ),
      );
      // The core itself: a dense warm cluster plus stacked glow sprites.
      scene.add(
        makeStars(
          performanceMode ? 1200 : 3000,
          65,
          30,
          0,
          "-core",
          1.7,
          core,
          ["#ffe9c9", "#ffd9a0", "#fff4e0"],
        ),
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
          extent * 2.4,
          60,
          -14,
          "-near",
          1.0,
        ),
      );
    }

    // A few soft nebula sprites tint the disc (skipped in performance mode).
    // Runs (`laneFlow`) get a bolder, larger, more numerous swathe so each run's
    // sky reads as its own place; conquest keeps the restrained haze — and,
    // crucially, the non-bold path advances the seeded RNG in the exact same
    // order as before, so conquest's nebula placement is unchanged.
    if (skin === "galaxy" && !performanceMode && effects) {
      const nebulaColors = galaxy.theme?.nebulaColors ?? [
        "#4756b8",
        "#8a4bb8",
        "#2a6f8f",
      ];
      const nebulaRng = mulberry32(hashString(`${galaxy.id}-nebula`));
      const bold = laneFlow;
      const count = bold ? 13 : Math.min(4, nebulaColors.length);
      for (let i = 0; i < count; i++) {
        const color = nebulaColors[i % nebulaColors.length];
        const tex = radialTexture(128, [
          [0, `${color}ff`],
          [0.5, `${color}55`],
          [1, `${color}00`],
        ]);
        // Only call the RNG for opacity in bold mode — else the sequence shifts
        // and conquest's placement changes.
        const opacity = bold ? 0.16 + nebulaRng() * 0.08 : 0.09;
        const mat = new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        disposables.push(tex, mat);
        const sprite = new THREE.Sprite(mat);
        const angle = nebulaRng() * Math.PI * 2 + i;
        // Bold (run) spreads clouds over a much wider disc and depth so the
        // swathe fills the sky rather than hugging the play patch.
        const dist =
          extent * ((bold ? 0.3 : 0.7) + nebulaRng() * (bold ? 3.8 : 1.6));
        sprite.position.set(
          Math.cos(angle) * dist,
          (bold ? 12 : -14) - nebulaRng() * (bold ? 90 : 8),
          Math.sin(angle) * dist,
        );
        const scale =
          extent * ((bold ? 1.8 : 1.2) + nebulaRng() * (bold ? 2.8 : 1.2));
        sprite.scale.set(scale, scale * 0.6, 1);
        sprite.raycast = () => {};
        scene.add(sprite);
        // Depth mood (warpath): clouds toward the warlord (higher world-X, the
        // far column) tint deep red — a cool cloud goes dark-muddy, so it both
        // reddens and darkens as the run nears its end.
        if (depthMood) {
          const moodT = Math.min(
            1,
            Math.max(0, 0.5 + sprite.position.x / extent),
          );
          mat.color.lerp(new THREE.Color("#b81e10"), 0.65 * moodT);
        }
      }
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
    // plus a wide, very faint halo — both with gaussian cross-sections and
    // additive blending, so at any zoom they read as glowing filaments with
    // no hard edges.
    const LANE_CORE_W = 0.55;
    const LANE_HALO_W = 2.0;
    const laneCoreTex = filamentTexture(0.11);
    const laneHaloTex = filamentTexture(0.26);
    disposables.push(laneCoreTex, laneHaloTex);
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
          map: halo ? laneHaloTex : laneCoreTex,
          color: opts.color ?? 0xffffff,
          vertexColors: opts.vertexColors ?? false,
          transparent: true,
          opacity,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
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
    // Vertex-coloured (not a flat material colour) so `emphasis` can dim
    // individual segments; with no emphasis every segment is BASE_LANE_COLOR,
    // byte-identical to the old flat look.
    const lanes = makeLanePair({
      vertexColors: true,
      coreOpacity: 0.5,
      haloOpacity: 0.1,
    });
    const factionLanes = makeLanePair({
      vertexColors: true,
      coreOpacity: 0.75,
      haloOpacity: 0.16,
    });
    // Contested routes: fine warm-gold dashes, NMS plotted-course style. In
    // `laneFlow` (run) mode the same pair is drawn *solid* instead — the run's
    // open lanes are directional travel routes, not a contested battle line.
    const frontier = makeLanePair({
      color: 0xffcf8a,
      coreOpacity: 0.9,
      haloOpacity: 0.1,
    });
    // The path already travelled (`pathLinks`, run mode): a bright green trail
    // so you can always see the route you took.
    const pathTaken = makeLanePair({
      color: 0x46e08a,
      coreOpacity: 0.85,
      haloOpacity: 0.16,
    });

    // Directional route markers (`laneFlow` only): a run's connectors point
    // from where you are to the choices ahead, so travelling chevrons make the
    // direction explicit. A small pool of in-plane arrow quads (they hold a
    // world heading as the camera orbits, unlike billboards), a brightness wave
    // animated over them outward. Under reduce-motion they sit static — still
    // reading as arrows pointing the way.
    const flowEnabled = laneFlow;
    const CHEVRONS_PER_ROUTE = 3;
    const chevTex = flowEnabled ? chevronTexture(64) : undefined;
    const chevGeo = flowEnabled ? new THREE.PlaneGeometry(2.4, 1.7) : undefined;
    if (chevGeo) {
      chevGeo.rotateX(-Math.PI / 2); // lie flat in the galaxy plane
      disposables.push(chevGeo);
    }
    if (chevTex) disposables.push(chevTex);
    interface Chevron {
      mesh: THREE.Mesh;
      mat: THREE.MeshBasicMaterial;
      /** Position along its route, 0 (at you) .. 1 (at the choice). */
      t: number;
    }
    const chevrons: Chevron[] = [];
    // Grow the pool to `n` chevrons (created lazily; hidden ones stay parked).
    const ensureChevrons = (n: number) => {
      while (chevrons.length < n && chevGeo && chevTex) {
        const mat = new THREE.MeshBasicMaterial({
          map: chevTex,
          color: 0xffe6b0,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });
        const mesh = new THREE.Mesh(chevGeo, mat);
        mesh.raycast = () => {};
        mesh.visible = false;
        scene.add(mesh);
        disposables.push(mat);
        chevrons.push({ mesh, mat, t: 0 });
      }
    };
    // Lay chevrons out along the current open routes (called from applyOwners).
    const layoutChevrons = (routes: LaneSeg[]) => {
      if (!flowEnabled) return;
      ensureChevrons(routes.length * CHEVRONS_PER_ROUTE);
      let k = 0;
      for (const [x1, y1, z1, x2, y2, z2] of routes) {
        // The chevron's local +x is world +x; a Y-rotation of θ sends it to
        // (cosθ, 0, -sinθ), so to aim it along (dx, dz) we need θ=atan2(-dz, dx).
        const heading = Math.atan2(-(z2 - z1), x2 - x1);
        for (let c = 0; c < CHEVRONS_PER_ROUTE; c++) {
          // Space them across the middle of the lane, marching toward +choice.
          const t = 0.28 + (c / (CHEVRONS_PER_ROUTE - 1)) * 0.44;
          const chev = chevrons[k++];
          chev.t = t;
          chev.mesh.position.set(
            x1 + (x2 - x1) * t,
            y1 + (y2 - y1) * t + 0.12,
            z1 + (z2 - z1) * t,
          );
          chev.mesh.rotation.y = heading;
          chev.mesh.visible = true;
          chev.mat.opacity = 0.55; // static base; the loop waves it when motion on
        }
      }
      for (; k < chevrons.length; k++) chevrons[k].mesh.visible = false;
    };

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
    const asteroidTex = asteroidTexture(128);
    const cometTailTex = cometTailTexture(256);
    // Warpath identity textures (created only if any node needs one): the wispy
    // anomaly field and a soft annulus (anomaly halo / gas-giant ring / black-hole
    // photon ring). The ring-stations are real 3D geometry, not a texture.
    const anyIdentity = !!identities?.size;
    const anomalyTex = anyIdentity ? anomalyTexture(128) : undefined;
    const bodyRingTex = anyIdentity ? ringBurstTexture(128) : undefined;
    if (anomalyTex) disposables.push(anomalyTex);
    if (bodyRingTex) disposables.push(bodyRingTex);
    // Greeble/panel detail tiled around the ring-stations (diffuse + bump).
    const greebleTex = anyIdentity ? greebleTexture(256) : undefined;
    if (greebleTex) {
      greebleTex.wrapS = THREE.RepeatWrapping;
      greebleTex.wrapT = THREE.RepeatWrapping;
      greebleTex.repeat.set(3, 2);
      disposables.push(greebleTex);
    }
    // Environment map the metal reflects, so it reads as machined metal (glinting
    // on the sunward edges) rather than matte plastic-grey.
    const envTex = anyIdentity ? spaceEnvTexture() : undefined;
    if (envTex) disposables.push(envTex);
    // A raking directional key light + very low ambient so the 3D ring-stations
    // shade hard (a real dark side and terminator, not an evenly-lit balloon).
    // Only lit materials respond; every other object is unlit MeshBasic/Sprite,
    // so conquest and the rest of the map are unchanged. Warpath-only.
    if (anyIdentity) {
      const key = new THREE.DirectionalLight(0xffffff, 2.6);
      key.position.set(-0.85, 0.55, 0.35);
      scene.add(key, new THREE.AmbientLight(0xffffff, 0.14));
    }
    // Comet coma: a bright icy core fading through a soft dusty halo, so it
    // blends into the tail under additive blending (a comet is dust and ice,
    // not rock — no lit surface).
    const cometComaTex = radialTexture(128, [
      [0, "#eaf6ffcc"],
      [0.22, "#cfe6ff70"],
      [0.5, "#a9d4ff20"],
      [1, "#a9d4ff00"],
    ]);
    disposables.push(
      starTex,
      coronaTex,
      spikeTex,
      asteroidTex,
      cometTailTex,
      cometComaTex,
    );

    const coronaSprites: (THREE.Sprite | undefined)[] = [];
    const ownerRingMats: THREE.MeshBasicMaterial[] = [];
    const ownerRings: THREE.Mesh[] = [];
    // Per-node visuals we may need to toggle for fog of war or animate for the
    // intro (all `undefined` for theatre-skin region markers, index-aligned to
    // galaxy.nodes).
    const starSprites: (THREE.Sprite | undefined)[] = [];
    const starMats: (THREE.SpriteMaterial | undefined)[] = [];
    // Sprites for star diffraction spikes; a flat Mesh for comet tails (which
    // must hold a world direction). Both are Object3D, toggled by fog/intro.
    const spikeSprites: (THREE.Object3D | undefined)[] = [];
    // Binary companions: a second, smaller star that orbits its primary.
    interface Companion {
      i: number;
      star: THREE.Sprite;
      corona: THREE.Sprite;
      center: [number, number, number];
      radius: number;
      phase: number;
      /** Pristine opacities, so emphasis can dim then restore exactly. */
      starBase: number;
      coronaBase: number;
    }
    const companions: Companion[] = [];

    // Warpath identity bodies that animate: an anomaly's field slowly rotates and
    // shimmers, a beacon's glow breathes. Driven by the loop when motion is on;
    // static otherwise. Node index carries the emphasis dimming.
    interface IdentityPulse {
      i: number;
      kind: "anomaly" | "beacon";
      sprite: THREE.Sprite;
      mat: THREE.SpriteMaterial;
      baseScale: number;
      baseOpacity: number;
      phase: number;
    }
    const identityPulses: IdentityPulse[] = [];

    // The warlord lair's motion: a black hole's accretion disc shimmers (its
    // billboard material slowly rotates), a hypergiant breathes. Driven by the
    // loop when motion is on.
    interface WarlordAnim {
      i: number;
      /** A billboard disc material whose rotation shimmers (accretion disc). */
      discMat?: THREE.SpriteMaterial;
      discRate?: number;
      /** Sprites that breathe in scale + opacity (hypergiant). */
      pulse?: {
        sprite: THREE.Sprite;
        mat: THREE.SpriteMaterial;
        base: number;
      }[];
    }
    const warlordAnims: WarlordAnim[] = [];

    // Exotic-star motion (shared across both modes): a pulsar twinkles fast, a
    // variable star's glow breathes slowly. Driven by the loop when motion is on.
    const pulsarTwinkles: { i: number; mat: THREE.SpriteMaterial }[] = [];
    const variablePulses: {
      i: number;
      mat: THREE.SpriteMaterial;
      base: number;
    }[] = [];

    // Slowly-spinning 3D structures (the ring-stations): rotating a lit metal ring
    // sweeps its specular highlight around, so it shimmers as metal rather than
    // sitting flat. `base` is the node's fixed orientation; the loop adds time.
    const spinners: { mesh: THREE.Object3D; base: number; rate: number }[] = [];
    // The ring-stations are OPAQUE (so they occlude the stars behind them), which
    // means emphasis can't dim them by opacity — it darkens their metal colour
    // instead. Each entry holds the shared metal colour + its full-bright base.
    const structureDims: {
      i: number;
      color: THREE.Color;
      base: THREE.Color;
    }[] = [];

    // Intro warp-in: sprites pop from zero to their target scale (staggered by
    // node), lanes fade up, and the camera eases in. Only when motion is on.
    const factionOnlyRebuild =
      prevFactionRef.current !== undefined &&
      prevFactionRef.current !== playerFactionId;
    prevFactionRef.current = playerFactionId;
    const animateIntro = !reduceMotion && effects && !factionOnlyRebuild;
    interface IntroSprite {
      sprite: THREE.Object3D;
      target: number;
      delay: number;
    }
    const introSprites: IntroSprite[] = [];
    const introLaneMats: { mat: THREE.Material; target: number }[] = [];
    const registerIntro = (
      sprite: THREE.Object3D,
      target: number,
      id: string,
    ) => {
      if (!animateIntro) {
        sprite.scale.setScalar(target);
        return;
      }
      sprite.scale.setScalar(0);
      introSprites.push({
        sprite,
        target,
        delay: (hashString(`${id}-intro`) % 100) / 100 / 2.5, // 0..0.4
      });
    };

    // Star size = stellar class × role: a red giant capital dwarfs a white
    // dwarf border system, per-node hash keeps the mix stable.
    const nodeSystem = galaxy.nodes.map((n) =>
      starSystemFor(n.id, n.kind === "capital"),
    );
    const nodeType = nodeSystem.map((s) => s.primary);
    const starScale = (i: number) =>
      (galaxy.nodes[i].kind === "capital" ? 4.2 : 3.6) * nodeType[i].size;
    const coronaScale = (i: number, hovered: boolean) => {
      const capital = galaxy.nodes[i].kind === "capital";
      return (capital ? 9 : 7.5) * nodeType[i].size * (hovered ? 1.35 : 1);
    };
    // Ownership rings take each faction's marker shape (circle, hexagon,
    // triangle, pentagon, diamond) — ownership reads by shape as well as
    // colour. Geometries are shared per shape and swapped on capture.
    const ringGeoBySides = new Map<number, THREE.RingGeometry>();
    const ringGeoFor = (sides: number) => {
      let geo = ringGeoBySides.get(sides);
      if (!geo) {
        geo = new THREE.RingGeometry(1.77, 2.08, sides || 48, 1, Math.PI / 2);
        ringGeoBySides.set(sides, geo);
        disposables.push(geo);
      }
      return geo;
    };
    // Theatre skin: flat filled region markers instead of star sprites,
    // tinted a dark shade of the owner colour (kept in styleRing).
    const discMats: (THREE.MeshBasicMaterial | undefined)[] = [];
    const discGeo = new THREE.CircleGeometry(1.35, 32);
    disposables.push(discGeo);

    // Voidwater bodies for the whole galaxy at once, so at least one node is a
    // comet whenever any are space maps (see `voidBodiesFor`).
    const voidBodies = voidBodiesFor(
      galaxy.nodes
        .filter((n) => !!spaceMaps?.has(n.battle.mapName))
        .map((n) => n.id),
    );

    const WHITE = new THREE.Color(0xffffff);

    /**
     * A built structure (depot ring-station, warlord fortress) as *real 3D
     * geometry*, not a sprite: an OPAQUE metal ring-station — a ring of discrete
     * habitat modules (not a smooth torus), structural spokes to a central
     * drum-and-dome hub, and two solar-panel wings — lit by the scene's key light
     * with a specular sheen so
     * it reads as machined metal, and spun slowly so the highlight sweeps around
     * it. Opaque so it occludes the stars behind it. The ring (with all parts as
     * children sharing its metal) takes the spike slot; a soft glow sits in the
     * corona slot; the star slot stays empty. Emphasis dims it by darkening the
     * metal colour (see `structureDims`), since an opaque mesh can't fade by
     * opacity.
     */
    const buildStructureBody = (
      i: number,
      node: GalaxyNode,
      p: WorldPos,
      opts: {
        scale: number;
        tint: string;
        glowColor: string;
        glowOpacity: number;
        glowScale: number;
      },
    ): boolean => {
      // OPAQUE so it occludes the stars behind it (a transparent mesh can't cull
      // the additive starfield already drawn behind it). Greeble diffuse + bump so
      // the surface is busy machined metal; a tighter specular catches the relief.
      const metal = new THREE.MeshPhongMaterial({
        color: new THREE.Color(opts.tint),
        map: greebleTex,
        bumpMap: greebleTex,
        bumpScale: 0.35,
        specular: new THREE.Color(0xdfe3ea),
        shininess: 70,
        envMap: envTex,
        reflectivity: 0.42,
        combine: THREE.MixOperation,
      });
      // Opaque ring can't dim by opacity, so emphasis darkens its colour instead.
      structureDims.push({ i, color: metal.color, base: metal.color.clone() });
      // Dark, glossy solar-panel material (reflects the env too).
      const panelMat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(0x223052),
        specular: new THREE.Color(0x90a0c0),
        shininess: 90,
        envMap: envTex,
        reflectivity: 0.4,
      });
      disposables.push(metal, panelMat);

      // A darker material for mechanical detail (hub, docking caps, tanks, spine).
      const coreMat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(0x6b6f78),
        map: greebleTex,
        bumpMap: greebleTex,
        bumpScale: 0.3,
        specular: new THREE.Color(0xaab0bc),
        shininess: 65,
        envMap: envTex,
        reflectivity: 0.35,
        combine: THREE.MixOperation,
      });
      disposables.push(coreMat);

      // The station is a detailed ring of habitat modules connected by docking
      // tubes (Interstellar's Endurance) around a stepped central spine. Each
      // module is a multi-part assembly; to keep a busy station cheap, every part
      // is baked (cloned, transformed into station space) into three merged
      // meshes — one per material — so the whole thing is only a few draw calls.
      const station = new THREE.Group();
      const RING_R = 0.52;
      const MODULES = 12;
      const metalParts: THREE.BufferGeometry[] = [];
      const coreParts: THREE.BufferGeometry[] = [];
      const panelParts: THREE.BufferGeometry[] = [];
      const partM = new THREE.Matrix4();
      const partLocal = new THREE.Matrix4();
      const partQ = new THREE.Quaternion();
      const partE = new THREE.Euler();
      const partP = new THREE.Vector3();
      const partS = new THREE.Vector3();
      // Bake `geo` (non-indexed clone) into `arr`, at parent matrix `pm` then a
      // local translate / Y-rotate / uniform-ish scale.
      const part = (
        arr: THREE.BufferGeometry[],
        geo: THREE.BufferGeometry,
        pm: THREE.Matrix4,
        px: number,
        py: number,
        pz: number,
        ry = 0,
        sx = 1,
        sy = 1,
        sz = 1,
      ) => {
        partE.set(0, ry, 0);
        partQ.setFromEuler(partE);
        partLocal.compose(partP.set(px, py, pz), partQ, partS.set(sx, sy, sz));
        partM.multiplyMatrices(pm, partLocal);
        // A fresh, non-indexed copy every time (never mutate the shared base):
        // toNonIndexed clones an indexed geo; clone() copies an already-unindexed
        // one. Uniform non-indexing lets mergeGeometries combine them.
        const g = geo.index ? geo.toNonIndexed() : geo.clone();
        g.applyMatrix4(partM);
        arr.push(g);
      };

      // Reusable base part geometries (cloned per placement, disposed at the end).
      const bodyGeo = new RoundedBoxGeometry(0.19, 0.16, 0.26, 3, 0.04);
      const deckGeo = new RoundedBoxGeometry(0.12, 0.08, 0.2, 2, 0.03);
      const capGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.07, 12);
      capGeo.rotateX(Math.PI / 2); // axis along Z (tangential)
      const tankGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.11, 8);
      const antGeo = new THREE.BoxGeometry(0.012, 0.14, 0.012);
      const spanelGeo = new RoundedBoxGeometry(0.18, 0.014, 0.13, 1, 0.012);
      const strutGeo = new THREE.BoxGeometry(0.06, 0.025, 0.025);

      const modMat = new THREE.Matrix4();
      const modQ = new THREE.Quaternion();
      const modE = new THREE.Euler();
      const modP = new THREE.Vector3();
      const modS = new THREE.Vector3();
      for (let s = 0; s < MODULES; s++) {
        const a = (s / MODULES) * Math.PI * 2;
        const j = (hashString(`${node.id}-mod${s}`) % 100) / 100;
        modE.set(0, a, 0);
        modQ.setFromEuler(modE);
        modMat.compose(
          modP.set(Math.cos(a) * RING_R, 0, Math.sin(a) * RING_R),
          modQ,
          modS.set(1, 0.9 + 0.22 * j, 1),
        );
        // Main hull + a raised deck.
        part(metalParts, bodyGeo, modMat, 0, 0, 0);
        part(metalParts, deckGeo, modMat, 0, 0.09, 0.01);
        // Docking caps at both tangential ends.
        part(coreParts, capGeo, modMat, 0, 0, 0.15);
        part(coreParts, capGeo, modMat, 0, 0, -0.15);
        // Tanks + an antenna mast on top.
        part(coreParts, tankGeo, modMat, 0.055, 0.085, -0.05);
        part(coreParts, tankGeo, modMat, -0.05, 0.08, 0.055, 0, 0.8, 0.8, 0.8);
        part(coreParts, antGeo, modMat, 0.02, 0.16, 0.07);
        // Solar array on every third module (radially outward on a short strut).
        if (s % 3 === 1) {
          part(coreParts, strutGeo, modMat, 0.15, 0, 0);
          part(panelParts, spanelGeo, modMat, 0.27, 0, 0);
        }
        // A stretched docking tube bridging to the next module.
        const am = ((s + 0.5) / MODULES) * Math.PI * 2;
        modE.set(0, am, 0);
        modQ.setFromEuler(modE);
        modMat.compose(
          modP.set(Math.cos(am) * RING_R, 0, Math.sin(am) * RING_R),
          modQ,
          modS.set(1, 1, 1),
        );
        part(coreParts, capGeo, modMat, 0, 0, 0, 0, 0.9, 0.9, 1.7);
      }

      // Central hub: a stepped docking spine on a drum, with four arms to the ring.
      const hubMat = new THREE.Matrix4();
      const drumGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.13, 16);
      const spine1 = new THREE.CylinderGeometry(0.07, 0.09, 0.1, 12);
      const spine2 = new THREE.CylinderGeometry(0.045, 0.06, 0.09, 12);
      const spine3 = new THREE.CylinderGeometry(0.028, 0.04, 0.07, 10);
      const hubArm = new THREE.BoxGeometry(0.34, 0.045, 0.05);
      hubArm.translate(0.34, 0, 0);
      part(coreParts, drumGeo, hubMat, 0, 0, 0);
      part(coreParts, spine1, hubMat, 0, 0.1, 0);
      part(coreParts, spine2, hubMat, 0, 0.19, 0);
      part(coreParts, spine3, hubMat, 0, 0.27, 0);
      for (let s = 0; s < 4; s++) {
        part(metalParts, hubArm, hubMat, 0, 0, 0, (s / 4) * Math.PI * 2 + 0.4);
      }

      // Merge each material's parts into one mesh (a busy station = 3 draw calls).
      const addMerged = (
        parts: THREE.BufferGeometry[],
        mat: THREE.Material,
      ) => {
        const merged = parts.length ? mergeGeometries(parts, false) : null;
        for (const g of parts) g.dispose();
        if (!merged) return;
        disposables.push(merged);
        const mesh = new THREE.Mesh(merged, mat);
        mesh.raycast = () => {};
        station.add(mesh);
      };
      addMerged(metalParts, metal);
      addMerged(coreParts, coreMat);
      addMerged(panelParts, panelMat);
      for (const g of [
        bodyGeo,
        deckGeo,
        capGeo,
        tankGeo,
        antGeo,
        spanelGeo,
        strutGeo,
        drumGeo,
        spine1,
        spine2,
        spine3,
        hubArm,
      ]) {
        g.dispose();
      }
      // One warm light spec on the ring — no window detail at this distance.
      const specMat = new THREE.SpriteMaterial({
        map: coronaTex,
        color: new THREE.Color(opts.glowColor),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const spec = new THREE.Sprite(specMat);
      spec.scale.setScalar(0.2);
      spec.position.set(0.5, 0.1, 0);
      spec.raycast = () => {};
      station.add(spec);
      disposables.push(specMat);

      station.position.set(p[0], p[1] + 0.1, p[2]);
      const base = ((hashString(`${node.id}-rot`) % 100) / 100) * Math.PI * 2;
      station.rotation.y = base;
      registerIntro(station, starScale(i) * opts.scale, node.id);
      scene.add(station);
      spinners.push({ mesh: station, base, rate: 1 / 6000 });

      const glowMat = new THREE.SpriteMaterial({
        map: coronaTex,
        color: new THREE.Color(opts.glowColor),
        transparent: true,
        opacity: opts.glowOpacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow = new THREE.Sprite(glowMat);
      glow.position.set(p[0], p[1], p[2]);
      registerIntro(
        glow,
        coronaScale(i, false) * opts.glowScale,
        `${node.id}-corona`,
      );
      glow.raycast = () => {};

      const ownRingMat = new THREE.MeshBasicMaterial({
        color: ownerColor(ownersRef.current[node.id] ?? node.owner),
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ownRing = new THREE.Mesh(ringGeoFor(0), ownRingMat);
      ownRing.rotation.x = -Math.PI / 2;
      ownRing.position.set(p[0], p[1] - 0.4, p[2]);
      ownRing.raycast = () => {};

      starSprites.push(undefined);
      starMats.push(undefined);
      spikeSprites.push(station);
      coronaSprites.push(glow);
      ownerRingMats.push(ownRingMat);
      ownerRings.push(ownRing);
      disposables.push(glowMat, ownRingMat);
      scene.add(glow, ownRing);
      return true;
    };

    /**
     * Build the warlord's lair — the run's final node — in one of three per-run
     * forms: a stylised black hole (dark core + a flat accretion disc that
     * foreshortens into an ellipse, plus a gravitational glow; no lensing), a
     * blood-red hypergiant (hot core, violent corona + spikes, slow breathing),
     * or an armoured fortress station (metal hub + a spinning defensive ring).
     * Reuses the star / corona / spike slots like the other bodies. Built once
     * (a single boss node), so its bespoke textures live here, not in the shared
     * block. Returns `true` — always handles the warlord kinds.
     */
    const buildWarlordBody = (
      i: number,
      node: GalaxyNode,
      p: WorldPos,
      variant: NodeBodyKind,
    ): boolean => {
      // A fortress is a built structure, not a star — the flat foreshortened
      // ring-station at large scale with an armoured red wash and a hot glow.
      if (variant === "warlord-fortress") {
        return buildStructureBody(i, node, p, {
          scale: 1.0,
          tint: "#c07a6a",
          glowColor: "#ff7a4a",
          glowOpacity: 0.4,
          glowScale: 0.6,
        });
      }

      const base = starScale(i);
      const anim: WarlordAnim = { i };
      let head: THREE.Sprite;
      let headMat: THREE.SpriteMaterial;
      let glowMat: THREE.SpriteMaterial;
      let extra: THREE.Object3D | undefined;

      if (variant === "warlord-blackhole") {
        // A solid black event horizon that occludes the sky, ringed by a bright
        // accretion disc laid flat (so it foreshortens to an ellipse). The outer
        // glow is kept small so it rims the disc instead of washing it into a
        // fuzzy orange star.
        const coreTex = radialTexture(128, [
          [0, "#000000ff"],
          [0.62, "#000000ff"],
          [0.85, "#0a0603f2"],
          [1, "#00000000"],
        ]);
        disposables.push(coreTex);
        headMat = new THREE.SpriteMaterial({
          map: coreTex,
          color: 0xffffff,
          transparent: true,
          opacity: 1,
          depthWrite: false,
        });
        head = new THREE.Sprite(headMat);
        head.position.set(p[0], p[1], p[2]);
        registerIntro(head, base * 0.5, node.id);
        head.raycast = () => {};
        // Accretion disc: a BILLBOARD (not a flat plane). A flat plane looked
        // wrong from the side and split into two side patches behind the core; a
        // billboard reads as the same disc from every angle and its radial fade
        // always stays inside the sprite (no square cut-offs). It shimmers by
        // slowly rotating its material (the texture has a faint angular flow).
        const discTex = accretionTexture(256);
        const discMat = new THREE.SpriteMaterial({
          map: discTex,
          transparent: true,
          opacity: 1,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        disposables.push(discTex, discMat);
        const disc = new THREE.Sprite(discMat);
        disc.position.set(p[0], p[1], p[2]);
        registerIntro(disc, base * 1.4, `${node.id}-disc`);
        disc.raycast = () => {};
        scene.add(disc);
        extra = disc;
        anim.discMat = discMat;
        anim.discRate = 0.00018;
        // Photon ring: a bright thin ring hugging the event horizon. Billboarded,
        // so it stays a circle around the dark sphere from any angle — the lensed
        // bright-rim look from Interstellar, without real lensing.
        if (bodyRingTex) {
          const photonMat = new THREE.SpriteMaterial({
            map: bodyRingTex,
            color: new THREE.Color("#ffe6b0"),
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const photon = new THREE.Sprite(photonMat);
          photon.position.set(p[0], p[1] + 0.02, p[2]);
          registerIntro(photon, base * 0.78, `${node.id}-photon`);
          photon.raycast = () => {};
          disposables.push(photonMat);
          scene.add(photon);
        }
        glowMat = new THREE.SpriteMaterial({
          map: coronaTex,
          color: new THREE.Color("#ff7a2a"),
          transparent: true,
          opacity: 0.32,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
      } else {
        // Hypergiant: a hot, swollen red star with violent spikes.
        const red = new THREE.Color("#ff3a1e");
        headMat = new THREE.SpriteMaterial({
          map: starTex,
          color: red.clone().lerp(WHITE, 0.3),
          transparent: true,
          opacity: 1,
          depthWrite: false,
        });
        head = new THREE.Sprite(headMat);
        head.position.set(p[0], p[1], p[2]);
        registerIntro(head, base * 1.2, node.id);
        head.raycast = () => {};
        const spikeMat = new THREE.SpriteMaterial({
          map: spikeTex,
          color: red.clone().lerp(WHITE, 0.35),
          transparent: true,
          opacity: 0.32,
          rotation: ((hashString(`${node.id}-spin`) % 100) / 100 - 0.5) * 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const spikes = new THREE.Sprite(spikeMat);
        spikes.position.set(p[0], p[1], p[2]);
        registerIntro(spikes, base * 2.2, `${node.id}-spike`);
        spikes.raycast = () => {};
        disposables.push(spikeMat);
        scene.add(spikes);
        extra = spikes;
        glowMat = new THREE.SpriteMaterial({
          map: coronaTex,
          color: red,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
      }

      const glow = new THREE.Sprite(glowMat);
      glow.position.set(p[0], p[1], p[2]);
      // The black hole's glow is small so it rims the disc; the hypergiant's is
      // broad so it reads as a swollen star.
      const glowScale =
        coronaScale(i, false) * (variant === "warlord-blackhole" ? 0.42 : 1.4);
      registerIntro(glow, glowScale, `${node.id}-corona`);
      glow.raycast = () => {};

      // A hypergiant breathes (scale only — opacity stays owned by fog/emphasis).
      if (variant === "warlord-hypergiant") {
        anim.pulse = [
          { sprite: head, mat: headMat, base: base * 1.2 },
          { sprite: glow, mat: glowMat, base: glowScale },
        ];
      }
      if (anim.discMat || anim.pulse) warlordAnims.push(anim);

      const ownRingMat = new THREE.MeshBasicMaterial({
        color: ownerColor(ownersRef.current[node.id] ?? node.owner),
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ownRing = new THREE.Mesh(ringGeoFor(0), ownRingMat);
      ownRing.rotation.x = -Math.PI / 2;
      ownRing.position.set(p[0], p[1] - 0.4, p[2]);
      ownRing.raycast = () => {};
      starSprites.push(head);
      starMats.push(headMat);
      spikeSprites.push(extra);
      coronaSprites.push(glow);
      ownerRingMats.push(ownRingMat);
      ownerRings.push(ownRing);
      disposables.push(headMat, glowMat, ownRingMat);
      scene.add(head, glow, ownRing);
      return true;
    };

    /**
     * Build a warpath identity body for node `i`, reusing the star / corona /
     * spike slots (like the void branch) so intro, ownership rings, selection and
     * fog keep working. Cohesive palette: a station is metallic with a depot-teal
     * running-light, a wreck sooty carbon with a dim distress ember, an anomaly an
     * eerie violet phenomenon, a beacon a friendly cyan pulse. Returns `false` for
     * a kind it doesn't build (warlord lairs — handled elsewhere) so the caller
     * falls through to a normal star. Never runs for theatre / void nodes.
     */
    const buildIdentityBody = (
      i: number,
      node: GalaxyNode,
      p: WorldPos,
      body: NodeBodyKind,
    ): boolean => {
      if (body.startsWith("warlord")) return buildWarlordBody(i, node, p, body);
      // A depot is a built structure: a flat, foreshortened ring-station, not a
      // billboarded body (which read as a logo).
      if (body === "station") {
        return buildStructureBody(i, node, p, {
          scale: 0.63,
          tint: "#cfd3da",
          glowColor: "#7fe08a",
          glowOpacity: 0.22,
          glowScale: 0.45,
        });
      }
      // Per-kind recipe. `head` is the body in the star slot, `glow` a soft halo
      // in the corona slot. No clean rings — a tidy annulus read as HUD; identity
      // instead comes from a lit/organic body plus the existing type ring. All
      // colours stay within the grounded palette.
      type Recipe = {
        head: { tex: THREE.Texture; color: string; additive?: boolean };
        headScale: number;
        glow: { color: string; opacity: number; scale: number };
        pulse?: "anomaly" | "beacon";
      };
      let recipe: Recipe | undefined;
      if (body === "wreck") {
        recipe = {
          head: { tex: asteroidTex, color: "#4a453e" },
          headScale: 0.9,
          glow: { color: "#8a3320", opacity: 0.35, scale: 0.6 },
        };
      } else if (body === "anomaly" && anomalyTex) {
        // A wispy, irregular energy field (not a star, not a ring); it shimmers
        // via a slow rotation and brightness breathe in the loop.
        recipe = {
          head: { tex: anomalyTex, color: "#b98cff", additive: true },
          headScale: 1.25,
          glow: { color: "#8f5cff", opacity: 0.5, scale: 1.0 },
          pulse: "anomaly",
        };
      } else if (body === "beacon") {
        // A friendly bright point whose halo breathes — no ping ring.
        recipe = {
          head: { tex: starTex, color: "#d6fff8" },
          headScale: 0.9,
          glow: { color: "#4fe6d6", opacity: 0.55, scale: 1.2 },
          pulse: "beacon",
        };
      }
      if (!recipe) return false;

      const headMat = new THREE.SpriteMaterial({
        map: recipe.head.tex,
        color: new THREE.Color(recipe.head.color),
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: recipe.head.additive
          ? THREE.AdditiveBlending
          : THREE.NormalBlending,
        // A wreck reuses the lit asteroid; spin it per node so no two align.
        rotation:
          body === "wreck"
            ? ((hashString(`${node.id}-rock`) % 100) / 100) * Math.PI * 2
            : 0,
      });
      const head = new THREE.Sprite(headMat);
      head.position.set(p[0], p[1], p[2]);
      const headScale = starScale(i) * recipe.headScale;
      registerIntro(head, headScale, node.id);
      head.raycast = () => {};

      const glowMat = new THREE.SpriteMaterial({
        map: coronaTex,
        color: new THREE.Color(recipe.glow.color),
        transparent: true,
        opacity: recipe.glow.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow = new THREE.Sprite(glowMat);
      glow.position.set(p[0], p[1], p[2]);
      const glowScale = coronaScale(i, false) * recipe.glow.scale;
      registerIntro(glow, glowScale, `${node.id}-corona`);
      glow.raycast = () => {};

      // The anomaly shimmers (rotate + breathe the field); the beacon's halo
      // breathes. Both loop-driven; static under reduce-motion.
      const phase = (hashString(`${node.id}-idpulse`) % 100) / 100;
      if (recipe.pulse === "anomaly") {
        identityPulses.push({
          i,
          kind: "anomaly",
          sprite: head,
          mat: headMat,
          baseScale: headScale,
          baseOpacity: 1,
          phase,
        });
      } else if (recipe.pulse === "beacon") {
        identityPulses.push({
          i,
          kind: "beacon",
          sprite: glow,
          mat: glowMat,
          baseScale: glowScale,
          baseOpacity: recipe.glow.opacity,
          phase,
        });
      }

      const ringMat = new THREE.MeshBasicMaterial({
        color: ownerColor(ownersRef.current[node.id] ?? node.owner),
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeoFor(0), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p[0], p[1] - 0.4, p[2]);
      ring.raycast = () => {};
      starSprites.push(head);
      starMats.push(headMat);
      spikeSprites.push(undefined);
      coronaSprites.push(glow);
      ownerRingMats.push(ringMat);
      ownerRings.push(ring);
      disposables.push(headMat, glowMat, ringMat);
      scene.add(head, glow, ring);
      return true;
    };

    // Exotic textures are shared across both modes and created lazily on first
    // use (conquest has no identity ring, so it can't borrow `bodyRingTex`).
    let gasGiantTex: THREE.Texture | undefined;
    let exoticRingTex: THREE.Texture | undefined;
    const getGasGiantTex = () => {
      if (!gasGiantTex) {
        gasGiantTex = gasGiantTexture(128);
        disposables.push(gasGiantTex);
      }
      return gasGiantTex;
    };
    const getExoticRing = () => {
      if (bodyRingTex) return bodyRingTex;
      if (!exoticRingTex) {
        exoticRingTex = ringBurstTexture(128);
        disposables.push(exoticRingTex);
      }
      return exoticRingTex;
    };

    /**
     * Build a full-replacement exotic body (pulsar or ringed gas giant) in the
     * star / corona / spike slots. The pulsar is a tiny blue-white core with
     * bright beamed spikes and a fast twinkle; the gas giant a warm banded globe
     * with a flat ring quad that foreshortens into an ellipse. Variable and carbon
     * stars stay ordinary stars (handled in the normal branch) so they keep the
     * corona/binary machinery. Returns `true` when it builds.
     */
    const buildExoticBody = (
      i: number,
      node: GalaxyNode,
      p: WorldPos,
      exotic: ExoticClass,
    ): boolean => {
      const base = starScale(i);
      let head: THREE.Sprite;
      let headMat: THREE.SpriteMaterial;
      let glowMat: THREE.SpriteMaterial;
      let extra: THREE.Object3D | undefined;

      if (exotic === "pulsar") {
        const blue = new THREE.Color("#cfe4ff");
        headMat = new THREE.SpriteMaterial({
          map: starTex,
          color: blue.clone().lerp(WHITE, 0.55),
          transparent: true,
          opacity: 1,
          depthWrite: false,
        });
        head = new THREE.Sprite(headMat);
        head.position.set(p[0], p[1], p[2]);
        registerIntro(head, base * 0.55, node.id);
        head.raycast = () => {};
        // Bright beamed spikes — the pulsar's lighthouse look.
        const spikeMat = new THREE.SpriteMaterial({
          map: spikeTex,
          color: blue.clone().lerp(WHITE, 0.5),
          transparent: true,
          opacity: 0.42,
          rotation: ((hashString(`${node.id}-spin`) % 100) / 100 - 0.5) * 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const spikes = new THREE.Sprite(spikeMat);
        spikes.position.set(p[0], p[1], p[2]);
        registerIntro(spikes, base * 2.3, `${node.id}-spike`);
        spikes.raycast = () => {};
        disposables.push(spikeMat);
        scene.add(spikes);
        extra = spikes;
        glowMat = new THREE.SpriteMaterial({
          map: coronaTex,
          color: blue,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        pulsarTwinkles.push({ i, mat: headMat });
      } else {
        // Ringed gas giant: a lit globe (normal blending) plus a flat ring.
        headMat = new THREE.SpriteMaterial({
          map: getGasGiantTex(),
          color: new THREE.Color("#d8b488"),
          transparent: true,
          opacity: 1,
          depthWrite: false,
          rotation: ((hashString(`${node.id}-rock`) % 100) / 100) * Math.PI * 2,
        });
        head = new THREE.Sprite(headMat);
        head.position.set(p[0], p[1], p[2]);
        registerIntro(head, base * 1.0, node.id);
        head.raycast = () => {};
        const ringMat = new THREE.SpriteMaterial({
          map: getExoticRing(),
          color: new THREE.Color("#e8d0a8"),
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const ring = new THREE.Sprite(ringMat);
        ring.position.set(p[0], p[1] + 0.1, p[2]);
        registerIntro(ring, base * 1.9, `${node.id}-pring`);
        ring.raycast = () => {};
        disposables.push(ringMat);
        scene.add(ring);
        extra = ring;
        // A thin warm atmosphere haze rather than a stellar corona.
        glowMat = new THREE.SpriteMaterial({
          map: coronaTex,
          color: new THREE.Color("#c8a878"),
          transparent: true,
          opacity: 0.2,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
      }

      const glow = new THREE.Sprite(glowMat);
      glow.position.set(p[0], p[1], p[2]);
      registerIntro(
        glow,
        coronaScale(i, false) * (exotic === "pulsar" ? 0.8 : 0.5),
        `${node.id}-corona`,
      );
      glow.raycast = () => {};

      const ownRingMat = new THREE.MeshBasicMaterial({
        color: ownerColor(ownersRef.current[node.id] ?? node.owner),
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ownRing = new THREE.Mesh(ringGeoFor(0), ownRingMat);
      ownRing.rotation.x = -Math.PI / 2;
      ownRing.position.set(p[0], p[1] - 0.4, p[2]);
      ownRing.raycast = () => {};
      starSprites.push(head);
      starMats.push(headMat);
      spikeSprites.push(extra);
      coronaSprites.push(glow);
      ownerRingMats.push(ownRingMat);
      ownerRings.push(ownRing);
      disposables.push(headMat, glowMat, ownRingMat);
      scene.add(head, glow, ownRing);
      return true;
    };

    galaxy.nodes.forEach((n, i) => {
      const p = positions.get(n.id);
      if (!p) {
        starSprites.push(undefined);
        starMats.push(undefined);
        spikeSprites.push(undefined);
        coronaSprites.push(undefined);
        discMats.push(undefined);
        return;
      }
      if (skin === "theatre") {
        const discMat = new THREE.MeshBasicMaterial({
          color: 0x2a3242,
          depthWrite: false,
        });
        const disc = new THREE.Mesh(discGeo, discMat);
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(p[0], p[1] - 0.2, p[2]);
        disc.scale.setScalar(n.kind === "capital" ? 1.25 : 1);
        disc.raycast = () => {};
        disposables.push(discMat);
        scene.add(disc);
        discMats.push(discMat);
        starSprites.push(undefined);
        starMats.push(undefined);
        spikeSprites.push(undefined);
        coronaSprites.push(undefined);
        return;
      }
      discMats.push(undefined);
      // Warpath node-identity: a run node may read as a built/void body (station,
      // wreck, anomaly, beacon) rather than a star. Takes precedence over the
      // voidwater asteroid and reuses the same slots. A `starTint`-only identity
      // (battle danger red) keeps the star and is applied in the normal branch.
      const identity = identities?.get(n.id);
      if (identity?.body && buildIdentityBody(i, n, p, identity.body)) return;
      // Space maps (voidwater) read as asteroid fields, not star systems — a
      // rare comet variant gets a trailing tail. Reuses the star/corona/spike
      // slots so intro, ownership rings and selection keep working; skips the
      // binary companion. See `./bodies` for the pure asteroid/comet split.
      const isVoid = !!spaceMaps?.has(n.battle.mapName);
      // Rare exotic star (shared with conquest): pulsar / gas giant fully replace
      // the star; variable / carbon tweak the ordinary star below. Never for
      // capitals (they read as important giants) or void asteroid fields.
      const exotic =
        n.kind === "capital" || isVoid ? undefined : exoticClassFor(n.id);
      if (
        (exotic === "pulsar" || exotic === "gasgiant") &&
        buildExoticBody(i, n, p, exotic)
      ) {
        return;
      }
      if (isVoid) {
        const body = voidBodies.get(n.id) ?? "asteroid";
        const isComet = body === "comet";
        // Asteroids come in two flavours (cf. the metallic/carbonic references):
        // a neutral metallic grey and a darker carbonic stone, by per-node hash.
        const carbonic = hashString(`${n.id}-carbon`) % 3 === 0;
        const rockColor = new THREE.Color(carbonic ? "#5d5b58" : "#a9adb2");
        // Head sprite: a lit rock for asteroids, an additive icy coma for comets
        // (a comet is dust and ice, so it glows rather than catching light).
        const starMat = new THREE.SpriteMaterial(
          isComet
            ? {
                map: cometComaTex,
                color: new THREE.Color("#dff1ff"),
                transparent: true,
                opacity: 0.55,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
              }
            : {
                map: asteroidTex,
                color: rockColor,
                transparent: true,
                opacity: 1,
                depthWrite: false,
                rotation:
                  ((hashString(`${n.id}-rock`) % 100) / 100) * Math.PI * 2,
              },
        );
        const star = new THREE.Sprite(starMat);
        star.position.set(p[0], p[1], p[2]);
        registerIntro(star, starScale(i) * (isComet ? 1.05 : 0.95), n.id);
        star.raycast = () => {};
        // Dust: a faint halo around an asteroid; a brighter icy aura around a
        // comet head that blends into its tail.
        const coronaMat = new THREE.SpriteMaterial({
          map: coronaTex,
          color: new THREE.Color(isComet ? "#a9d8ff" : "#4a5468"),
          transparent: true,
          opacity: isComet ? 0.5 : 0.28,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const corona = new THREE.Sprite(coronaMat);
        corona.position.set(p[0], p[1], p[2]);
        registerIntro(
          corona,
          coronaScale(i, false) * (isComet ? 1.0 : 0.6),
          `${n.id}-corona`,
        );
        corona.raycast = () => {};
        // Comet: a long thin tail streaking away from the head at a per-node
        // angle. Kept in the spike slot so nothing else in the loop needs a new
        // array.
        let spikes: THREE.Object3D | undefined;
        if (isComet) {
          const tailMat = new THREE.MeshBasicMaterial({
            map: cometTailTex,
            color: new THREE.Color("#cfe8ff"),
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          // A flat quad in the galaxy plane (like lanes/rings), not a billboard
          // sprite — so the tail keeps a fixed world direction as the camera
          // orbits. Unit length with the head (texture u≈0) at the local origin,
          // so it grows from the coma under the intro's uniform scale.
          const tailGeo = new THREE.PlaneGeometry(1, 0.55);
          tailGeo.translate(0.5, 0, 0); // head at origin, tip toward +x
          tailGeo.rotateX(-Math.PI / 2); // lie flat in the XZ plane
          const tail = new THREE.Mesh(tailGeo, tailMat);
          tail.position.set(p[0], p[1], p[2]);
          tail.rotation.y =
            ((hashString(`${n.id}-tail`) % 100) / 100) * Math.PI * 2;
          tail.raycast = () => {};
          registerIntro(tail, starScale(i) * 3.8, `${n.id}-tail`);
          disposables.push(tailMat, tailGeo);
          scene.add(tail);
          spikes = tail;
        }
        const ringMat = new THREE.MeshBasicMaterial({
          color: ownerColor(ownersRef.current[n.id] ?? n.owner),
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeoFor(0), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(p[0], p[1] - 0.4, p[2]);
        ring.raycast = () => {};
        starSprites.push(star);
        starMats.push(starMat);
        spikeSprites.push(spikes);
        coronaSprites.push(corona);
        ownerRingMats.push(ringMat);
        ownerRings.push(ring);
        disposables.push(starMat, coronaMat, ringMat);
        scene.add(star, corona, ring);
        return;
      }
      const type = nodeType[i];
      const stellar = new THREE.Color(type.color);
      // Danger tint (battle/elite): pull the star toward a hot red so the site
      // reads as hostile while staying a plausible star colour. The corona and
      // spikes below inherit `stellar`, so the whole system reddens together.
      if (identity?.starTint) {
        stellar.lerp(new THREE.Color(identity.starTint), 0.55);
      }
      // Carbon (dying) star: a deep, sooty red. A variable star keeps its class
      // colour but its glow breathes (registered after the corona is built).
      if (exotic === "carbon") stellar.set("#c81e08");
      // Normal blending (not additive): the hot core is near-opaque, so the
      // decorative starfield behind a node can't shine through it. Dwarfs
      // keep their saturation; hot stars blow out toward white (type.tint).
      const starMat = new THREE.SpriteMaterial({
        map: starTex,
        color: stellar.clone().lerp(WHITE, type.tint),
        transparent: true,
        opacity: 1,
        depthWrite: false,
      });
      const star = new THREE.Sprite(starMat);
      star.position.set(p[0], p[1], p[2]);
      registerIntro(star, starScale(i), n.id);
      star.raycast = () => {};
      // Diffraction spikes only on the brilliant giants (a whole map of
      // four-point flares read as uniform); each rotated slightly so no two
      // look stamped from the same die.
      let spikes: THREE.Sprite | undefined;
      if (type.glow >= 1.2) {
        const spikeMat = new THREE.SpriteMaterial({
          map: spikeTex,
          color: stellar.clone().lerp(WHITE, 0.4),
          transparent: true,
          opacity: 0.22,
          rotation: ((hashString(`${n.id}-spin`) % 100) / 100 - 0.5) * 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        spikes = new THREE.Sprite(spikeMat);
        spikes.position.set(p[0], p[1], p[2]);
        registerIntro(spikes, starScale(i) * 1.7, `${n.id}-spike`);
        spikes.raycast = () => {};
        disposables.push(spikeMat);
        scene.add(spikes);
      }
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
      registerIntro(corona, coronaScale(i, false), `${n.id}-corona`);
      corona.raycast = () => {};
      if (exotic === "variable") {
        variablePulses.push({ i, mat: coronaMat, base: coronaMat.opacity });
      }
      // Ownership lives on the ring alone (saturated faction colour).
      const ringMat = new THREE.MeshBasicMaterial({
        color: ownerColor(ownersRef.current[n.id] ?? n.owner),
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeoFor(0), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p[0], p[1] - 0.4, p[2]);
      ring.raycast = () => {};
      starSprites.push(star);
      starMats.push(starMat);
      spikeSprites.push(spikes);
      coronaSprites.push(corona);
      ownerRingMats.push(ringMat);
      ownerRings.push(ring);
      disposables.push(starMat, coronaMat, ringMat);
      scene.add(star, corona, ring);

      // Binary companion: a smaller, dimmer partner star that orbits the
      // primary (position animated in the loop; static offset when motion off).
      const companion = nodeSystem[i].companion;
      if (companion) {
        const compColor = new THREE.Color(companion.color);
        const compStarMat = new THREE.SpriteMaterial({
          map: starTex,
          color: compColor.clone().lerp(WHITE, companion.tint),
          transparent: true,
          opacity: 1,
          depthWrite: false,
        });
        const compCoronaMat = new THREE.SpriteMaterial({
          map: coronaTex,
          color: compColor,
          transparent: true,
          opacity: Math.min(0.7, 0.4 * companion.glow),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const compStar = new THREE.Sprite(compStarMat);
        const compCorona = new THREE.Sprite(compCoronaMat);
        // Tight orbits that scale gently with the primary — never far enough
        // to crowd an adjacent system. Red dwarfs hug closer still.
        const close = companion.name === "red dwarf" ? 0.6 : 1;
        const radius = starScale(i) * 0.4 * close;
        const phase =
          ((hashString(`${n.id}-cphase`) % 100) / 100) * Math.PI * 2;
        const cx = p[0] + Math.cos(phase) * radius;
        const cz = p[2] + Math.sin(phase) * radius;
        compStar.position.set(cx, p[1], cz);
        compCorona.position.set(cx, p[1], cz);
        compStar.raycast = () => {};
        compCorona.raycast = () => {};
        registerIntro(compStar, starScale(i) * 0.42, `${n.id}-comp`);
        registerIntro(
          compCorona,
          coronaScale(i, false) * 0.42,
          `${n.id}-compc`,
        );
        disposables.push(compStarMat, compCoronaMat);
        scene.add(compStar, compCorona);
        companions.push({
          i,
          star: compStar,
          corona: compCorona,
          center: [p[0], p[1], p[2]],
          radius,
          phase,
          starBase: compStarMat.opacity,
          coronaBase: compCoronaMat.opacity,
        });
      }
    });

    // Pristine per-node glow opacities, captured now (before fog/emphasis run),
    // so a de-emphasised node dims by a factor and restores to exactly its
    // class-dependent brightness — corona/spike opacity is glow-dependent, not
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
    // Created lazily per node the first time it needs one, so conquest — which
    // never sets a marker — allocates nothing. One shared texture/material.
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
    // own emphasis so distant fronts flicker fainter. Lazily created; the loop
    // drives the pulse when motion is on (so reduce-motion stays still).
    const flashSprites: (THREE.Sprite | undefined)[] = new Array(
      galaxy.nodes.length,
    ).fill(undefined);
    const flashEnabled = new Set<number>();
    const flashClock = galaxy.nodes.map((n) => ({
      phase: (hashString(`${n.id}-fp`) % 1000) / 1000,
      period: 2200 + (hashString(`${n.id}-fperiod`) % 1800),
    }));
    const FLASH_MS = 200;
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

    // Win burst: a one-shot shockwave ring + flare on a node (the star just
    // won). Two reused sprites, repositioned per burst; driven by the loop.
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
    const BURST_MS = 1300;
    let burstAnim: { t0: number } | null = null;
    const applyBurst = () => {
      const id = burstRef.current;
      if (!id || reduceMotion) return; // no animated burst under reduce-motion
      const p = positions.get(id);
      if (!p) return;
      const at: [number, number, number] = [p[0], p[1] + 0.3, p[2]];
      burstFlare.position.set(...at);
      burstRing.position.set(...at);
      burstAnim = { t0: performance.now() };
    };
    applyBurstRef.current = applyBurst;

    // Fade the lanes up during the intro (their target opacities are captured
    // now, then restored as the intro clock advances).
    if (animateIntro) {
      for (const pair of [lanes, factionLanes, frontier, pathTaken]) {
        for (const mesh of [pair.core, pair.halo]) {
          const mat = mesh.material as THREE.Material & { opacity: number };
          introLaneMats.push({ mat, target: mat.opacity });
          mat.opacity = 0;
        }
      }
    }

    // The player's homeworld gets a second, wider ring so "this is you, guard
    // it" is always legible at a glance.
    const homeworld = galaxy.nodes.find(
      (n) => n.kind === "capital" && n.owner === playerFactionId,
    );
    if (homeworld) {
      const p = positions.get(homeworld.id);
      const homeGeo = new THREE.RingGeometry(
        2.5,
        2.68,
        factionSides(galaxy, playerFactionId) || 48,
        1,
        Math.PI / 2,
      );
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
      "pointer-events:auto;cursor:pointer;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.9));";
    incursionEl.addEventListener("click", () => {
      const inc = incursionRef.current;
      if (inc) onSelectRef.current?.(inc.nodeId);
    });
    if (effects && !reduceMotion) {
      incursionEl.className = "gx-incursion-marker";
    }
    const incursionMarker = new CSS2DObject(incursionEl);
    incursionMarker.visible = false;
    scene.add(incursionMarker);

    /* ------------------------------- labels -------------------------------- */

    // Owner-tinted uppercase labels: colour carries territory at a glance, kept
    // legible by lerping the faction colour toward white. Recoloured on capture
    // by applyOwners.
    const labelCss = (owner: string | undefined): string =>
      `#${ownerColor(owner)
        .clone()
        .lerp(new THREE.Color(0xffffff), 0.3)
        .getHexString()}`;

    const labelObjects: CSS2DObject[] = [];
    if (!performanceMode) {
      galaxy.nodes.forEach((n) => {
        const p = positions.get(n.id);
        if (!p) return;
        const el = document.createElement("div");
        el.textContent = n.name;
        el.style.cssText =
          "pointer-events:none;font-size:10px;font-weight:600;" +
          "letter-spacing:0.14em;text-transform:uppercase;" +
          `color:${labelCss(ownersRef.current[n.id] ?? n.owner)};` +
          "text-shadow:0 1px 4px rgba(0,0,0,0.95);transform:translateY(14px);";
        const label = new CSS2DObject(el);
        label.position.set(p[0], p[1] - 3.6, p[2]);
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
    // z-index:0 gives the layer its own stacking context: CSS2DRenderer
    // assigns big per-label z-indexes for depth sorting, and without the
    // containment they'd escape and float above the page's overlay panels.
    labelRenderer.domElement.style.cssText =
      "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0;";
    container.appendChild(labelRenderer.domElement);

    // Centre the view on the player's own territory (the previewed faction
    // during setup), so switching faction recentres on that faction's worlds
    // rather than always framing the whole galaxy from the origin.
    const focus = new THREE.Vector3(0, 0, 0);
    {
      let sx = 0;
      let sz = 0;
      let count = 0;
      for (const n of galaxy.nodes) {
        if ((ownersRef.current[n.id] ?? n.owner) !== playerFactionId) continue;
        const p = positions.get(n.id);
        if (!p) continue;
        sx += p[0];
        sz += p[2];
        count++;
      }
      if (count > 0) focus.set(sx / count, 0, sz / count);
    }

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2500);
    // Start high above the plane (~27° from vertical), pulled back to frame the
    // player's region.
    camera.position.set(focus.x, extent * 1.05, focus.z + extent * 0.55);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(focus);
    // A strategy-map control scheme: drag pans across the plane, the view
    // stays a tilted look-down (no free orbit, no flat top-down, no edge-on).
    controls.minPolarAngle = 0.12; // allow a near-top-down view
    controls.maxPolarAngle = 1.25;
    // Free spin while dragging; the release handler below eases the heading
    // back to the default so the map always settles facing the same way.
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

    // Spin snap-back: while the pointer is down the user may rotate freely;
    // on release the azimuth eases back to the default heading (instantly
    // under reduce-motion). Driven from the animation loop.
    let dragging = false;
    let snapBack = false;
    const UP = new THREE.Vector3(0, 1, 0);
    controls.addEventListener("start", () => {
      dragging = true;
      snapBack = false;
    });
    controls.addEventListener("end", () => {
      dragging = false;
      if (!controls) return;
      if (reduceMotion) {
        const az = controls.getAzimuthalAngle();
        camera.position
          .sub(controls.target)
          .applyAxisAngle(UP, -az)
          .add(controls.target);
        controls.update();
      } else {
        snapBack = true;
      }
    });
    const easeHeading = () => {
      if (!controls || dragging || !snapBack) return;
      const az = controls.getAzimuthalAngle();
      if (Math.abs(az) < 0.002) {
        snapBack = false;
        return;
      }
      camera.position
        .sub(controls.target)
        .applyAxisAngle(UP, -az * 0.12)
        .add(controls.target);
    };

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
        if (i !== sel.idx) styleRing(i);
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
        // Fog: a lane with both ends hidden vanishes; one end hidden draws as
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
          // Run lanes: the route already travelled is a bright green trail;
          // forward lanes out of the current node (you -> a choice) are
          // directional routes; everything else is quiet base, dimmed by
          // emphasis. No faction-coloured lanes — a node's *type* is not an
          // allegiance. `trimmedSeg(a, b)` runs source -> target, so the pulse
          // flows outward.
          if (pathLinksRef.current?.has(`${a} ${b}`)) pathSegs.push(seg);
          else if (aPlayer && !bPlayer) routeSegs.push(seg);
          else pushBase(seg, a, b);
          continue;
        }
        if (aPlayer !== bPlayer) {
          frontierSegs.push(seg);
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
        setLanePair(frontier, routeSegs); // solid, not dashed
        setLanePair(pathTaken, pathSegs); // green trail behind you
        layoutChevrons(routeSegs);
      } else {
        setLanePair(factionLanes, factionSegs, factionSegColors);
        setLanePair(frontier, dashSegments(frontierSegs, 1.5, 1.2));
      }
    };
    applyOwnersRef.current = applyOwners;

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
          .copy(
            owner === NEUTRAL ? new THREE.Color(0x39404e) : ownerColor(owner),
          )
          .multiplyScalar(owner === NEUTRAL ? 1 : 0.45);
      }
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

    // Fog of war: dim and unlabel systems the player can't see, and hide their
    // ownership rings, coronas, spikes and companions. Lanes are handled in
    // applyOwners; picking skips fogged nodes (see pickAt).
    const FOG_DIM = 0.16;
    const applyVisibility = () => {
      if (skin === "theatre") return; // theatre region markers have no fog styling
      galaxy.nodes.forEach((n, i) => {
        const vis = isVisible(n.id);
        // Graded emphasis dims but keeps a node present (glow/ring/label stay);
        // fog fully hides its glow, ring and label. The two compose (fog wins
        // on hiding, emphasis scales what remains) but no caller uses both.
        const factor = dimOf(n.id);
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
      for (const s of structureDims) {
        s.color.copy(s.base).multiplyScalar(dimOf(galaxy.nodes[s.i].id));
      }
    };
    applyVisibilityRef.current = applyVisibility;

    applyOwners();
    applySelection();
    applyVisibility();

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
      const idx = hit?.instanceId ?? -1;
      // Fogged systems aren't selectable.
      if (idx >= 0 && !isVisible(nodeIds[idx])) return -1;
      return idx;
    };

    /** Hover: swell the corona and lift the ownership ring (the selection
     * pulse owns the selected node's ring, so leave that one alone). */
    const setHoverStyle = (i: number, on: boolean) => {
      coronaSprites[i]?.scale.setScalar(coronaScale(i, on));
      if (i === sel.idx) return;
      const ring = ownerRings[i];
      const mat = ownerRingMats[i];
      if (!ring || !mat) return;
      if (on) {
        ring.scale.setScalar(1.15);
        const owner =
          ownersRef.current[galaxy.nodes[i].id] ?? galaxy.nodes[i].owner;
        mat.color.copy(ownerColor(owner)).lerp(new THREE.Color(0xffffff), 0.35);
        mat.opacity = 1;
      } else {
        ring.scale.setScalar(1);
        styleRing(i);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const idx = pickAt(event);
      if (idx === hovered) return;
      if (hovered >= 0) setHoverStyle(hovered, false);
      hovered = idx;
      if (hovered >= 0) setHoverStyle(hovered, true);
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

    /* ------------------------------ intro warp ----------------------------- */

    // The camera eases in from further out and higher up while the stars pop
    // and the lanes fade (see the loop). Controls are handed back once done.
    const INTRO_MS = 1400;
    const introTo = camera.position.clone();
    // Pull back along the framing offset (relative to the focus point, not the
    // origin) so a recentred view still warps in toward its own centre.
    const introFrom = focus
      .clone()
      .addScaledVector(introTo.clone().sub(focus), 1.9);
    introFrom.y *= 1.3;
    let introActive = animateIntro;
    let introStartedAt = -1;
    if (animateIntro) {
      camera.position.copy(introFrom);
      if (controls) controls.enabled = false;
    }
    const easeOut = (t: number) => 1 - (1 - t) ** 3;

    /* ------------------------------ camera focus --------------------------- */

    // Ease the camera in on a node (zoomed) when `focusNodeId` is set, and back
    // to the framed overview when cleared. While a node is focused user controls
    // are locked; the ease itself is driven from the loop (snapped under
    // reduce-motion). Keeps the current view direction, just pulls closer.
    // `introTo` is the framed overview position (captured before the intro
    // pulled the camera back), so this must NOT read `camera.position` here.
    const framedTarget = focus.clone();
    const framedPos = introTo.clone();
    const FOCUS_DIST = 30;
    const FOCUS_MS = 650;
    let focusAnim: {
      fromT: THREE.Vector3;
      toT: THREE.Vector3;
      fromP: THREE.Vector3;
      toP: THREE.Vector3;
      t0: number;
    } | null = null;
    let focusShown: string | null = focusRef.current ?? null;

    const focusGoal = (id: string | null) => {
      const p = id ? positions.get(id) : undefined;
      if (p) {
        const target = new THREE.Vector3(p[0], p[1], p[2]);
        const dir = framedPos.clone().sub(framedTarget).normalize();
        return { target, pos: target.clone().addScaledVector(dir, FOCUS_DIST) };
      }
      return { target: framedTarget.clone(), pos: framedPos.clone() };
    };

    const applyFocus = (immediate: boolean) => {
      const id = focusRef.current ?? null;
      // No change (e.g. the mount-time effect firing with no focus) must not
      // spawn an ease that fights the intro.
      if (!immediate && id === focusShown) return;
      const goal = focusGoal(id);
      focusShown = id;
      if (controls) controls.enabled = !id;
      if (immediate || reduceMotion) {
        controls?.target.copy(goal.target);
        camera.position.copy(goal.pos);
        controls?.update();
        focusAnim = null;
        render();
        return;
      }
      focusAnim = {
        fromT: controls ? controls.target.clone() : goal.target.clone(),
        toT: goal.target,
        fromP: camera.position.clone(),
        toP: goal.pos,
        t0: performance.now(),
      };
    };
    applyFocusRef.current = () => applyFocus(false);
    // A node focused at mount (rare) snaps; otherwise the intro/overview runs.
    if (focusShown) applyFocus(true);
    // A faction switch rebuilds the scene with a new focus centroid: start from
    // the previous camera pose and ease to the new framed overview so the
    // recentre is a transition, not a jump. (The focus loop drives the ease and
    // suppresses controls while it runs.)
    else if (factionOnlyRebuild && !reduceMotion && camPoseRef.current) {
      camera.position.copy(camPoseRef.current.pos);
      controls.target.copy(camPoseRef.current.target);
      focusAnim = {
        fromT: camPoseRef.current.target.clone(),
        toT: framedTarget.clone(),
        fromP: camPoseRef.current.pos.clone(),
        toP: framedPos.clone(),
        t0: performance.now(),
      };
    }

    /* ---------------------------- animation loop --------------------------- */

    // Continuous only when motion is allowed: the intro warp, twinkle time,
    // binary-companion orbits, ring pulses and control damping. Under
    // reduce-motion the scene renders on demand and stays perfectly still.
    if (!reduceMotion) {
      const animate = () => {
        animationFrame = requestAnimationFrame(animate);
        const now = performance.now();

        // Intro warp-in: drive sprite scales, lane opacity and the camera.
        if (introActive) {
          if (introStartedAt < 0) introStartedAt = now;
          const raw = Math.min(1, (now - introStartedAt) / INTRO_MS);
          for (const it of introSprites) {
            const local =
              it.delay >= 1
                ? raw
                : Math.max(0, (raw - it.delay) / (1 - it.delay));
            it.sprite.scale.setScalar(it.target * easeOut(Math.min(1, local)));
          }
          const laneT = easeOut(raw);
          for (const lm of introLaneMats) {
            (lm.mat as THREE.Material & { opacity: number }).opacity =
              lm.target * laneT;
          }
          camera.position.lerpVectors(introFrom, introTo, easeOut(raw));
          // Keep the camera aimed at the target while it moves; otherwise the
          // orientation is frozen until controls resume and snaps at the end.
          camera.lookAt(framedTarget);
          if (raw >= 1) {
            for (const it of introSprites) it.sprite.scale.setScalar(it.target);
            for (const lm of introLaneMats) {
              (lm.mat as THREE.Material & { opacity: number }).opacity =
                lm.target;
            }
            // Hand controls back — unless a node was focused mid-intro.
            if (controls) controls.enabled = !focusShown;
            introActive = false;
          }
        }

        // Camera focus ease (in on a node / back to the overview). Never during
        // the intro — the two must not both drive the camera in one frame.
        if (focusAnim && controls && !introActive) {
          const e = easeOut(Math.min(1, (now - focusAnim.t0) / FOCUS_MS));
          controls.target.lerpVectors(focusAnim.fromT, focusAnim.toT, e);
          camera.position.lerpVectors(focusAnim.fromP, focusAnim.toP, e);
          // Track the moving target so the orientation doesn't snap at the end.
          camera.lookAt(controls.target);
          if (e >= 1) focusAnim = null;
        }

        if (effects) {
          uTime.value = now / 1000;
          // Directional route chevrons: a brightness wave that peaks at
          // successively further markers over time, so it reads as light
          // flowing outward toward the choices.
          if (flowEnabled) {
            for (const chev of chevrons) {
              if (!chev.mesh.visible) continue;
              chev.mat.opacity =
                0.22 + 0.78 * (0.5 + 0.5 * Math.sin(now / 240 - chev.t * 7));
            }
          }
          // Ambient combat flashes: a brief pop on a per-node cycle, faded by
          // the node's emphasis so distant fronts flicker fainter.
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
          // Binary companions orbit their primary in the map plane.
          for (const c of companions) {
            const a = c.phase + now / 2600;
            const x = c.center[0] + Math.cos(a) * c.radius;
            const z = c.center[2] + Math.sin(a) * c.radius;
            c.star.position.set(x, c.center[1], z);
            c.corona.position.set(x, c.center[1], z);
          }
          // Warpath identity rings: an anomaly slowly rotates and breathes; a
          // beacon pings outward on a repeating cycle. Faded by the node's own
          // emphasis so a distant one is subtler.
          for (const pu of identityPulses) {
            const dim = dimOf(galaxy.nodes[pu.i].id);
            if (pu.kind === "anomaly") {
              // Shimmer: rotate the energy field + breathe its brightness/scale.
              pu.mat.rotation = now / 4000 + pu.phase * 6.283;
              const breathe =
                0.5 + 0.5 * Math.sin(now / 650 + pu.phase * 6.283);
              pu.mat.opacity = pu.baseOpacity * (0.6 + 0.5 * breathe) * dim;
              pu.sprite.scale.setScalar(pu.baseScale * (0.92 + 0.12 * breathe));
            } else {
              // Beacon: a steady halo that breathes brightness and a little size.
              const breathe =
                0.5 + 0.5 * Math.sin(now / 900 + pu.phase * 6.283);
              pu.mat.opacity = pu.baseOpacity * (0.55 + 0.6 * breathe) * dim;
              pu.sprite.scale.setScalar(pu.baseScale * (0.95 + 0.12 * breathe));
            }
          }
          // Warlord lair: spin the accretion disc / defensive ring; breathe a
          // hypergiant (scale only, so fog/emphasis keep owning its opacity).
          // Ring-stations spin slowly so their specular sweeps (metal shimmer).
          for (const sp of spinners) {
            sp.mesh.rotation.y = sp.base + now * sp.rate;
          }
          for (const wa of warlordAnims) {
            if (wa.discMat) wa.discMat.rotation = now * (wa.discRate ?? 0);
            if (wa.pulse && !introActive) {
              const breathe = 1 + 0.06 * Math.sin(now / 900);
              for (const pr of wa.pulse)
                pr.sprite.scale.setScalar(pr.base * breathe);
            }
          }
          // Exotic stars (shared): pulsars flicker fast, variable stars' glows
          // breathe. Both fade by the node's own emphasis.
          for (const pt of pulsarTwinkles) {
            pt.mat.opacity =
              (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now / 120))) *
              dimOf(galaxy.nodes[pt.i].id);
          }
          for (const vp of variablePulses) {
            vp.mat.opacity =
              vp.base *
              (0.55 + 0.45 * Math.sin(now / 1100)) *
              dimOf(galaxy.nodes[vp.i].id);
          }
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
        // Win burst: shockwave ring expands and fades, flare spikes then dies.
        if (burstAnim) {
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
        }

        // Controls own the camera only in the free overview — not during the
        // intro, a focus ease, or while a node is focused (controls locked).
        if (!introActive && !focusAnim && !focusShown) {
          easeHeading();
          controls?.update();
        }
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
      // Remember the final pose so a faction-switch rebuild can ease from here.
      camPoseRef.current = {
        pos: camera.position.clone(),
        target: controls ? controls.target.clone() : new THREE.Vector3(),
      };
      observer?.disconnect();
      renderer?.domElement.removeEventListener("pointermove", onPointerMove);
      renderer?.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer?.domElement.removeEventListener("pointerup", onPointerUp);
      controls?.dispose();
      for (const label of labelObjects) label.removeFromParent();
      disposeLanePair(lanes);
      disposeLanePair(factionLanes);
      disposeLanePair(frontier);
      disposeLanePair(pathTaken);
      for (const d of disposables) d.dispose();
      labelRenderer?.domElement.remove();
      if (renderer) {
        renderer.domElement.remove();
        renderer.dispose();
      }
      renderRef.current = null;
      applyOwnersRef.current = null;
      applySelectionRef.current = null;
      applyVisibilityRef.current = null;
      applyFocusRef.current = null;
      applyBurstRef.current = null;
    };
  }, [
    galaxy,
    playerFactionId,
    reduceMotion,
    effects,
    performanceMode,
    spaceMaps,
    laneFlow,
    identities,
    depthMood,
  ]);

  // Prop changes mutate the live scene (and render a frame when the loop is
  // idle under reduce-motion). Fog changes touch both lanes (via applyOwners)
  // and the per-node styling.
  useEffect(() => {
    ownersRef.current = owners;
    visibleRef.current = visibleIds;
    emphasisRef.current = emphasis;
    pathLinksRef.current = pathLinks;
    applyOwnersRef.current?.();
    applyVisibilityRef.current?.();
    if (reduceMotion) renderRef.current?.();
  }, [owners, visibleIds, emphasis, pathLinks, reduceMotion]);

  useEffect(() => {
    selectedRef.current = selectedId;
    incursionRef.current = incursion;
    applySelectionRef.current?.();
    if (reduceMotion) renderRef.current?.();
  }, [selectedId, incursion, reduceMotion]);

  useEffect(() => {
    focusRef.current = focusNodeId;
    applyFocusRef.current?.();
  }, [focusNodeId]);

  useEffect(() => {
    burstRef.current = burstNodeId;
    applyBurstRef.current?.();
  }, [burstNodeId]);

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
