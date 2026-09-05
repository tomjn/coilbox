import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { GalaxyDoc, GalaxyNode, Incursion, NodeStar } from "../model";
import { isVoidNode, voidBodiesFor } from "./bodies";
import { createWinBurst } from "./burst";
import { factionSides } from "./factionShape";
import type {
  ExoticClass,
  LanePair,
  LaneSeg,
  NodeBodyKind,
  NodeIdentity,
  StarSystem,
} from "./GalaxyView";
import type { WorldPos } from "./layout";
import { hashString, trimLane } from "./layout";
import {
  accretionTexture,
  anomalyTexture,
  asteroidTexture,
  cometTailTexture,
  gasGiantTexture,
  greebleTexture,
  radialTexture,
  ringBurstTexture,
  spaceEnvTexture,
  spikesTexture,
} from "./textures";

/**
 * A merged flat-quad geometry for the lanes: `LineBasicMaterial` linewidth is
 * ignored on nearly every platform, so thin translucent quads give the thick,
 * anti-aliased connections lines can't. Endpoint heights interpolate so a
 * lane meets each node's ring at the ring's own height. UVs run along each
 * quad (u = length axis) so a capsule alpha texture rounds the ends, and an
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

/**
 * A light-filament texture for the lane quads: a gaussian profile across the
 * width (no hard edge at any zoom) rolled off smoothly at both ends.
 * `sigma` is the gaussian width as a fraction of the quad's height, small
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
 * The play-layer body construction: every per-node visual built once at
 * mount from the galaxy and its layout, including star sprites, coronas,
 * spikes, ownership rings, lanes, comet comas, binary companions,
 * theatre-skin markers and structure meshes, plus the win-burst and
 * incursion-marker objects that live alongside them. Pure move out of
 * GalaxyView's mount effect: same scene-graph construction order, same
 * parameters, no behaviour change. Returns the arrays and callbacks the
 * five apply* concerns (owners, selection, visibility, focus, burst) and
 * the mount effect's own labels/picking/intro-warp/animation-loop sections
 * consume.
 */
