import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js";
import { drawingPixelRatio } from "../../lib/uiZoom";
import type { GalaxyDoc, Incursion, NodeStar } from "../model";
import { buildBackdrop } from "./backdrop";
import { bodyLabel, type VoidBody } from "./bodies";
import { createFocus } from "./focus";
import { hashString, layoutNodes, playBounds, playExtentFor } from "./layout";
import { createOwners } from "./owners";
import { buildPlayLayer } from "./playLayer";
import { createSelection } from "./selection";
import { createVisibility } from "./visibility";

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
  | "dyson-swarm"
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
  /**
   * Shift the framed centre rightward by this fraction of the scene extent, so
   * the previewed faction lands in the visible area to the *left* of an
   * overlay panel (e.g. the run-setup panel pinned to the right) instead of
   * dead-centre behind it. Applied at build/re-frame time.
   */
  focusBiasX?: number;
  display?: Partial<GalaxyDisplay>;
  className?: string;
}

/** How much brighter a lane gets while either end is hovered. */
const HOVER_LANE_BOOST = 1.6;

/** How far every other lane fades while a system is hovered. Pulling the rest
 * back is what separates a system's reach from the web behind it. */
const HOVER_LANE_FADE = 0.4;

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
  { name: "blue giant", color: "#7fa8ff", size: 1.9, tint: 0.5, glow: 1.25 },
  { name: "red giant", color: "#ff5230", size: 2.05, tint: 0.3, glow: 1.2 },
  // Substellar, so it never lights up. Only real catalogue data selects it.
  { name: "brown dwarf", color: "#7a2a18", size: 0.4, tint: 0.05, glow: 0.2 },
] as const;
const GIANT_TYPES = [5, 6]; // indices into STAR_TYPES
// Dwarfs are common, giants rare, mirroring a real stellar population. Brown
// dwarfs carry weight 0: a procedural galaxy never rolls one, so adding the
// class leaves every existing galaxy looking exactly as it did.
const TYPE_WEIGHTS = [3, 3, 2, 2, 1, 1, 1, 0];
const WEIGHT_TOTAL = TYPE_WEIGHTS.reduce((a, b) => a + b, 0);

export type StarType = (typeof STAR_TYPES)[number];

/** Index into {@link STAR_TYPES} keyed by spectral class letter. */
const CLASS_TYPES: Record<string, number> = {
  O: 5,
  B: 5,
  A: 3,
  F: 3,
  G: 2,
  K: 1,
  M: 0,
  L: 7,
  T: 7,
  Y: 7,
};

/**
 * The star type for a real spectral classification such as "A1.0 V", "DA2" or
 * "T6.0 V". White dwarfs are their own class, luminosity class III or brighter
 * promotes a star to the matching giant, and anything unrecognised falls back
 * to a yellow star.
 *
 * Nothing within 19 light years is a giant, so that branch is here for
 * correctness rather than for anything currently on the map.
 */
export function starTypeForSpectral(spectral: string): StarType {
  const text = spectral.trim().toUpperCase();
  if (text.startsWith("D")) return STAR_TYPES[4]; // white dwarf
  const index = CLASS_TYPES[text[0]];
  if (index === undefined) return STAR_TYPES[2];
  const luminosity = text.match(/\b(I{1,3}|IV|V|VI|VII)\b/)?.[1];
  const giant =
    luminosity === "I" || luminosity === "II" || luminosity === "III";
  if (giant) return STAR_TYPES[index === 0 || index === 1 ? 6 : 5];
  return STAR_TYPES[index];
}

export function starTypeFor(
  nodeId: string,
  capital: boolean,
  spectral?: string,
): StarType {
  // Real data always wins. A hash of the node id cannot know that Sirius is
  // an A1 V.
  if (spectral) return starTypeForSpectral(spectral);
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
  /**
   * Every component of the system, brightest first. Procedural galaxies have
   * one or two. Real ones can have three, as Alpha Centauri does.
   */
  members: StarType[];
}

/**
 * The stellar system for a node: its primary class plus, deterministically for
 * roughly one node in six, a dwarf companion. Same hash-of-id approach as
 * {@link starTypeFor} so map, panel and battle backdrop always agree.
 */
