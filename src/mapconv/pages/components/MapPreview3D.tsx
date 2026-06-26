import { cn } from "@picoframe/frame";
import { Box, ImageOff, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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

/** Longest side requested from `mc_image_info` for each map. The heightmap needs
 * enough samples to displace with relief; the colour can be a touch crisper. */
const HEIGHT_MAX = 512;
const TEXTURE_MAX = 1024;
/** Plane subdivisions. ~131k tris — cheap, and the ≤512px heightmap is the real
 * detail bound, so more segments wouldn't show. */
const SEGMENTS = 256;
/** Horizontal extent the longer map side is normalised to, keeping scene
 * coordinates friendly regardless of true map size. Height is scaled by the
 * same factor, so vertical proportions stay physically correct. */
const BASE = 100;

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
  minHeight,
  maxHeight,
  worldWidth,
  worldHeight,
  appearance,
  className,
}: {
  heightmapPath: string;
  texturePath: string;
  minHeight: number;
  maxHeight: number;
  worldWidth: number;
  worldHeight: number;
  /** Optional `mapinfo.lua` hints — water colour/visibility, sky, sun. */
  appearance?: MapAppearance | null;
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
  ]);

  // Fetch both maps as downscaled data URLs whenever the inputs change.
  useEffect(() => {
    let cancelled = false;
    setSrcs(null);
    setFailed(false);
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
  }, [heightmapPath, texturePath]);

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

      const scene = new THREE.Scene();
      // Sky colour from mapinfo becomes the backdrop; otherwise stay transparent
      // so the card background shows through.
      if (appearance?.skyColor)
        scene.background = colorFrom(appearance.skyColor, 0);

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
      disposables.push(material);
      materialRef.current = material;
      scene.add(new THREE.Mesh(geo, material));

      // Flat translucent water plane at world height 0 (== scene y 0).
      const waterGeo = new THREE.PlaneGeometry(planeW, planeH);
      waterGeo.rotateX(-Math.PI / 2);
      const waterMat = new THREE.MeshStandardMaterial({
        color: colorFrom(appearance?.waterColor, 0x2f6f9f),
        transparent: true,
        opacity: appearance?.waterAlpha ?? 0.55,
        roughness: 0.25,
        metalness: 0,
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

      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      camera.position.set(0, BASE * 0.7, BASE * 1.0);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.target.set(0, 0, 0);

      const render = () => renderer?.render(scene, camera);
      renderRef.current = render;
      controls.addEventListener("change", render);

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
  }, [srcs, minHeight, maxHeight, worldWidth, worldHeight, appSig]);

  // mapinfo `voidWater` means the engine renders no water — default the toggle
  // to match when known (resets on map change; the user can still turn it on).
  useEffect(() => {
    if (appearance?.voidWater != null) setWater(!appearance.voidWater);
  }, [appearance?.voidWater]);

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