export function buildPlayLayer(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  galaxy: GalaxyDoc,
  skin: "galaxy" | "theatre",
  positions: Map<string, WorldPos>,
  playerFactionId: string,
  reduceMotion: boolean,
  effects: boolean,
  performanceMode: boolean,
  laneFlow: boolean,
  identities: Map<string, NodeIdentity> | undefined,
  spaceMaps: Set<string> | undefined,
  ownerColor: (owner: string | undefined) => THREE.Color,
  starSystemFor: (
    nodeId: string,
    capital: boolean,
    star?: NodeStar,
  ) => StarSystem,
  exoticClassFor: (nodeId: string) => ExoticClass | undefined,
  ownersRef: { current: Record<string, string> },
  incursionRef: { current: Incursion | undefined },
  onSelectRef: { current: ((nodeId: string | null) => void) | undefined },
  prevFactionRef: { current: string | undefined },
  burstRef: { current: string | null | undefined },
  applyBurstRef: { current: (() => void) | null },
) {
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
    const ends = trimLane(a, b, LANE_TRIM);
    return ends ? ([...ends[0], ...ends[1]] as LaneSeg) : null;
  };
  // No-Man's-Sky-style lines: each lane draws twice, a crisp thin core
  // plus a wide, very faint halo, both with gaussian cross-sections and
  // additive blending, so at any zoom they read as glowing filaments with
  // no hard edges.
  const LANE_CORE_W = 0.55;
  const LANE_HALO_W = 2.0;
  const laneCoreTex = filamentTexture(0.11);
  const laneHaloTex = filamentTexture(0.26);
  disposables.push(laneCoreTex, laneHaloTex);
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
  // individual segments, with no emphasis every segment is BASE_LANE_COLOR,
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
  // `laneFlow` (run) mode the same pair is drawn *solid* instead, the run's
  // open lanes are directional travel routes, not a contested battle line.
  const frontier = makeLanePair({
    // Vertex-coloured so hover and emphasis can grade individual dashes. The
    // material colour multiplies in, so a white vertex colour is plain gold.
    vertexColors: true,
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
  // animated over them outward. Under reduce-motion they sit static, still
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
  // Grow the pool to `n` chevrons (created lazily, hidden ones stay parked).
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
  // Lay chevrons out along the current open routes (called from owners.ts).
  const layoutChevrons = (routes: LaneSeg[]) => {
    if (!flowEnabled) return;
    ensureChevrons(routes.length * CHEVRONS_PER_ROUTE);
    let k = 0;
    for (const [x1, y1, z1, x2, y2, z2] of routes) {
      // The chevron's local +x is world +x, a Y-rotation of θ sends it to
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
  // generous, stable click area. The visible star is drawn by sprites, a
  // node reads as a *star* (hot white centre, coloured corona), not an
  // opaque billiard ball, and ownership is encoded by the corona tint plus
  // a crisp flat ring on the plane.
  const coreGeo = new THREE.SphereGeometry(1, 8, 6);
  const coreMat = new THREE.MeshBasicMaterial({ visible: false });
  disposables.push(coreGeo, coreMat);
  const cores = new THREE.InstancedMesh(coreGeo, coreMat, galaxy.nodes.length);
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
  // Only lit materials respond, every other object is unlit MeshBasic/Sprite,
  // so conquest and the rest of the map are unchanged. Warpath-only.
  if (anyIdentity) {
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(-0.85, 0.55, 0.35);
    scene.add(key, new THREE.AmbientLight(0xffffff, 0.14));
  }
  // Comet coma: a bright icy core fading through a soft dusty halo, so it
  // blends into the tail under additive blending (a comet is dust and ice,
  // not rock, no lit surface).
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
  // Sprites for star diffraction spikes, a flat Mesh for comet tails (which
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
    /** Per-node angular velocity (signed): magnitude varies the speed, sign
     * the direction, so binaries don't all sweep in lockstep. */
    omega: number;
    /** Pristine opacities, so emphasis can dim then restore exactly. */
    starBase: number;
    coronaBase: number;
  }
  const companions: Companion[] = [];

  // Warpath identity bodies that animate: an anomaly's field slowly rotates and
  // shimmers, a beacon's glow breathes. Driven by the loop when motion is on,
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
  // Node indices built as a warlord lair (any variant). The finale is never
  // dimmed by graded emphasis, it's the run's destination beacon, so it stays
  // fully opaque even while it's an unreached future node.
  const warlordNodeIdx = new Set<number>();

  // Dyson swarm motion: many small pentagonal collector panels orbit a yellow
  // star on varied inclinations (a spherical swarm). Each panel faces the star,
  // the loop shades it per frame so the star-facing (inner) side reads lit and
  // the outward side dark, and orbits it around its own tilted plane.
  interface DysonSat {
    /** Orthonormal basis of this panel's orbital plane. */
    e1: THREE.Vector3;
    e2: THREE.Vector3;
    radius: number;
    phase: number;
    /** Signed angular velocity (varies speed + direction per panel). */
    speed: number;
  }
  interface DysonSwarm {
    i: number;
    center: THREE.Vector3;
    /** All the panels as one instanced mesh (a single draw call). */
    mesh: THREE.InstancedMesh;
    sats: DysonSat[];
    satSize: number;
    warm: THREE.Color;
  }
  const dysonSwarms: DysonSwarm[] = [];

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
  // sitting flat. `base` is the node's fixed orientation, the loop adds time.
  const spinners: { mesh: THREE.Object3D; base: number; rate: number }[] = [];
  // The ring-stations are OPAQUE (so they occlude the stars behind them), which
  // means emphasis can't dim them by opacity, it darkens their metal colour
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
    starSystemFor(n.id, n.kind === "capital", n.star),
  );
  const nodeType = nodeSystem.map((s) => s.primary);
  const starScale = (i: number) =>
    (galaxy.nodes[i].kind === "capital" ? 4.2 : 3.6) * nodeType[i].size;
  const coronaScale = (i: number, hovered: boolean) => {
    const capital = galaxy.nodes[i].kind === "capital";
    return (capital ? 9 : 7.5) * nodeType[i].size * (hovered ? 1.35 : 1);
  };
  // Ownership rings take each faction's marker shape (circle, hexagon,
  // triangle, pentagon, diamond), ownership reads by shape as well as
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
  // tinted a dark shade of the owner colour (kept in owners.ts's styleRing).
  const discMats: (THREE.MeshBasicMaterial | undefined)[] = [];
  const discGeo = new THREE.CircleGeometry(1.35, 32);
  disposables.push(discGeo);

  // Voidwater bodies for the whole galaxy at once, so at least one node is a
  // comet whenever any are space maps (see `voidBodiesFor`).
  const voidBodies = voidBodiesFor(
    galaxy.nodes.filter((n) => isVoidNode(n, spaceMaps)).map((n) => n.id),
  );

  const WHITE = new THREE.Color(0xffffff);

  /**
   * A built structure (depot ring-station, warlord fortress) as *real 3D
   * geometry*, not a sprite: an OPAQUE metal ring-station, a ring of discrete
   * habitat modules (not a smooth torus), structural spokes to a central
   * drum-and-dome hub, and two solar-panel wings, lit by the scene's key light
   * with a specular sheen so
   * it reads as machined metal, and spun slowly so the highlight sweeps around
   * it. Opaque so it occludes the stars behind it. The ring (with all parts as
   * children sharing its metal) takes the spike slot, a soft glow sits in the
   * corona slot, the star slot stays empty. Emphasis dims it by darkening the
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
    // the surface is busy machined metal, a tighter specular catches the relief.
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

    // The station is a detailed ring of habitat modules aligned radially (each
    // faces the central hub), neighbouring modules are joined by docking tubes
    // into a ring, with just four spokes to a stepped central spine. Each
    // module is a multi-part assembly, to keep a busy station cheap, every part
    // is baked (cloned, transformed into station space) into three merged
    // meshes, one per material, so the whole thing is only a few draw calls.
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
      // toNonIndexed clones an indexed geo, clone() copies an already-unindexed
      // one. Uniform non-indexing lets mergeGeometries combine them.
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      g.applyMatrix4(partM);
      arr.push(g);
    };

    // Reusable base part geometries. Modules are RADIAL (long X axis points at
    // the hub), so the hull is long in X and the caps' axis is along X.
    const bodyGeo = new RoundedBoxGeometry(0.28, 0.15, 0.17, 3, 0.035);
    const deckGeo = new RoundedBoxGeometry(0.18, 0.07, 0.11, 2, 0.025);
    const capGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12);
    capGeo.rotateZ(Math.PI / 2); // axis along X (radial)
    const tankGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.1, 8);
    const antGeo = new THREE.BoxGeometry(0.012, 0.13, 0.012);
    const spanelGeo = new RoundedBoxGeometry(0.12, 0.014, 0.16, 1, 0.012);
    const strutGeo = new THREE.BoxGeometry(0.06, 0.025, 0.025);
    // Docking tube linking neighbouring modules (axis Z -> tangential once the
    // placement rotates it), and a stouter spoke from the hub to the ring.
    const tubeGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.16, 8);
    tubeGeo.rotateX(Math.PI / 2);
    const spokeGeo = new THREE.BoxGeometry(0.28, 0.05, 0.06);
    spokeGeo.translate(0.28, 0, 0); // pivot at hub, reach out to the ring

    const modMat = new THREE.Matrix4();
    const modQ = new THREE.Quaternion();
    const modE = new THREE.Euler();
    const modP = new THREE.Vector3();
    const modS = new THREE.Vector3();
    for (let s = 0; s < MODULES; s++) {
      const a = (s / MODULES) * Math.PI * 2;
      const j = (hashString(`${node.id}-mod${s}`) % 100) / 100;
      // rotation.y = -a aligns the module's long +X axis with the radius, so
      // every module faces the centre (using +a would mirror half the ring).
      modE.set(0, -a, 0);
      modQ.setFromEuler(modE);
      modMat.compose(
        modP.set(Math.cos(a) * RING_R, 0, Math.sin(a) * RING_R),
        modQ,
        modS.set(1, 0.9 + 0.2 * j, 1),
      );
      // Hull + raised deck (long axis radial).
      part(metalParts, bodyGeo, modMat, 0, 0, 0);
      part(metalParts, deckGeo, modMat, 0.01, 0.085, 0);
      // Docking caps at the inner and outer radial ends.
      part(coreParts, capGeo, modMat, 0.16, 0, 0);
      part(coreParts, capGeo, modMat, -0.16, 0, 0);
      // Tanks on the tangential sides + an antenna mast.
      part(coreParts, tankGeo, modMat, 0.02, 0.075, 0.06);
      part(coreParts, tankGeo, modMat, -0.02, 0.07, -0.06, 0, 0.8, 0.8, 0.8);
      part(coreParts, antGeo, modMat, -0.05, 0.14, 0.03);
      // Solar array on every third module, radially outward.
      if (s % 3 === 1) {
        part(coreParts, strutGeo, modMat, 0.19, 0, 0);
        part(panelParts, spanelGeo, modMat, 0.3, 0, 0);
      }
      // Docking tube joining this module to its neighbour (at the mid-angle),
      // so the modules form a connected ring rather than 12 hub spokes.
      const am = ((s + 0.5) / MODULES) * Math.PI * 2;
      modE.set(0, am, 0);
      modQ.setFromEuler(modE);
      modMat.compose(
        modP.set(Math.cos(am) * RING_R, 0, Math.sin(am) * RING_R),
        modQ,
        modS.set(1, 1, 1),
      );
      part(coreParts, tubeGeo, modMat, 0, 0, 0);
    }

    // Central hub: a stepped docking spine on a drum, reached by just four
    // spokes (not one per module).
    const hubMat = new THREE.Matrix4();
    const drumGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.13, 16);
    const spine1 = new THREE.CylinderGeometry(0.07, 0.09, 0.1, 12);
    const spine2 = new THREE.CylinderGeometry(0.045, 0.06, 0.09, 12);
    const spine3 = new THREE.CylinderGeometry(0.028, 0.04, 0.07, 10);
    part(coreParts, drumGeo, hubMat, 0, 0, 0);
    part(coreParts, spine1, hubMat, 0, 0.1, 0);
    part(coreParts, spine2, hubMat, 0, 0.19, 0);
    part(coreParts, spine3, hubMat, 0, 0.27, 0);
    for (let s = 0; s < 4; s++) {
      // Align each spoke with a module (every third), pointing radially out.
      const a = ((s * 3) / MODULES) * Math.PI * 2;
      part(metalParts, spokeGeo, hubMat, 0, 0, 0, -a);
    }

    // Merge each material's parts into one mesh (a busy station = 3 draw calls).
    const addMerged = (parts: THREE.BufferGeometry[], mat: THREE.Material) => {
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
      tubeGeo,
      spokeGeo,
      drumGeo,
      spine1,
      spine2,
      spine3,
    ]) {
      g.dispose();
    }
    // One warm light spec on the ring, no window detail at this distance.
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
    // A slight random tilt out of the flat plane (±~7.5°) so stations don't
    // all lie perfectly level. The spinner only drives rotation.y, so this
    // fixed tilt persists under the idle spin.
    station.rotation.x =
      ((hashString(`${node.id}-tiltx`) % 100) / 100 - 0.5) * 0.26;
    station.rotation.z =
      ((hashString(`${node.id}-tiltz`) % 100) / 100 - 0.5) * 0.26;
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
   * Build the warlord's lair, the run's final node, in one of three per-run
   * forms: a stylised black hole (dark core + a flat accretion disc that
   * foreshortens into an ellipse, plus a gravitational glow, no lensing) or a
   * blood-red hypergiant (hot core, violent corona + spikes, slow breathing).
   * Reuses the star / corona / spike slots like the other bodies. Built once
   * (a single boss node), so its bespoke textures live here, not in the shared
   * block. Returns `true`, always handles the warlord kinds.
   */
  const buildWarlordBody = (
    i: number,
    node: GalaxyNode,
    p: WorldPos,
    variant: NodeBodyKind,
  ): boolean => {
    warlordNodeIdx.add(i); // finale is always full-bright (see warlordNodeIdx)
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
      // fuzzy orange star. `bhShrink` scales every part of the lair together so
      // the whole black hole reads smaller without changing its proportions.
      const bhShrink = 0.72;
      // Solid black out to ~0.92 of the sprite, a thin anti-aliased rim only.
      // Sized (below) to fill right up to the accretion ring so no background
      // (stars, nebula) bleeds through the event horizon.
      const coreTex = radialTexture(128, [
        [0, "#000000ff"],
        [0.92, "#000000ff"],
        [1, "#00000000"],
      ]);
      // Canvas sprites default to mipmapping, a mostly-transparent additive-
      // adjacent quad then averages to a faint square at minified mips. Kill
      // mips on the black-hole textures so no ghost square frames the horizon.
      coreTex.generateMipmaps = false;
      coreTex.minFilter = THREE.LinearFilter;
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
      // Layer order (all coincident): corona glow (0) < core (1) < disc (2) <
      // photon (3). The opaque core sits ABOVE the glow so it blacks out the
      // orange the centred glow would otherwise wash across the middle, but
      // BELOW the additive disc/photon so the bright ring still adds over it.
      head.renderOrder = 1;
      // The core is scaled to meet the accretion ring's inner edge (disc
      // target * 0.46), so its opaque disc fills the dark interior right up to
      // the golden ring without spilling past it.
      registerIntro(head, base * 1.4 * bhShrink * 0.46, node.id);
      head.raycast = () => {};
      // Accretion disc: a BILLBOARD (not a flat plane). A flat plane looked
      // wrong from the side and split into two side patches behind the core, a
      // billboard reads as the same disc from every angle and its radial fade
      // always stays inside the sprite (no square cut-offs). It shimmers by
      // slowly rotating its material (the texture has a faint angular flow).
      const discTex = accretionTexture(256);
      discTex.generateMipmaps = false;
      discTex.minFilter = THREE.LinearFilter;
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
      disc.renderOrder = 2;
      registerIntro(disc, base * 1.4 * bhShrink, `${node.id}-disc`);
      disc.raycast = () => {};
      scene.add(disc);
      extra = disc;
      anim.discMat = discMat;
      anim.discRate = 0.00018;
      // Photon ring: a bright thin ring hugging the event horizon. Billboarded,
      // so it stays a circle around the dark sphere from any angle, the lensed
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
        photon.renderOrder = 3;
        registerIntro(photon, base * 0.78 * bhShrink, `${node.id}-photon`);
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
    // The black hole's glow is small so it rims the disc, the hypergiant's is
    // broad so it reads as a swollen star. The black hole's glow sits below the
    // core (renderOrder) so the opaque horizon covers it in the centre.
    const glowScale =
      coronaScale(i, false) * (variant === "warlord-blackhole" ? 0.3 : 1.4);
    if (variant === "warlord-blackhole") glow.renderOrder = 0;
    registerIntro(glow, glowScale, `${node.id}-corona`);
    glow.raycast = () => {};

    // A hypergiant breathes (scale only, opacity stays owned by fog/emphasis).
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
    // The black hole is busy enough on its own, the ownership pentagon reads
    // as clutter cutting through the disc, so it's built (to keep the ring
    // arrays index-aligned for selection/fog/owner logic) but never added to
    // the scene: an off-scene mesh renders nothing while all the per-frame
    // .visible/.scale/.geometry mutations against it stay harmless no-ops.
    scene.add(head, glow);
    if (variant !== "warlord-blackhole") scene.add(ownRing);
    return true;
  };

  // Shared unit pentagon panel (normal +Z) for every dyson-swarm collector.
  let dysonSatGeo: THREE.CircleGeometry | undefined;
  const DYSON_Z = new THREE.Vector3(0, 0, 1);

  /**
   * Build a dyson-swarm megastructure: a warm yellow star ringed by many small
   * pentagonal collector panels on varied orbital planes (a rough sphere, not a
   * flat ring). Each panel stays broadside to the star, the loop shades it so
   * its inner (star-facing) side reads lit and its outward side dark, and orbits
   * it at a per-panel speed and direction. Reuses the star / corona / spike
   * slots (the swarm group rides the spike slot) so intro, fog, ownership and
   * selection all keep working. Shared by the rare exotic (both modes) and the
   * warpath depot identity. Returns `true`.
   */
  const buildDysonSwarm = (
    i: number,
    node: GalaxyNode,
    p: WorldPos,
  ): boolean => {
    // Dyson stars are never tiny, nobody englobes a dim dwarf. Floor the size
    // so the host reads as a worthy, bright sun the swarm is worth building.
    const base = Math.max(starScale(i), 5);
    const warm = new THREE.Color("#ffd24a");
    // Central star (star slot): a big, brilliant near-white-hot sun. Additive
    // so it blooms bright against the dark sky (this is the whole reason the
    // swarm exists, a powerful star worth harvesting).
    const headMat = new THREE.SpriteMaterial({
      map: starTex,
      color: warm.clone().lerp(WHITE, 0.75),
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const head = new THREE.Sprite(headMat);
    head.position.set(p[0], p[1], p[2]);
    registerIntro(head, base * 1.05, node.id);
    head.raycast = () => {};
    // Corona (corona slot): a strong, wide warm halo so the star blazes through
    // the swarm that partly obscures it.
    const glowMat = new THREE.SpriteMaterial({
      map: coronaTex,
      color: new THREE.Color("#ffd98a"),
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.position.set(p[0], p[1], p[2]);
    registerIntro(glow, coronaScale(i, false) * 1.35, `${node.id}-corona`);
    glow.raycast = () => {};

    // Swarm (spike slot): MANY small pentagon collectors as ONE InstancedMesh
    // (a single draw call), so we can afford a dense shell that half-obscures
    // the star. Each panel stays broadside to the sun, the loop shades and
    // orbits them. The group's own scale carries the intro grow-in.
    if (!dysonSatGeo) {
      dysonSatGeo = new THREE.CircleGeometry(1, 5);
      disposables.push(dysonSatGeo);
    }
    const count = performanceMode ? 420 : 800;
    const satSize = base * 0.005;
    const satMat = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    const inst = new THREE.InstancedMesh(dysonSatGeo, satMat, count);
    inst.position.set(p[0], p[1], p[2]);
    inst.raycast = () => {};
    const sats: DysonSat[] = [];
    const seedV = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const posV = new THREE.Vector3();
    const sclV = new THREE.Vector3(satSize, satSize, satSize);
    const darkInit = warm.clone().multiplyScalar(0.3);
    for (let s = 0; s < count; s++) {
      // A random orbital plane: pick an axis, then two in-plane basis vectors.
      const a1 =
        ((hashString(`${node.id}-dsa${s}`) % 1000) / 1000) * Math.PI * 2;
      const a2 = ((hashString(`${node.id}-dsb${s}`) % 1000) / 1000) * Math.PI;
      const axis = new THREE.Vector3(
        Math.sin(a2) * Math.cos(a1),
        Math.cos(a2),
        Math.sin(a2) * Math.sin(a1),
      ).normalize();
      seedV.set(0, 1, 0);
      if (Math.abs(axis.y) > 0.9) seedV.set(1, 0, 0);
      const e1 = new THREE.Vector3().crossVectors(axis, seedV).normalize();
      const e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();
      // A compact shell (0.22..0.38 of the star size) pressed right up against
      // the sun, a narrow radial band so the panels read as one tight swarm
      // rather than a spread-out cloud.
      const radius =
        base * (0.22 + ((hashString(`${node.id}-dsr${s}`) % 100) / 100) * 0.16);
      const phase =
        ((hashString(`${node.id}-dsp${s}`) % 1000) / 1000) * Math.PI * 2;
      const speed =
        (1 / 5200) *
        (0.5 + ((hashString(`${node.id}-dss${s}`) % 100) / 100) * 1.0) *
        (hashString(`${node.id}-dsd${s}`) % 2 === 0 ? 1 : -1);
      // Initial pose (also the static look under reduce-motion).
      posV
        .copy(e1)
        .multiplyScalar(Math.cos(phase))
        .addScaledVector(e2, Math.sin(phase));
      q.setFromUnitVectors(DYSON_Z, posV);
      m4.compose(posV.multiplyScalar(radius), q, sclV);
      inst.setMatrixAt(s, m4);
      inst.setColorAt(s, darkInit);
      sats.push({ e1, e2, radius, phase, speed });
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    registerIntro(inst, 1, `${node.id}-swarm`);
    scene.add(inst);
    disposables.push(satMat, inst);
    dysonSwarms.push({
      i,
      center: new THREE.Vector3(p[0], p[1], p[2]),
      mesh: inst,
      sats,
      satSize,
      warm,
    });

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
    spikeSprites.push(inst);
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
   * a kind it doesn't build (warlord lairs, handled elsewhere) so the caller
   * falls through to a normal star. Never runs for theatre / void nodes.
   */
  const buildIdentityBody = (
    i: number,
    node: GalaxyNode,
    p: WorldPos,
    body: NodeBodyKind,
  ): boolean => {
    if (body.startsWith("warlord")) return buildWarlordBody(i, node, p, body);
    if (body === "dyson-swarm") return buildDysonSwarm(i, node, p);
    // A depot is a built structure: a flat, foreshortened ring-station, not a
    // billboarded body (which read as a logo).
    if (body === "station") {
      return buildStructureBody(i, node, p, {
        scale: 0.5,
        tint: "#cfd3da",
        glowColor: "#7fe08a",
        glowOpacity: 0.22,
        glowScale: 0.45,
      });
    }
    // Per-kind recipe. `head` is the body in the star slot, `glow` a soft halo
    // in the corona slot. No clean rings, a tidy annulus read as HUD, identity
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
      // A wispy, irregular energy field (not a star, not a ring), it shimmers
      // via a slow rotation and brightness breathe in the loop.
      recipe = {
        head: { tex: anomalyTex, color: "#b98cff", additive: true },
        headScale: 1.25,
        glow: { color: "#8f5cff", opacity: 0.5, scale: 1.0 },
        pulse: "anomaly",
      };
    } else if (body === "beacon") {
      // A friendly bright point whose halo breathes, no ping ring.
      recipe = {
        head: { tex: starTex, color: "#d6fff8" },
        headScale: 0.9,
        glow: { color: "#4fe6d6", opacity: 0.55, scale: 1.2 },
        pulse: "beacon",
      };
    }
    if (!recipe) return false;

    // Events (anomalies) jitter hue per node (~±18°) so they don't all read as
    // one identical purple, wreck/beacon keep their fixed colour.
    const hueShift =
      body === "anomaly"
        ? ((hashString(`${node.id}-hue`) % 100) / 100 - 0.5) * 0.1
        : 0;
    const headColor = new THREE.Color(recipe.head.color).offsetHSL(
      hueShift,
      0,
      0,
    );
    const glowColor = new THREE.Color(recipe.glow.color).offsetHSL(
      hueShift,
      0,
      0,
    );
    const headMat = new THREE.SpriteMaterial({
      map: recipe.head.tex,
      color: headColor,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: recipe.head.additive
        ? THREE.AdditiveBlending
        : THREE.NormalBlending,
      // A wreck reuses the lit asteroid, spin it per node so no two align.
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
      color: glowColor,
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

    // The anomaly shimmers (rotate + breathe the field), the beacon's halo
    // breathes. Both loop-driven, static under reduce-motion.
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
  // use.
  let gasGiantTex: THREE.Texture | undefined;
  const getGasGiantTex = () => {
    if (!gasGiantTex) {
      gasGiantTex = gasGiantTexture(128);
      disposables.push(gasGiantTex);
    }
    return gasGiantTex;
  };

  /**
   * Build a full-replacement exotic body (pulsar or ringed gas giant) in the
   * star / corona / spike slots. The pulsar is a tiny blue-white core with
   * bright beamed spikes and a fast twinkle, the gas giant a warm banded globe
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
      // Bright beamed spikes, the pulsar's lighthouse look.
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
      // Gas giant: a lit globe (normal blending), no planetary ring.
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
    // Space maps (voidwater) read as asteroid fields, not star systems, a
    // rare comet variant gets a trailing tail. Reuses the star/corona/spike
    // slots so intro, ownership rings and selection keep working, skips the
    // binary companion. See `./bodies` for the pure asteroid/comet split.
    const isVoid = isVoidNode(n, spaceMaps);
    // Rare exotic star (shared with conquest): pulsar / gas giant / dyson swarm
    // fully replace the star, variable / carbon tweak the ordinary star below.
    // Never for capitals (they read as important giants) or void asteroid fields.
    // A node with real spectral data is a real star, and there is no pulsar
    // within 19 light years. Inventing one would undercut the whole mode.
    const exotic =
      n.kind === "capital" || isVoid || n.star
        ? undefined
        : exoticClassFor(n.id);
    if (exotic === "dysonswarm" && buildDysonSwarm(i, n, p)) {
      return;
    }
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
      registerIntro(star, starScale(i) * (isComet ? 0.525 : 0.95), n.id);
      star.raycast = () => {};
      // Dust: a faint halo around an asteroid, a brighter icy aura around a
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
        coronaScale(i, false) * (isComet ? 0.5 : 0.6),
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
        // sprite, so the tail keeps a fixed world direction as the camera
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
        registerIntro(tail, starScale(i) * 1.9, `${n.id}-tail`);
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
    // keep their saturation, hot stars blow out toward white (type.tint).
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
    // four-point flares read as uniform), each rotated slightly so no two
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
    // primary (position animated in the loop, static offset when motion off).
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
      // Orbit character, widely varied so binaries never sweep in lockstep:
      // most are slow and wide, a minority (~18%) tight and fast. Direction is
      // a balanced coin-flip on its own hash (a plain %2 skewed one way).
      const t = (hashString(`${n.id}-orbit`) % 1000) / 1000;
      const fast = t > 0.82;
      const speedMul = fast ? 2.4 + ((t - 0.82) / 0.18) * 2.6 : 0.16 + t * 0.5;
      const dir = (hashString(`${n.id}-orbdir`) % 1000) / 1000 < 0.5 ? 1 : -1;
      const omega = (1 / 2600) * speedMul * dir;
      // Tight orbits scale gently with the primary, a fast partner hugs closer
      // still (a tight, quick binary), and red dwarfs closest of all.
      const close = companion.name === "red dwarf" ? 0.6 : 1;
      const radius = starScale(i) * 0.4 * close * (fast ? 0.5 : 1);
      const phase = ((hashString(`${n.id}-cphase`) % 100) / 100) * Math.PI * 2;
      const cx = p[0] + Math.cos(phase) * radius;
      const cz = p[2] + Math.sin(phase) * radius;
      compStar.position.set(cx, p[1], cz);
      compCorona.position.set(cx, p[1], cz);
      compStar.raycast = () => {};
      compCorona.raycast = () => {};
      registerIntro(compStar, starScale(i) * 0.42, `${n.id}-comp`);
      registerIntro(compCorona, coronaScale(i, false) * 0.42, `${n.id}-compc`);
      disposables.push(compStarMat, compCoronaMat);
      scene.add(compStar, compCorona);
      companions.push({
        i,
        star: compStar,
        corona: compCorona,
        center: [p[0], p[1], p[2]],
        radius,
        phase,
        omega,
        starBase: compStarMat.opacity,
        coronaBase: compCoronaMat.opacity,
      });
    }
  });

  // Win burst: a one-shot shockwave ring + flare on a node (the star just
  // won). See burst.ts, ticked in the animation loop below.
  const winBurst = createWinBurst(
    scene,
    disposables,
    positions,
    burstRef,
    reduceMotion,
  );
  applyBurstRef.current = winBurst.apply;

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
  // threatened star (a pulsing ring read as decoration, a warning triangle
  // doesn't). CSS2D so it stays screen-sized and crisp, the pulse is a CSS
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

  return {
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
  };
}