export function starSystemFor(
  nodeId: string,
  capital: boolean,
  star?: NodeStar,
): StarSystem {
  // A catalogued system already knows what it is, down to how many stars it
  // has, so the binary roll is skipped entirely.
  if (star && star.spectral.length > 0) {
    const members = star.spectral.map(starTypeForSpectral);
    return { primary: members[0], companion: members[1], members };
  }
  const primary = starTypeFor(nodeId, capital);
  const binary = hashString(`${nodeId}-binary`) % 6 === 0;
  const companion = binary
    ? STAR_TYPES[
        COMPANION_TYPES[
          hashString(`${nodeId}-companion`) % COMPANION_TYPES.length
        ]
      ]
    : undefined;
  return {
    primary,
    companion,
    members: companion ? [primary, companion] : [primary],
  };
}

/** A human label for a node's stellar system (selection panel). */
/** Word for a system of three or more stars, by component count. */
const MULTIPLICITY: Record<number, string> = {
  3: "triple",
  4: "quadruple",
  5: "quintuple",
};

export function starSystemLabel(system: StarSystem): string {
  if (system.members.length >= 3) {
    const word = MULTIPLICITY[system.members.length] ?? "multiple";
    const names = system.members.map((m) => m.name).join(" + ");
    return `${word} system, ${names}`;
  }
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
export type ExoticClass =
  | "pulsar"
  | "variable"
  | "gasgiant"
  | "carbon"
  | "dysonswarm";

const EXOTIC_LABEL: Record<ExoticClass, string> = {
  pulsar: "pulsar",
  variable: "variable star",
  gasgiant: "ringed gas giant",
  carbon: "carbon star",
  dysonswarm: "dyson swarm",
};

/** The exotic class for a node, or `undefined` for an ordinary star (~93%). */
export function exoticClassFor(nodeId: string): ExoticClass | undefined {
  const h = hashString(`${nodeId}-exotic`) % 1000;
  if (h < 15) return "pulsar";
  if (h < 30) return "variable";
  if (h < 45) return "gasgiant";
  if (h < 60) return "carbon";
  if (h < 70) return "dysonswarm"; // ~1%, a rare megastructure
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
  star?: NodeStar,
): string {
  if (voidBody) return bodyLabel(voidBody);
  if (!capital && !star) {
    const exotic = exoticClassFor(nodeId);
    if (exotic) return EXOTIC_LABEL[exotic];
  }
  return starSystemLabel(starSystemFor(nodeId, capital, star));
}

/** One lane segment in 3D: [x1, y1, z1, x2, y2, z2]. */
export type LaneSeg = [number, number, number, number, number, number];

/** A lane overlay's two meshes (crisp core + soft halo), see `makeLanePair`. */
export interface LanePair {
  core: THREE.Mesh;
  halo: THREE.Mesh;
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
  focusBiasX = 0,
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
    // The node under the pointer, so its lanes can be picked out of the web.
    // Plain mutable state rather than a ref: only this effect reads it, and the
    // hover handler below lives in the same scope.
    let hoveredNodeId: string | null = null;

    // A lane is only as bright as its dimmer end, so a lane into a faded node
    // fades with it. A lane touching the hovered node is lifted above its base
    // brightness, which is what makes a system's reach readable at a glance.
    const laneDim = (a: string, b: string): number => {
      const dim = Math.min(dimOf(a), dimOf(b));
      if (hoveredNodeId === null) return dim;
      const touchesHover = a === hoveredNodeId || b === hoveredNodeId;
      return dim * (touchesHover ? HOVER_LANE_BOOST : HOVER_LANE_FADE);
    };

    /* ------------------------- decorative backdrop ------------------------- */

    buildBackdrop(
      scene,
      disposables,
      uTime,
      galaxy,
      skin,
      extent,
      performanceMode,
      effects,
      laneFlow,
      depthMood,
      renderRef,
    );

    /* ----------------------------- play layer ------------------------------ */

    const {
      trimmedSeg,
      setLanePair,
      disposeLanePair,
      lanes,
      factionLanes,
      frontier,
      pathTaken,
      flowEnabled,
      chevrons,
      layoutChevrons,
      cores,
      coronaSprites,
      ownerRingMats,
      ownerRings,
      starMats,
      spikeSprites,
      companions,
      identityPulses,
      warlordAnims,
      warlordNodeIdx,
      dysonSwarms,
      pulsarTwinkles,
      variablePulses,
      spinners,
      structureDims,
      factionOnlyRebuild,
      animateIntro,
      introSprites,
      introLaneMats,
      coronaScale,
      ringGeoFor,
      discMats,
      WHITE,
      DYSON_Z,
      winBurst,
      incursionMarker,
    } = buildPlayLayer(
      scene,
      disposables,
      galaxy,
      skin,
      positions,
      playerFactionId,
      reduceMotion,
      effects,
      performanceMode,
      laneFlow,
      identities,
      spaceMaps,
      ownerColor,
      starSystemFor,
      exoticClassFor,
      ownersRef,
      incursionRef,
      onSelectRef,
      prevFactionRef,
      burstRef,
      applyBurstRef,
    );

    /* ------------------------------- labels -------------------------------- */

    // Owner-tinted uppercase labels: colour carries territory at a glance, kept
    // legible by lerping the faction colour toward white. Recoloured on capture
    // by owners.ts's apply.
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
      // Bias the framed centre right so the faction sits left of a right-hand
      // overlay panel (the camera looks down +Z with world +X → screen right,
      // so moving the target right pushes the content left on screen).
      focus.x += extent * focusBiasX;
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

    // Ownership styling: ring shape/colour/opacity, label colour, and the
    // three lane overlays, all re-derived on every ownership/fog/hover
    // change. See owners.ts. `styleRing` is exported so selection and hover
    // (below) can put a ring they were overriding back to its plain style.
    const owners = createOwners(
      galaxy,
      playerFactionId,
      laneFlow,
      ownersRef,
      pathLinksRef,
      isVisible,
      laneDim,
      ownerColor,
      dimOf,
      trimmedSeg,
      setLanePair,
      layoutChevrons,
      lanes,
      factionLanes,
      frontier,
      pathTaken,
      labelObjects,
      labelCss,
      ownerRingMats,
      ownerRings,
      discMats,
      ringGeoFor,
      () => selection.getIndex(),
    );
    applyOwnersRef.current = owners.apply;

    // Selection enlarges the node's own ownership ring and pulses its
    // colour, in the animation loop below, no second ring. See selection.ts.
    const selection = createSelection(
      galaxy,
      nodeIds,
      selectedRef,
      incursionRef,
      positions,
      incursionMarker,
      ownerRings,
      ownerRingMats,
      ownerColor,
      ownersRef,
      owners.styleRing,
    );
    applySelectionRef.current = selection.apply;

    // Fog of war + graded emphasis: dim/hide styling for every node, plus the
    // lazily-built "done" check marker and ambient combat flash. See
    // visibility.ts. The flash pulse is ticked in the animation loop below.
    const visibility = createVisibility(
      scene,
      disposables,
      galaxy,
      positions,
      skin,
      isVisible,
      dimOf,
      emphasisRef,
      warlordNodeIdx,
      starMats,
      coronaSprites,
      spikeSprites,
      ownerRings,
      labelObjects,
      companions,
      structureDims,
    );
    applyVisibilityRef.current = visibility.apply;

    owners.apply();
    selection.apply();
    visibility.apply();

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
      if (i === selection.getIndex()) return;
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
        owners.styleRing(i);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const idx = pickAt(event);
      if (idx === hovered) return;
      if (hovered >= 0) setHoverStyle(hovered, false);
      hovered = idx;
      if (hovered >= 0) setHoverStyle(hovered, true);
      // Lane colours are baked into the merged geometry, so lifting the hovered
      // node's lanes means rebuilding them. That is the same work an ownership
      // change already does, and it only runs when the hovered node changes.
      hoveredNodeId = idx >= 0 ? galaxy.nodes[idx].id : null;
      owners.apply();
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
    // to the framed overview when cleared. Also drives the faction-switch
    // recentre ease. See focus.ts. `introTo` is the framed overview position
    // (captured before the intro pulled the camera back).
    const framedTarget = focus.clone();
    const framedPos = introTo.clone();
    const cameraFocus = createFocus(
      camera,
      controls,
      render,
      positions,
      focusRef,
      framedTarget,
      framedPos,
      reduceMotion,
      factionOnlyRebuild,
      camPoseRef.current,
    );
    applyFocusRef.current = () => cameraFocus.apply(false);

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
            if (controls) controls.enabled = !cameraFocus.isFocused();
            introActive = false;
          }
        }

        // Camera focus ease (in on a node / back to the overview). Never
        // during the intro, so the two never drive the camera in one frame.
        if (!introActive) cameraFocus.tick(now);

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
          // the node's emphasis. See visibility.ts.
          visibility.tick(now);
          // Binary companions orbit their primary in the map plane.
          for (const c of companions) {
            const a = c.phase + now * c.omega;
            const x = c.center[0] + Math.cos(a) * c.radius;
            const z = c.center[2] + Math.sin(a) * c.radius;
            c.star.position.set(x, c.center[1], z);
            c.corona.position.set(x, c.center[1], z);
          }
          // Dyson swarms: orbit every collector on its tilted plane and shade it
          // by view — the star-facing (inner) side reads bright, the outward side
          // near-black, for a strong sun-lit shell. One instanced mesh per swarm.
          if (dysonSwarms.length) {
            const dsDir = new THREE.Vector3();
            const dsPos = new THREE.Vector3();
            const dsScl = new THREE.Vector3();
            const dsQ = new THREE.Quaternion();
            const dsM = new THREE.Matrix4();
            const dsCol = new THREE.Color();
            for (const sw of dysonSwarms) {
              const dim = dimOf(galaxy.nodes[sw.i].id);
              const mesh = sw.mesh;
              const sats = sw.sats;
              dsScl.setScalar(sw.satSize);
              for (let s = 0; s < sats.length; s++) {
                const st = sats[s];
                const th = st.phase + now * st.speed;
                const ct = Math.cos(th);
                const sn = Math.sin(th);
                // Unit offset direction on this panel's orbital plane.
                const ux = st.e1.x * ct + st.e2.x * sn;
                const uy = st.e1.y * ct + st.e2.y * sn;
                const uz = st.e1.z * ct + st.e2.z * sn;
                dsDir.set(ux, uy, uz);
                dsQ.setFromUnitVectors(DYSON_Z, dsDir);
                dsPos.copy(dsDir).multiplyScalar(st.radius);
                dsM.compose(dsPos, dsQ, dsScl);
                mesh.setMatrixAt(s, dsM);
                // Lit when the inner normal (−offset) faces the camera. Sharp
                // falloff + near-black dark side = strong inner/outer contrast.
                const vx = camera.position.x - (sw.center.x + ux * st.radius);
                const vy = camera.position.y - (sw.center.y + uy * st.radius);
                const vz = camera.position.z - (sw.center.z + uz * st.radius);
                const vlen = Math.hypot(vx, vy, vz) || 1;
                const face = Math.max(0, (-ux * vx - uy * vy - uz * vz) / vlen);
                const lit = face * face; // face^2
                // The star-facing side blazes with reflected starlight (colour
                // pushed white-hot and well past 1 so it clamps to a brilliant
                // glint); the outward side falls to near-black. Huge contrast.
                dsCol
                  .copy(sw.warm)
                  .lerp(WHITE, 0.3 + lit * 0.6)
                  .multiplyScalar((0.015 + 3.4 * lit) * dim);
                mesh.setColorAt(s, dsCol);
              }
              mesh.instanceMatrix.needsUpdate = true;
              if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            }
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
          selection.tick(now);
        }
        winBurst.tick(now);

        // Controls own the camera only in the free overview — not during the
        // intro, a focus ease, or while a node is focused (controls locked).
        if (
          !introActive &&
          !cameraFocus.isAnimating() &&
          !cameraFocus.isFocused()
        ) {
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
      // Every resize, not once at build: UI zoom moves the pixel ratio and the
      // container's CSS size together, so the observer that reports the size
      // change is also when the ratio needs re-reading (see `lib/uiZoom`).
      renderer.setPixelRatio(drawingPixelRatio(performanceMode ? 1 : 2));
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
    focusBiasX,
  ]);

  // Prop changes mutate the live scene (and render a frame when the loop is
  // idle under reduce-motion). Fog changes touch both lanes (via owners.ts's
  // apply) and the per-node styling.
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
