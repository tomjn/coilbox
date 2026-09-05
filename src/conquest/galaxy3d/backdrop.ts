import * as THREE from "three";
import { assetUrl } from "../../lib/assetUrl";
import type { GalaxyDoc } from "../model";
import { mulberry32 } from "../rng";
import { hashString } from "./layout";
import { buildStarfield } from "./starfield";
import { radialTexture } from "./textures";

/**
 * The decorative backdrop: the far galactic disc (or theatre chart plane)
 * and near star scatter that sit behind the playable nodes. Built once at
 * mount, independent of any game state (ownership, selection, fog, focus).
 */

/**
 * Procedural theatre-map chart: a dark slate plane with a faint grid and a
 * per-pixel vignette, the fallback when a theatre theme ships no backdrop.
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
    // Points rasterize as squares. A radial falloff on gl_PointCoord rounds
    // them into star dots. Small points render as crisp pinpricks, big ones
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

/**
 * Build the decorative backdrop into `scene`: a theatre chart plane for the
 * theatre skin, or the full galactic disc (far spiral, core glow, sky dome,
 * dust banks, near scatter, nebula sprites) for the galaxy skin.
 */
export function buildBackdrop(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  uTime: { value: number },
  galaxy: GalaxyDoc,
  skin: "galaxy" | "theatre",
  extent: number,
  performanceMode: boolean,
  effects: boolean,
  laneFlow: boolean,
  depthMood: boolean,
  renderRef: { current: (() => void) | null },
): void {
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
    geo.setAttribute("position", new THREE.BufferAttribute(stars.positions, 3));
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
    // Background: the starfield is additive with depthWrite off, so without an
    // explicit order a star nearer the camera than a body sorts AFTER it and
    // paints over the (opaque) body. renderOrder -1 pins the whole starfield
    // behind everything on the play plane, so solid bodies always occlude it.
    points.renderOrder = -1;
    // Decoration never intercepts picking.
    points.raycast = () => {};
    return points;
  };

  if (skin === "theatre") buildTheatreBackdrop();
  if (skin === "galaxy") buildGalaxyBackdrop();

  /**
   * Theatre skin: a flat tactical-map plane under the play layer, either an
   * authored backdrop image when the theme ships one (local/data refs), or a
   * procedural dark chart (grid + vignette) otherwise. Used by terrestrial
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
    // placed well beyond the pan clamp and zoom range, so you can look toward
    // the bright core but never reach it.
    const coreAngle = ((hashString(`${galaxy.id}-core`) % 360) * Math.PI) / 180;
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
  // sky reads as its own place. Conquest keeps the restrained haze, and the
  // non-bold path advances the seeded RNG in the exact same order as before,
  // so conquest's nebula placement is unchanged.
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
      // Only call the RNG for opacity in bold mode, else the sequence shifts
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
      // far column) tint deep red, since a cool cloud goes dark-muddy, so it
      // both reddens and darkens as the run nears its end.
      if (depthMood) {
        const moodT = Math.min(
          1,
          Math.max(0, 0.5 + sprite.position.x / extent),
        );
        mat.color.lerp(new THREE.Color("#b81e10"), 0.65 * moodT);
      }
    }
  }
}
