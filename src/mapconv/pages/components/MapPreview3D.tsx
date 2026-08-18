import { cn } from "@picoframe/frame";
import { Box, ImageOff, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";
import { Checkbox } from "@/components/ui/checkbox";
import { useCanvas3D } from "@/lib/useCanvas3D";
import { useReduceMotion } from "../../../general/display";
import type { MapAppearance } from "../../bindings";
import { decimateHeights, type HeightWords } from "../../heightGrid";
import { getImageInfo } from "../../imageCache";

export type { HeightWords };

type Rgb = [number, number, number];

/** A three.js colour from a mapinfo `{r,g,b}` (0–1) triple, or a hex fallback. */
function colorFrom(rgb: Rgb | null | undefined, fallback: number): THREE.Color {
  return rgb
    ? new THREE.Color(rgb[0], rgb[1], rgb[2])
    : new THREE.Color(fallback);
}

/** A small tiling grey-centred noise texture, used as the generic detail overlay
 * when a map ships no `detailtex` of its own. Grey (~0.5) is neutral under the
 * shader's `detail * 2` multiply; the noise breaks up base-texture blur when
 * zoomed in and mip-averages back to neutral from a distance. Mirrored wrapping
 * tiles it seamlessly (no visible seam grid). */
function makeProceduralDetail(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const v = 112 + Math.floor(Math.random() * 32); // ~grey, modest contrast
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.MirroredRepeatWrapping;
  tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** A soft, tiling cloud alpha texture: overlapping white radial blobs on a
 * transparent field, so a translucent plane tinted with `cloudColor` reads as a
 * faint high overcast. The RGB stays white (the plane's material colour supplies
 * the tint); only the alpha varies. Repeat-wrapped so it can drift and tile. */
function makeProceduralCloud(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    // A faint continuous base so the gaps between blobs read as thinner overcast
    // rather than clear holes (which looked like confetti on glass).
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(0, 0, size, size);
    // Large, soft, heavily overlapping blobs (with a plateaued core) build up a
    // lumpy but continuous cloud field rather than scattered specks.
    for (let i = 0; i < 22; i++) {
      const cx = Math.random() * size;
      const cy = Math.random() * size;
      const r = size * (0.22 + Math.random() * 0.28);
      const g = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
      g.addColorStop(0, "rgba(255,255,255,0.45)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** Shape of `DDSLoader.parse` output (three doesn't export this type). */
type DdsData = {
  isCubemap: boolean;
  mipmaps: { data: Uint8Array; width: number; height: number }[];
  width: number;
  height: number;
  format: number;
  mipmapCount: number;
};

/**
 * Decode a skybox DDS `data:` URL into a `CompressedCubeTexture` usable as
 * `scene.background`, or `null` when it isn't a cube map or can't be decoded.
 *
 * `DDSLoader.load` yields a plain `CompressedTexture` that three's background
 * renderer treats as a flat plane (it only takes the cube path for
 * `isCubeTexture`). So we `parse()` the bytes ourselves and assemble the six faces
 * into a `CompressedCubeTexture` (`isCubeTexture === true`) — the same face layout
 * `CompressedTextureLoader` builds internally. Any failure returns `null`, leaving
 * the caller's flat sky colour in place.
 */
async function loadSkyboxCube(
  src: string,
): Promise<THREE.CompressedCubeTexture | null> {
  try {
    const buffer = await (await fetch(src)).arrayBuffer();
    const data = new DDSLoader().parse(buffer, true) as unknown as DdsData;
    if (!data.isCubemap) return null;
    const faceCount = data.mipmaps.length / data.mipmapCount;
    if (faceCount !== 6) return null;
    const faces = [];
    for (let f = 0; f < faceCount; f++) {
      const mipmaps = [];
      for (let i = 0; i < data.mipmapCount; i++) {
        mipmaps.push(data.mipmaps[f * data.mipmapCount + i]);
      }
      faces.push({
        mipmaps,
        width: data.width,
        height: data.height,
        format: data.format,
      });
    }
    // three types the `images` param as CompressedTexture[], but the loader really
    // passes these lightweight face records (mipmaps + dimensions + format).
    const tex = new THREE.CompressedCubeTexture(
      faces as unknown as THREE.CompressedTexture[],
      data.format as THREE.CompressedPixelFormat,
      THREE.UnsignedByteType,
    );
    // No mip chain in the file — don't ask the sampler for levels that don't exist.
    if (data.mipmapCount === 1) tex.minFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}

/** Longest side requested from `mc_image_info` for each map. The heightmap needs
 * enough samples to displace with relief; the colour can be a touch crisper. */
const HEIGHT_MAX = 1024;
const TEXTURE_MAX = 2048;
/** Plane subdivisions. ~524k tris — still cheap, and the ≤1024px heightmap is the
 * real detail bound, so more segments wouldn't show. */
const SEGMENTS = 512;
/** Samples a height grid is decimated to on each axis before it becomes a
 * texture. The mesh has this many vertices a side, so horizontal detail past it
 * cannot be drawn, and a 2049 sample grid held at full resolution in floats
 * would be 16 MB rather than the 1 MB this is (issue #1730). */
const GRID_MAX = SEGMENTS + 1;
/** Far coarser grid for the wireframe render: at the full `SEGMENTS` the edges
 * merge into a solid fill, so a visible mesh grid needs a low subdivision. Relief
 * still comes from the per-vertex `displacementMap`, just sampled more coarsely. */
const WIRE_SEGMENTS = 70;
/** Horizontal extent the longer map side is normalised to, keeping scene
 * coordinates friendly regardless of true map size. Height is scaled by the
 * same factor, so vertical proportions stay physically correct. */
const BASE = 100;
/** How many times the detail texture repeats across the map's longest side, and
 * how strongly it modulates the base colour (0 = off, 1 = full engine-style
 * `detail * 2` multiply). Emulates the engine's tiled detail texture that hides
 * base-texture blur on close zoom. */
const DETAIL_TILES = 40;
const DETAIL_STRENGTH = 0.7;
/** Water plane subdivisions — dense enough to resolve fine animated ripple
 * normals without aliasing (the preview is viewed from a height, so ripples read
 * as many small crests, not a few large waves). */
const WATER_SEG = 240;
/** Directional ripple waves, each `[angleRad, freq, amp, speed]`. Odd angles and
 * incommensurate frequencies (no axis/45° alignment, no harmonic ratios) so the
 * summed surface reads as irregular chop rather than repeating bands. Kept fine
 * and short so they distort the reflection into small glints, not large blobs. */
const RIPPLE_WAVES: [number, number, number, number][] = [
  [0.35, 3.1, 0.8, 1.3],
  [1.25, 4.6, 0.6, 1.6],
  [2.35, 5.9, 0.45, 1.05],
  [3.35, 6.6, 0.35, 2.1],
];

type Srcs = { height: string | null; texture: string | null };

/**
 * The map's own heights as a displacement texture.
 *
 * Float rather than half float: half carries about 11 bits of mantissa, which
 * is a smaller version of the eight bit problem this exists to fix. WebGL2 does
 * not filter float textures without `OES_texture_float_linear`, so a context
 * without it samples nearest rather than silently drawing nothing.
 */
function heightWordsTexture(
  grid: HeightWords,
  renderer: THREE.WebGLRenderer,
): THREE.DataTexture {
  const { data, width, height } = decimateHeights(grid, GRID_MAX);
  const tex = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RedFormat,
    THREE.FloatType,
  );
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  const smooth = renderer.extensions.has("OES_texture_float_linear");
  tex.minFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  tex.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A built scene, handed to a view that has its own content to put on the map.
 *
 * The preview owns the terrain, the water, the sky and the lights. A view that
 * wants more than that, such as the scenario editor's units, zones and paths,
 * adds its objects to `scene`, calls `render` after each change, and is free to
 * retune `camera` and `controls` for its own way of working.
 *
 * Scene space is not engine space. The map's longer side is normalised to a
 * fixed extent, so `scale` is the scene units one engine world unit (elmo)
 * takes, and the terrain spans `planeWidth` by `planeDepth` centred on the
 * origin, lying in XZ with height along +Y.
 */
export interface MapScene3D {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  /** Draw one frame. Call after mutating anything in the scene. */
  render: () => void;
  /** Scene units per engine world unit. */
  scale: number;
  /** Terrain extent in scene units. */
  planeWidth: number;
  planeDepth: number;
}

/**
 * A small 3D terrain preview: the heightmap drives vertex displacement and the
 * diffuse texture is draped over it. Vertical scale is physically correct — it
 * comes from the same `minHeight`/`maxHeight` the compile uses, so a flat height
 * range renders as flat terrain (no exaggeration). Optional flat water plane at
 * world height 0 and a wireframe toggle. Orbit/zoom via the mouse.
 *
 * Both maps are fetched through `mc_image_info` (downscaled server-side to a
 * data URL), so even an 8192² source stays light.
 */
export function MapPreview3D({
  heightmapPath,
  texturePath,
  heightSrc,
  heightWords,
  heightRange,
  textureSrc,
  detailSrc,
  minHeight,
  maxHeight,
  worldWidth,
  worldHeight,
  appearance,
  skyboxSrc,
  className,
  autoSpin,
  interactive = true,
  chrome = true,
  framed = true,
  showSky = true,
  showClouds = true,
  forceWireframe = false,
  enableZoom = true,
  enablePan = true,
  initialWater,
  onScene,
}: {
  /** File path to the heightmap image (mapconv flow); resolved via `mc_image_info`. */
  heightmapPath?: string;
  /** File path to the colour/texture image (mapconv flow). */
  texturePath?: string;
  /** Pre-resolved heightmap source (data URL); used instead of `heightmapPath`. */
  heightSrc?: string;
  /** Pre-resolved colour source (data URL); used instead of `texturePath`. */
  textureSrc?: string;
  /** Optional detail-texture source (data URL) — the map's own `detailtex` when
   * it ships one; otherwise a generic procedural detail texture is used. */
  detailSrc?: string;
  /**
   * The map's own 16 bit heights, displaced from directly (issue #1730).
   *
   * Preferred over every picture when it is here, because a picture of a
   * heightmap is eight bits deep however it was stored, so gentle slopes
   * collapse into flat steps that shading turns into contour rings. A surface
   * that only draws terrain at a few hundred pixels leaves this out and takes
   * the picture, which is a fraction of the bytes and shows the same thing at
   * that size.
   */
  heightWords?: HeightWords | null;
  /**
   * What the height texture's 0 and 1 stand for in engine world units, when
   * that is not the map's own `minHeight` and `maxHeight`.
   *
   * The unitsync height picture is rescaled into the window its own samples
   * occupy, so displacing it by the map's pair would flatten every map whose
   * heights do not reach both ends of the 16 bit scale. Ignored when
   * `heightWords` is set, since those are already on the map's own scale.
   */
  heightRange?: { min: number; max: number };
  minHeight: number;
  maxHeight: number;
  worldWidth: number;
  worldHeight: number;
  /** Optional `mapinfo.lua` hints — water colour/visibility, sky, sun. */
  appearance?: MapAppearance | null;
  /** Optional `data:` URL of a skybox DDS cube map (`atmosphere.skyBox`). When it
   * is a cube map it becomes the sky (and the water's reflection); otherwise the
   * flat `skyColor` sky is kept. */
  skyboxSrc?: string | null;
  className?: string;
  /** Continuous auto-orbit as an `OrbitControls.autoRotateSpeed` multiplier
   * (1 = default). Undefined / 0 = no spin. Disabled under `prefers-reduced-motion`. */
  autoSpin?: number;
  /** Allow pointer orbit/zoom. When false the scene is a non-interactive backdrop
   * (auto-spin still advances). Default true. */
  interactive?: boolean;
  /** Render the surrounding UI chrome (fullscreen button, Water/Wireframe panel,
   * caption). Default true; false for the embedded mission slots. */
  chrome?: boolean;
  /** Render the default bordered/aspect container. When false the canvas fills its
   * parent (no border/rounded/aspect). Default true. */
  framed?: boolean;
  /** Draw the sky (skybox / `skyColor`) as the background. When false the canvas
   * stays transparent so it layers over whatever is behind it. Default true. */
  showSky?: boolean;
  /** Draw the high-overcast cloud plane (only when the map defines `cloudColor`).
   * Default true; pass false for the mission previews, which never want clouds.
   * Wireframe renders never draw clouds regardless. */
  showClouds?: boolean;
  /** Wireframe relief render — the displaced mesh is drawn as an unlit uniform-colour
   * grid with no diffuse texture, so it needs only the heightmap. Default false. */
  forceWireframe?: boolean;
  /** Allow dolly/zoom. Default true; false for a fixed-frame preview. */
  enableZoom?: boolean;
  /** Allow panning. Default true; false to lock the target (rotate-only). */
  enablePan?: boolean;
  /** Seed the water toggle explicitly (used when the chrome is hidden); undefined
   * falls back to the map's own water heuristic (and to "no water" for wireframe). */
  initialWater?: boolean;
  /** Handed the built scene so a view can add its own content to the map and
   * retune the camera. Called with null when that scene is torn down, which is
   * the point at which anything the view added is already gone. Changing the
   * callback does not rebuild the scene. The latest one is always the one
   * called. */
  onScene?: (handle: MapScene3D | null) => void;
}) {
  // Setting-aware reduce-motion (General settings -> Motion & effects), which
  // itself follows the OS preference in its default "system" mode.
  const reduceMotion = useReduceMotion();
  const [srcs, setSrcs] = useState<Srcs | null>(null);
  // True once the three.js scene is actually on screen. Drives the "building"
  // overlay so it stays up through both the image fetch and the build (and while
  // waiting on dimensions), rather than vanishing the moment the data lands.
  const [built, setBuilt] = useState(false);
  const [failed, setFailed] = useState(false);
  const [water, setWater] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // Set by the scene effect; the toggle effects mutate through them.
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const waterRef = useRef<THREE.Mesh | null>(null);
  const renderRef = useRef<(() => void) | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  // Read at hand-over and hand-back time rather than captured by the build, so a
  // caller passing an inline callback neither rebuilds the scene nor gets a
  // stale closure back.
  const onSceneRef = useRef(onScene);
  onSceneRef.current = onScene;
  // Mirror current toggle state so a freshly (re)built scene starts consistent.
  const wantWater = useRef(water);
  wantWater.current = water;
  const wantWire = useRef(wireframe);
  wantWire.current = wireframe;
  // Stable signature of the appearance fields baked into the scene, so the build
  // effect rebuilds when they change (the prop's object identity does not).
  const appSig = JSON.stringify([
    appearance?.waterColor,
    appearance?.waterAlpha,
    appearance?.skyColor,
    appearance?.sunDir,
    appearance?.sunColor,
    appearance?.voidWater,
    appearance?.fogColor,
    appearance?.cloudColor,
    appearance?.cloudDensity,
    appearance?.groundAmbientColor,
    appearance?.waterAbsorb,
    appearance?.waterBaseColor,
    appearance?.waterMinColor,
    skyboxSrc,
  ]);

  // Fetch both maps as downscaled data URLs whenever the inputs change. When
  // pre-resolved sources are supplied (the content flow already has downscaled
  // data URLs), use them directly and skip the file-path fetch.
  //
  // A caller that handed over the map's own words needs no height picture at
  // all, so the relief is ready as soon as the colour is.
  useEffect(() => {
    let cancelled = false;
    setSrcs(null);
    setFailed(false);
    const height = heightWords ? null : (heightSrc ?? null);
    const haveRelief = !!heightWords || !!height;
    // A wireframe render uses no diffuse texture, so it builds from the relief
    // alone and needn't wait on the minimap fetch.
    if (forceWireframe && haveRelief) {
      setSrcs({ height, texture: null });
      return;
    }
    if (haveRelief && textureSrc) {
      setSrcs({ height, texture: textureSrc });
      return;
    }
    if (heightWords && texturePath) {
      getImageInfo(texturePath, TEXTURE_MAX)
        .then((t) => {
          if (!cancelled) setSrcs({ height: null, texture: t.thumb });
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
      return () => {
        cancelled = true;
      };
    }
    if (!heightmapPath || !texturePath) return;
    Promise.all([
      getImageInfo(heightmapPath, HEIGHT_MAX),
      getImageInfo(texturePath, TEXTURE_MAX),
    ])
      .then(([h, t]) => {
        if (!cancelled) setSrcs({ height: h.thumb, texture: t.thumb });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [
    heightmapPath,
    texturePath,
    heightSrc,
    heightWords,
    textureSrc,
    forceWireframe,
  ]);

  // Build the three.js scene from the loaded maps + dimensions. Fully torn down
  // on any dependency change or unmount, so navigating away leaks no GL context.
  useCanvas3D(
    containerRef,
    ({ renderer, resize: fitCanvas }) => {
      if (!srcs || worldWidth <= 0 || worldHeight <= 0) return;

      let cancelled = false;
      const disposables: { dispose(): void }[] = [];
      let controls: OrbitControls | undefined;
      let fitCamera: ((width: number, height: number) => void) | undefined;
      let animationFrame: number | undefined;
      let spinStart: (() => void) | undefined;
      let spinEnd: (() => void) | undefined;
      let handedOver = false;

      const longest = Math.max(worldWidth, worldHeight);
      const s = BASE / longest;
      const planeW = worldWidth * s;
      const planeH = worldHeight * s;
      // What the height texture's 0 and 1 mean. The map's own words are already
      // on the map's scale. A picture of them may have been rescaled into a
      // narrower window and carries its own pair (issue #1730).
      const reliefMin = heightWords
        ? minHeight
        : (heightRange?.min ?? minHeight);
      const reliefMax = heightWords
        ? maxHeight
        : (heightRange?.max ?? maxHeight);

      (async () => {
        const loader = new THREE.TextureLoader();
        let colorTex: THREE.Texture | null = null;
        let heightTex: THREE.Texture;
        try {
          // The map's own words when the caller has them, else its picture.
          const [color, height] = await Promise.all([
            srcs.texture ? loader.loadAsync(srcs.texture) : null,
            srcs.height ? loader.loadAsync(srcs.height) : null,
          ]);
          colorTex = color;
          if (height) {
            heightTex = height;
          } else if (heightWords) {
            heightTex = heightWordsTexture(heightWords, renderer);
          } else {
            throw new Error("no relief to displace the terrain with");
          }
        } catch {
          if (!cancelled) setFailed(true);
          return;
        }
        if (cancelled) {
          colorTex?.dispose();
          heightTex?.dispose();
          return;
        }
        if (colorTex) {
          colorTex.colorSpace = THREE.SRGBColorSpace;
          disposables.push(colorTex);
        }
        heightTex.colorSpace = THREE.NoColorSpace;
        disposables.push(heightTex);

        // Detail texture: the map's own `detailtex` (data URL) when supplied, else a
        // generic procedural one. Tiled and multiplied over the base colour below to
        // break up the low-res base texture's blur when zoomed in.
        let detailTex: THREE.Texture;
        if (detailSrc) {
          try {
            detailTex = await loader.loadAsync(detailSrc);
            detailTex.wrapS = THREE.RepeatWrapping;
            detailTex.wrapT = THREE.RepeatWrapping;
          } catch {
            detailTex = makeProceduralDetail();
          }
        } else {
          detailTex = makeProceduralDetail();
        }
        if (cancelled) {
          detailTex.dispose();
          return;
        }
        detailTex.colorSpace = THREE.NoColorSpace;
        disposables.push(detailTex);

        const scene = new THREE.Scene();
        // Sky colour from mapinfo becomes the backdrop; otherwise stay transparent
        // so the card background shows through. `showSky=false` keeps it transparent
        // regardless, so the canvas layers over whatever is behind it.
        if (showSky && appearance?.skyColor)
          scene.background = colorFrom(appearance.skyColor, 0);

        // If the map declares a skybox DDS, decode it and (when it's a cube map) use
        // it as the sky, replacing the flat colour. Done before the water reflection
        // capture below so the water mirrors the real sky. Any failure — a fetch/parse
        // error, an unsupported DDS variant (DX10/BC7 fail in DDSLoader), or a
        // non-cubemap DDS — silently falls back to the flat `skyColor` sky.
        if (showSky && skyboxSrc) {
          const cube = await loadSkyboxCube(skyboxSrc);
          if (cancelled) {
            cube?.dispose();
            return;
          }
          if (cube) {
            scene.background = cube;
            disposables.push(cube);
          }
        }

        const segments = forceWireframe ? WIRE_SEGMENTS : SEGMENTS;
        const geo = new THREE.PlaneGeometry(planeW, planeH, segments, segments);
        geo.rotateX(-Math.PI / 2); // lie flat in XZ; displacement then runs along +Y
        disposables.push(geo);

        // `voidWater` maps (asteroid/space) render nothing below the sea plane: the
        // engine shows the skybox through it. Emulate that by clipping the terrain at
        // world y = 0 (keep y >= 0), so submerged geometry is discarded rather than
        // drawn as solid ground. Clipping is opt-in per material via `clippingPlanes`
        // + `renderer.localClippingEnabled`, set on the shared canvas below.
        const voidWater = appearance?.voidWater === true;
        const voidClip = voidWater
          ? [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)]
          : undefined;

        // A wireframe relief drops the diffuse texture entirely and draws the mesh as
        // an unlit uniform-colour grid, so the displaced geometry reads as the terrain
        // shape on its own.
        const material = new THREE.MeshStandardMaterial({
          map: forceWireframe ? undefined : (colorTex ?? undefined),
          color: forceWireframe ? 0x8fb3c9 : 0xffffff,
          displacementMap: heightTex,
          displacementScale: (reliefMax - reliefMin) * s,
          displacementBias: reliefMin * s,
          roughness: 1,
          metalness: 0,
          wireframe: forceWireframe || wantWire.current,
          clippingPlanes: voidClip,
        });
        // Tiled detail-texture multiply, patched into the standard material: after
        // the base colour is sampled, modulate it by the detail texture sampled at a
        // higher tiling frequency. `detail * 2` centres neutral at mid-grey (engine
        // convention); `detailStrength` fades the whole effect. Skipped for the
        // wireframe render, which has no diffuse to modulate.
        if (!forceWireframe && colorTex)
          material.onBeforeCompile = (shader) => {
            shader.uniforms.detailMap = { value: detailTex };
            shader.uniforms.detailRepeat = {
              value: new THREE.Vector2(
                (DETAIL_TILES * planeW) / BASE,
                (DETAIL_TILES * planeH) / BASE,
              ),
            };
            shader.uniforms.detailStrength = { value: DETAIL_STRENGTH };
            shader.fragmentShader = shader.fragmentShader
              .replace(
                "#include <common>",
                `#include <common>
uniform sampler2D detailMap;
uniform vec2 detailRepeat;
uniform float detailStrength;`,
              )
              .replace(
                "#include <map_fragment>",
                `#include <map_fragment>
{
  vec3 detail = texture2D( detailMap, vMapUv * detailRepeat ).rgb;
  diffuseColor.rgb *= mix( vec3( 1.0 ), detail * 2.0, detailStrength );
}`,
              );
          };
        disposables.push(material);
        materialRef.current = material;
        scene.add(new THREE.Mesh(geo, material));

        // Translucent water plane at world height 0 (== scene y 0). Subdivided so
        // the animation loop below can ripple its surface.
        const waterGeo = new THREE.PlaneGeometry(
          planeW,
          planeH,
          WATER_SEG,
          WATER_SEG,
        );
        waterGeo.rotateX(-Math.PI / 2);
        const waterMat = new THREE.MeshStandardMaterial({
          color: colorFrom(appearance?.waterColor, 0x2f6f9f),
          transparent: true,
          opacity: appearance?.waterAlpha ?? 0.55,
          // Low roughness + the scene environment map (set below) make the surface
          // glossy and mirror-like, so it reads as reflective water rather than a
          // matte sheet; the ripple normals then distort that reflection.
          roughness: 0.1,
          metalness: 0,
          envMapIntensity: 0.1,
        });
        // Depth-based water colouring (`water.absorb`/`baseColor`/`minColor`): sample
        // the terrain heightmap under each water fragment to get its depth below the
        // sea plane, then attenuate from `baseColor` (shallow) toward `minColor` (deep)
        // by `exp(-absorb * depth)` — the engine's Beer-Lambert-style absorption, so
        // shallows read bright and deeps read murky instead of a flat tinted sheet.
        // Depth is in engine world units (elmos, unscaled), which is how `absorb` is
        // calibrated; the surface reflection is layered on top unchanged. Only enabled
        // when the map specifies `absorb`; otherwise the flat `waterColor` stands.
        if (appearance?.waterAbsorb) {
          const ab = appearance.waterAbsorb;
          const base = colorFrom(
            appearance.waterBaseColor ?? appearance.waterColor,
            0x2f6f9f,
          );
          const min = appearance.waterMinColor
            ? colorFrom(appearance.waterMinColor, 0)
            : base.clone().multiplyScalar(0.2);
          waterMat.onBeforeCompile = (shader) => {
            shader.uniforms.wHeightTex = { value: heightTex };
            shader.uniforms.wAbsorb = {
              value: new THREE.Vector3(ab[0], ab[1], ab[2]),
            };
            shader.uniforms.wBase = { value: base };
            shader.uniforms.wMin = { value: min };
            shader.uniforms.wHeightScale = { value: reliefMax - reliefMin };
            shader.uniforms.wHeightBias = { value: reliefMin };
            shader.uniforms.wPlane = {
              value: new THREE.Vector2(planeW, planeH),
            };
            shader.vertexShader = shader.vertexShader
              .replace(
                "#include <common>",
                "#include <common>\nvarying vec3 vWaterPos;",
              )
              .replace(
                "#include <project_vertex>",
                "#include <project_vertex>\nvWaterPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;",
              );
            shader.fragmentShader = shader.fragmentShader
              .replace(
                "#include <common>",
                `#include <common>
varying vec3 vWaterPos;
uniform sampler2D wHeightTex;
uniform vec3 wAbsorb;
uniform vec3 wBase;
uniform vec3 wMin;
uniform float wHeightScale;
uniform float wHeightBias;
uniform vec2 wPlane;`,
              )
              .replace(
                "#include <map_fragment>",
                `#include <map_fragment>
{
  vec2 wuv = vec2( 0.5 + vWaterPos.x / wPlane.x, 0.5 - vWaterPos.z / wPlane.y );
  float nh = texture2D( wHeightTex, wuv ).x;
  float depth = max( 0.0, -( nh * wHeightScale + wHeightBias ) );
  diffuseColor.rgb = mix( wMin, wBase, exp( -wAbsorb * depth ) );
}`,
              );
          };
        }
        disposables.push(waterGeo, waterMat);
        const waterMesh = new THREE.Mesh(waterGeo, waterMat);
        waterMesh.visible = wantWater.current;
        waterRef.current = waterMesh;
        scene.add(waterMesh);

        // Ambient fill tinted by the map's ground ambient colour (its non-sun-lit
        // mood); defaults to neutral white when the map doesn't specify one.
        scene.add(
          new THREE.AmbientLight(
            colorFrom(appearance?.groundAmbientColor, 0xffffff),
            0.8,
          ),
        );
        const sun = new THREE.DirectionalLight(
          colorFrom(appearance?.sunColor, 0xffffff),
          2.2,
        );
        const sd = appearance?.sunDir;
        // Light from the map's sun direction (clamp Y so it never lights from
        // below); otherwise a sensible default raking angle.
        if (sd)
          sun.position
            .set(sd[0], Math.max(sd[1], 0.2), sd[2])
            .multiplyScalar(BASE);
        else sun.position.set(BASE * 0.5, BASE * 0.9, BASE * 0.35);
        scene.add(sun);

        // Optional high overcast from `atmosphere.cloudColor`/`cloudDensity`: a faint
        // translucent plane above the terrain, tinted by the cloud colour with
        // opacity scaled by density. Held above the camera's reach so it never comes
        // between the eye and the map (see the height below). Suppressed for wireframe
        // relief and wherever the caller opts out (`showClouds`, e.g. mission previews).
        // It drifts in the animation loop below (static under reduced motion).
        let cloudTex: THREE.Texture | undefined;
        const hasClouds =
          !!appearance?.cloudColor && showClouds && !forceWireframe;
        if (hasClouds) {
          cloudTex = makeProceduralCloud();
          cloudTex.repeat.set(2, 2);
          const cloudMat = new THREE.MeshBasicMaterial({
            color: colorFrom(appearance?.cloudColor, 0xffffff),
            map: cloudTex,
            transparent: true,
            opacity: Math.min(0.35, (appearance?.cloudDensity ?? 0.5) * 0.5),
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: false,
          });
          const cloudGeo = new THREE.PlaneGeometry(planeW * 2, planeH * 2);
          cloudGeo.rotateX(-Math.PI / 2);
          const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
          // Above the camera's max orbit distance (`maxDistance` is BASE * 3) so a
          // top-down / zoomed-out view stays under the clouds — they read as a high
          // ceiling, never a sheet drawn over the map.
          cloudMesh.position.y = Math.max(maxHeight * s, 0) + BASE * 3.5;
          scene.add(cloudMesh);
          disposables.push(cloudGeo, cloudMat, cloudTex);
        }

        renderer.localClippingEnabled = voidWater; // honour the terrain clip plane
        renderer.setClearColor(0x000000, 0); // transparent; the card shows through
        // Capture the terrain + sky into a prefiltered environment map once, so the
        // water reflects the actual islands and sky (image-based reflection). The
        // water is hidden during the capture and, if the map has no sky colour, a
        // neutral sky is used just for the reflection so glossy water isn't mirror-
        // black. Static (not re-rendered on orbit) — a good approximation for a
        // slowly-orbited preview, and far cheaper than live planar reflections.
        // Applied to the water material only (not `scene.environment`), so it never
        // adds image-based light to the terrain — that must match the flat minimap.
        const pmrem = new THREE.PMREMGenerator(renderer);
        const prevBg = scene.background;
        if (!prevBg) scene.background = new THREE.Color(0x9fb8cc);
        waterMesh.visible = false;
        const envRT = pmrem.fromScene(scene, 0, 0.1, 1000);
        scene.background = prevBg;
        waterMesh.visible = wantWater.current;
        waterMat.envMap = envRT.texture;
        waterMat.needsUpdate = true;
        pmrem.dispose();
        disposables.push(envRT);
        // Distance fog for maps that declare `atmosphere.fogColor`. Distances are
        // approximate — mapinfo expresses fogStart/fogEnd as fractions of the engine's
        // viewRange, which a standalone preview lacks, so they're derived from the
        // fixed scene scale. Attached only after the reflection capture above, so it
        // never tints the water's environment map.
        if (appearance?.fogColor)
          scene.fog = new THREE.Fog(
            colorFrom(appearance.fogColor, 0xb3b3cc),
            BASE * 0.6,
            BASE * 2.8,
          );

        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
        camera.position.set(0, BASE * 0.7, BASE * 1.0);
        // The canvas is sized from the moment it exists. The camera is the one
        // thing that arrives after the build, so it catches up here.
        fitCamera = (width, height) => {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = false;
        controls.target.set(0, 0, 0);
        controls.minDistance = BASE * 0.12;
        controls.maxDistance = BASE * 3;
        controls.maxPolarAngle = Math.PI * 0.49;
        controls.enableZoom = enableZoom;
        controls.enablePan = enablePan;
        if (interactive) {
          // Zoom toward the cursor (not the scene centre) and pan with the middle
          // button; orbit stays on the left. Clamp the dolly range and keep the
          // camera above the map plane so you can't zoom through the terrain or
          // drop underneath it.
          controls.zoomToCursor = true;
          controls.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.PAN,
          };
        } else {
          // Non-interactive backdrop: no pointer input, but `update()` still advances
          // the auto-orbit from the animation loop below.
          controls.enabled = false;
        }
        // Auto-orbit (disabled under reduced motion). `wantSpin` also gates the
        // pause-on-drag listeners so an interactive slot resumes spinning on release.
        // A signed `autoSpin` also picks the direction: a negative value reverses the
        // orbit via a negative `autoRotateSpeed`.
        const wantSpin = autoSpin != null && autoSpin !== 0 && !reduceMotion;
        controls.autoRotate = wantSpin;
        controls.autoRotateSpeed = 2.0 * (autoSpin ?? 1);
        controlsRef.current = controls;
        if (wantSpin && interactive) {
          spinStart = () => {
            if (controls) controls.autoRotate = false;
          };
          spinEnd = () => {
            if (controls) controls.autoRotate = true;
          };
          controls.addEventListener("start", spinStart);
          controls.addEventListener("end", spinEnd);
        }

        // Keep the camera above the terrain's highest point (peak displaced Y is
        // `maxHeight * s`), with a small margin. OrbitControls' distance/angle
        // clamps are relative to the moving zoom-to-cursor target and can't see
        // the surface, so this hard Y floor is what actually stops you zooming
        // under the map. Never below the water plane at y 0.
        const camFloor = Math.max(maxHeight * s, 0) + BASE * 0.02;
        const render = () => {
          if (camera.position.y < camFloor) camera.position.y = camFloor;
          renderer.render(scene, camera);
        };
        renderRef.current = render;
        controls.addEventListener("change", render);

        // Animated water ripples. The scene otherwise renders on demand (orbit /
        // resize / toggle); this is the only continuous loop, and it runs only
        // while the water is visible so a dry map or a hidden plane stays idle.
        // Ripples are driven mostly by the surface NORMALS, not geometry: a layered
        // high-frequency wave field's analytic slope (`dx`/`dz`) tilts each vertex
        // normal so the ripples catch the directional light, while the actual Y
        // displacement stays a hair (`dispAmp`). Decoupling the two lets the ripples
        // be dense and fine without crests poking up through terrain that sits near
        // the water line. Skipped under `prefers-reduced-motion`, leaving it flat.
        const waterPos = waterGeo.attributes.position;
        const waterNor = waterGeo.attributes.normal;
        const dispAmp = BASE * 0.0004;
        const slope = 0.012; // normal-tilt strength (independent of wave height)
        // Per-wave phase gradients, constant across the animation: WX/WZ are the
        // x/z components of the direction × frequency; AKX/AKZ fold in amplitude
        // for the analytic normal slope.
        const wn = RIPPLE_WAVES.length;
        const wWX = new Float64Array(wn);
        const wWZ = new Float64Array(wn);
        const wAmp = new Float64Array(wn);
        const wSpd = new Float64Array(wn);
        const wAKX = new Float64Array(wn);
        const wAKZ = new Float64Array(wn);
        for (let j = 0; j < wn; j++) {
          const [ang, freq, amp, spd] = RIPPLE_WAVES[j];
          const wx = Math.cos(ang) * freq;
          const wz = Math.sin(ang) * freq;
          wWX[j] = wx;
          wWZ[j] = wz;
          wAmp[j] = amp;
          wSpd[j] = spd;
          wAKX[j] = amp * wx;
          wAKZ[j] = amp * wz;
        }
        const tmpN = new THREE.Vector3();
        const rippleWater = (t: number) => {
          for (let i = 0; i < waterPos.count; i++) {
            const x = waterPos.getX(i);
            const z = waterPos.getZ(i);
            let h = 0;
            let dx = 0;
            let dz = 0;
            for (let j = 0; j < wn; j++) {
              const ph = wWX[j] * x + wWZ[j] * z + wSpd[j] * t;
              const c = Math.cos(ph);
              h += wAmp[j] * Math.sin(ph);
              dx += wAKX[j] * c;
              dz += wAKZ[j] * c;
            }
            waterPos.setY(i, h * dispAmp);
            tmpN.set(-dx * slope, 1, -dz * slope).normalize();
            waterNor.setXYZ(i, tmpN.x, tmpN.y, tmpN.z);
          }
          waterPos.needsUpdate = true;
          waterNor.needsUpdate = true;
        };
        // One continuous loop drives both the ripples and the auto-orbit; it idles
        // (renders nothing) whenever neither is active, so a static, dry, non-spinning
        // preview stays on-demand. `controls.autoRotate` is read live so the editor's
        // spin-speed changes and the pause-on-drag listeners take effect without a
        // rebuild. Skipped entirely under `prefers-reduced-motion`.
        if (!reduceMotion) {
          const animate = () => {
            animationFrame = requestAnimationFrame(animate);
            const spinning = !!controls?.autoRotate;
            const waterVisible = !!waterRef.current?.visible;
            if (!spinning && !waterVisible && !cloudTex) return;
            if (waterVisible) rippleWater(performance.now() / 1000);
            // Drift the overcast slowly across the sky.
            if (cloudTex) {
              cloudTex.offset.x += 0.00002;
              cloudTex.offset.y += 0.00001;
            }
            // `update()` advances the orbit and fires "change" → render(); a
            // water- or cloud-only frame renders directly.
            if (spinning) controls?.update();
            else render();
          };
          animationFrame = requestAnimationFrame(animate);
        }

        fitCanvas();
        if (cancelled) return;
        // Hand the finished scene to whoever wants to put their own content on
        // it. After the canvas fit, so the camera it may retune already has the
        // right aspect.
        if (onSceneRef.current) {
          handedOver = true;
          onSceneRef.current({
            scene,
            camera,
            controls,
            renderer,
            render,
            scale: s,
            planeWidth: planeW,
            planeDepth: planeH,
          });
        }
        setBuilt(true);
      })();

      return {
        render: () => renderRef.current?.(),
        resize: (width, height) => fitCamera?.(width, height),
        dispose: () => {
          cancelled = true;
          setBuilt(false);
          // Withdraw the scene first, so a view drops its references to objects
          // that are about to be disposed below.
          if (handedOver) onSceneRef.current?.(null);
          if (animationFrame !== undefined)
            cancelAnimationFrame(animationFrame);
          if (controls) {
            if (renderRef.current)
              controls.removeEventListener("change", renderRef.current);
            if (spinStart) controls.removeEventListener("start", spinStart);
            if (spinEnd) controls.removeEventListener("end", spinEnd);
            controls.dispose();
          }
          for (const d of disposables) d.dispose();
          materialRef.current = null;
          waterRef.current = null;
          renderRef.current = null;
          controlsRef.current = null;
        },
      };
    },
    // `appearance` is tracked through the stable `appSig`. `autoSpin` and
    // `initialWater` are applied live below, so they seed the build without
    // forcing a rebuild.
    [
      srcs,
      heightWords,
      heightRange?.min,
      heightRange?.max,
      detailSrc,
      minHeight,
      maxHeight,
      worldWidth,
      worldHeight,
      appSig,
      skyboxSrc,
      forceWireframe,
      showSky,
      interactive,
      enableZoom,
      enablePan,
      reduceMotion,
    ],
  );

  // Spring's water plane sits at world height 0, so water is only visible where
  // terrain drops below it. Default the toggle off for a "dry" map (lowest point
  // at or above sea level) or one the mapinfo declares `voidWater` — a water plane
  // under entirely-above-water terrain just looks wrong. The user can still switch
  // it back on. Resets on map change (minHeight / voidWater are the deps).
  const hasWater =
    appearance?.voidWater !== true &&
    appearance?.forceRendering !== false &&
    minHeight < 0;
  // A wireframe render defaults to no water plane (a solid sheet under a bare mesh
  // reads oddly); an explicit `initialWater` still wins.
  const resolvedWater = initialWater ?? (forceWireframe ? false : hasWater);
  useEffect(() => {
    setWater(resolvedWater);
  }, [resolvedWater]);

  // Apply spin-speed changes to a live scene without rebuilding it (the editor's
  // slider), and keep the reduce-motion preference authoritative.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const wantSpin = autoSpin != null && autoSpin !== 0 && !reduceMotion;
    controls.autoRotate = wantSpin;
    controls.autoRotateSpeed = 2.0 * (autoSpin ?? 1);
    renderRef.current?.();
  }, [autoSpin, reduceMotion]);

  // Live toggles — mutate the existing scene, no rebuild. `forceWireframe` always
  // wins so the mission heightmap slot can't be switched to solid.
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.wireframe = forceWireframe || wireframe;
      renderRef.current?.();
    }
  }, [wireframe, forceWireframe]);
  useEffect(() => {
    if (waterRef.current) {
      waterRef.current.visible = water;
      renderRef.current?.();
    }
  }, [water]);

  // Esc leaves fullscreen.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  if (failed) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ImageOff size={13} /> 3D preview unavailable.
      </p>
    );
  }

  return (
    <div
      className={
        expanded
          ? "fixed inset-0 z-50 overflow-hidden bg-background"
          : cn(
              framed
                ? "relative aspect-[16/10] max-h-[32rem] w-full overflow-hidden rounded-md border border-border bg-gradient-to-b from-muted/20 to-muted/40"
                : "relative h-full w-full overflow-hidden",
              className,
            )
      }
    >
      <div ref={containerRef} className="absolute inset-0" />

      {chrome && built && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? "Exit fullscreen" : "Fullscreen preview"}
          className="absolute left-2 top-2 flex items-center justify-center rounded-md border border-border bg-card/80 p-2 text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
        >
          {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      )}

      {!built && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={22} className="animate-spin opacity-40" />
          {srcs ? "Building 3D preview…" : "Loading map preview…"}
        </div>
      )}

      {chrome && built && (
        <>
          <div className="absolute right-2 top-2 flex flex-col gap-1.5 rounded-md border border-border bg-card/80 px-2.5 py-2 text-xs backdrop-blur">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Checkbox> control (implicit label association) */}
            <label className="flex items-center gap-2">
              <Checkbox
                checked={water}
                onCheckedChange={(v) => setWater(v === true)}
              />
              Water
            </label>
            {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Checkbox> control (implicit label association) */}
            <label className="flex items-center gap-2">
              <Checkbox
                checked={wireframe}
                onCheckedChange={(v) => setWireframe(v === true)}
              />
              Wireframe
            </label>
          </div>
          <p className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-card/70 px-2 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur">
            <Box size={12} /> height {minHeight} → {maxHeight} · drag to orbit
          </p>
        </>
      )}
    </div>
  );
}
