import { cn } from "@picoframe/frame";
import { Box, ImageOff, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";
import { Checkbox } from "@/components/ui/checkbox";
import type { MapAppearance } from "../../bindings";
import { getImageInfo } from "../../imageCache";

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

type Srcs = { height: string; texture: string };

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
  textureSrc,
  detailSrc,
  minHeight,
  maxHeight,
  worldWidth,
  worldHeight,
  appearance,
  skyboxSrc,
  className,
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
}) {
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
    skyboxSrc,
  ]);

  // Fetch both maps as downscaled data URLs whenever the inputs change. When
  // pre-resolved sources are supplied (the content flow already has downscaled
  // data URLs), use them directly and skip the file-path fetch.
  useEffect(() => {
    let cancelled = false;
    setSrcs(null);
    setFailed(false);
    if (heightSrc && textureSrc) {
      setSrcs({ height: heightSrc, texture: textureSrc });
      return;
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
  }, [heightmapPath, texturePath, heightSrc, textureSrc]);

  // Build the three.js scene from the loaded maps + dimensions. Fully torn down
  // on any dependency change or unmount, so navigating away leaks no GL context.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `appearance` is read in the build but tracked via the stable `appSig` (its object identity changes every render)
  useEffect(() => {
    const container = containerRef.current;
    if (!srcs || !container || worldWidth <= 0 || worldHeight <= 0) return;

    let cancelled = false;
    const disposables: { dispose(): void }[] = [];
    let renderer: THREE.WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let observer: ResizeObserver | undefined;
    let animationFrame: number | undefined;

    const longest = Math.max(worldWidth, worldHeight);
    const s = BASE / longest;
    const planeW = worldWidth * s;
    const planeH = worldHeight * s;

    (async () => {
      const loader = new THREE.TextureLoader();
      let colorTex: THREE.Texture;
      let heightTex: THREE.Texture;
      try {
        [colorTex, heightTex] = await Promise.all([
          loader.loadAsync(srcs.texture),
          loader.loadAsync(srcs.height),
        ]);
      } catch {
        if (!cancelled) setFailed(true);
        return;
      }
      if (cancelled) {
        colorTex?.dispose();
        heightTex?.dispose();
        return;
      }
      colorTex.colorSpace = THREE.SRGBColorSpace;
      heightTex.colorSpace = THREE.NoColorSpace;
      disposables.push(colorTex, heightTex);

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
      // so the card background shows through.
      if (appearance?.skyColor)
        scene.background = colorFrom(appearance.skyColor, 0);

      // If the map declares a skybox DDS, decode it and (when it's a cube map) use
      // it as the sky, replacing the flat colour. Done before the water reflection
      // capture below so the water mirrors the real sky. Any failure — a fetch/parse
      // error, an unsupported DDS variant (DX10/BC7 fail in DDSLoader), or a
      // non-cubemap DDS — silently falls back to the flat `skyColor` sky.
      if (skyboxSrc) {
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

      const geo = new THREE.PlaneGeometry(planeW, planeH, SEGMENTS, SEGMENTS);
      geo.rotateX(-Math.PI / 2); // lie flat in XZ; displacement then runs along +Y
      disposables.push(geo);

      const material = new THREE.MeshStandardMaterial({
        map: colorTex,
        displacementMap: heightTex,
        displacementScale: (maxHeight - minHeight) * s,
        displacementBias: minHeight * s,
        roughness: 1,
        metalness: 0,
        wireframe: wantWire.current,
      });
      // Tiled detail-texture multiply, patched into the standard material: after
      // the base colour is sampled, modulate it by the detail texture sampled at a
      // higher tiling frequency. `detail * 2` centres neutral at mid-grey (engine
      // convention); `detailStrength` fades the whole effect.
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
      disposables.push(waterGeo, waterMat);
      const waterMesh = new THREE.Mesh(waterGeo, waterMat);
      waterMesh.visible = wantWater.current;
      waterRef.current = waterMesh;
      scene.add(waterMesh);

      scene.add(new THREE.AmbientLight(0xffffff, 0.8));
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

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setClearColor(0x000000, 0); // transparent; the card shows through
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";

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

      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      camera.position.set(0, BASE * 0.7, BASE * 1.0);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.target.set(0, 0, 0);
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
      controls.minDistance = BASE * 0.12;
      controls.maxDistance = BASE * 3;
      controls.maxPolarAngle = Math.PI * 0.49;

      // Keep the camera above the terrain's highest point (peak displaced Y is
      // `maxHeight * s`), with a small margin. OrbitControls' distance/angle
      // clamps are relative to the moving zoom-to-cursor target and can't see
      // the surface, so this hard Y floor is what actually stops you zooming
      // under the map. Never below the water plane at y 0.
      const camFloor = Math.max(maxHeight * s, 0) + BASE * 0.02;
      const render = () => {
        if (camera.position.y < camFloor) camera.position.y = camFloor;
        renderer?.render(scene, camera);
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
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (!reduceMotion) {
        const animate = () => {
          animationFrame = requestAnimationFrame(animate);
          if (!waterRef.current?.visible) return;
          rippleWater(performance.now() / 1000);
          render();
        };
        animationFrame = requestAnimationFrame(animate);
      }

      const resize = () => {
        if (!renderer) return;
        const w = container.clientWidth || 1;
        const h = container.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        render();
      };
      observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();
      if (!cancelled) setBuilt(true);
    })();

    return () => {
      cancelled = true;
      setBuilt(false);
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      if (controls) {
        if (renderRef.current)
          controls.removeEventListener("change", renderRef.current);
        controls.dispose();
      }
      for (const d of disposables) d.dispose();
      if (renderer) {
        renderer.domElement.remove();
        renderer.dispose();
      }
      materialRef.current = null;
      waterRef.current = null;
      renderRef.current = null;
    };
  }, [
    srcs,
    detailSrc,
    minHeight,
    maxHeight,
    worldWidth,
    worldHeight,
    appSig,
    skyboxSrc,
  ]);

  // Spring's water plane sits at world height 0, so water is only visible where
  // terrain drops below it. Default the toggle off for a "dry" map (lowest point
  // at or above sea level) or one the mapinfo declares `voidWater` — a water plane
  // under entirely-above-water terrain just looks wrong. The user can still switch
  // it back on. Resets on map change (minHeight / voidWater are the deps).
  const hasWater = appearance?.voidWater !== true && minHeight < 0;
  useEffect(() => {
    setWater(hasWater);
  }, [hasWater]);

  // Live toggles — mutate the existing scene, no rebuild.
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.wireframe = wireframe;
      renderRef.current?.();
    }
  }, [wireframe]);
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
              "relative aspect-[16/10] max-h-[32rem] w-full overflow-hidden rounded-md border border-border bg-gradient-to-b from-muted/20 to-muted/40",
              className,
            )
      }
    >
      <div ref={containerRef} className="absolute inset-0" />

      {built && (
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

      {built && (
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
