// Frame time probe for the whole strategic map view. It mounts the real
// GalaxyView on a generated land map and times one frame of the whole scene.
// See README.md. Query:
//   probe.html?skin=territories|cities&planet=temperate|desert|ice|...
//             &seed=N&nodes=N&perf=1
import "@/index.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GalaxyView } from "@/conquest/galaxy3d/GalaxyView";
import { generatedTerrainPixels, generateMap } from "@/conquest/mapStyle";
import type { GalaxyDoc } from "@/conquest/model";
import type { PlanetId } from "@/conquest/planets";

const q = new URLSearchParams(location.search);
const skin = (q.get("skin") ?? "territories") as "territories" | "cities";
const planet = (q.get("planet") ?? "temperate") as PlanetId;
const performanceMode = q.get("perf") === "1";

const genStart = performance.now();
const galaxy: GalaxyDoc = generateMap(
  {
    seed: Number(q.get("seed") ?? 54785),
    // biome-ignore lint/suspicious/noExplicitAny: only the name is read
    game: { name: "probe" } as any,
    maps: ["a", "b", "c", "d", "e", "f"].map((name) => ({ name })),
    nodeCount: Number(q.get("nodes") ?? 28),
    factionCount: 2,
    layout: "continents",
    skin,
    planet,
  },
  "2026-11-08T00:00:00.000Z",
);
const genMs = performance.now() - genStart;
const pixelsStart = performance.now();
const terrainPixels = generatedTerrainPixels(galaxy);
const pixelsMs = performance.now() - pixelsStart;
const owners = Object.fromEntries(
  galaxy.nodes.map((n) => [n.id, n.owner ?? "neutral"]),
);
const capital = galaxy.nodes.find(
  (n) => n.kind === "capital" && n.owner === galaxy.playerFactionId,
);

/* ------------------------------ instrumentation --------------------------- */

type RenderFn = (s: THREE.Object3D, c: THREE.Camera) => void;
type Bake = { cpuMs: number; syncedMs: number };

let renderer: THREE.WebGLRenderer | undefined;
let scene: THREE.Scene | undefined;
let camera: THREE.Camera | undefined;
let controls: OrbitControls | undefined;
let spots: { centre: THREE.Vector3; capital: THREE.Vector3 } | undefined;
let origRender: RenderFn = () => {};
// Renders the view makes with some scene other than the map are the ground's
// bake, one tile a frame. Each is timed to the end of its GPU work.
const bake: Bake[] = [];
let firstMainFrameMs = Number.NaN;
const loadedAt = performance.now();
let timeToFirstMain = Number.NaN;

// WebGLRenderer assigns `render` in its constructor, so catch the assignment
// with a setter on the prototype and wrap the function there.
Object.defineProperty(THREE.WebGLRenderer.prototype, "render", {
  configurable: true,
  get() {
    return (this as { __render?: RenderFn }).__render;
  },
  set(fn: RenderFn) {
    origRender = fn;
    (this as { __render?: RenderFn }).__render = function (
      this: THREE.WebGLRenderer,
      s: THREE.Object3D,
      c: THREE.Camera,
    ) {
      const isMain = !!s.getObjectByName("terrain");
      if (isMain) {
        renderer = this;
        scene = s as THREE.Scene;
        camera = c;
        const t0 = performance.now();
        fn.call(this, s, c);
        if (Number.isNaN(firstMainFrameMs)) {
          firstMainFrameMs = performance.now() - t0;
          timeToFirstMain = performance.now() - loadedAt;
        }
        return;
      }
      if (bake.length > 400) {
        fn.call(this, s, c);
        return;
      }
      const gl = this.getContext() as WebGL2RenderingContext;
      const t0 = performance.now();
      fn.call(this, s, c);
      const cpuMs = performance.now() - t0;
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      bake.push({ cpuMs, syncedMs: performance.now() - t0 });
    };
  },
});
const origUpdate = OrbitControls.prototype.update;
OrbitControls.prototype.update = function (dt?: number | null) {
  controls = this;
  return origUpdate.call(this, dt);
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/* --------------------------------- api ------------------------------------ */

// Camera poses, as distance from the target and angle from vertical in radians.
const POSES = {
  far: { dist: 118, polar: 0.48, over: "centre" },
  close: { dist: 25, polar: 0.48, over: "capital" },
  tilt: { dist: 60, polar: 1.25, over: "centre" },
} as const;
type PoseName = keyof typeof POSES;

function pose(name: PoseName) {
  if (!controls || !camera || !spots) throw new Error("not ready");
  const p = POSES[name];
  const t = controls.target;
  t.copy(spots[p.over]);
  const off = new THREE.Vector3().setFromSphericalCoords(p.dist, p.polar, 0);
  camera.position.copy(t).add(off);
  controls.update();
  // The controls clamp to their limits, so report where the camera ended up.
  return {
    dist: r2(camera.position.distanceTo(t)),
    polar: r2(controls.getPolarAngle()),
  };
}

// `n` renders of the whole scene queued back to back and one wait at the end,
// so CPU and GPU overlap as they do in a running view. Best of `batches`.
function still(n: number, batches: number) {
  if (!renderer || !scene || !camera) throw new Error("not ready");
  const gl = renderer.getContext();
  const one = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
  for (let i = 0; i < 10; i++) origRender.call(renderer, scene, camera);
  sync();
  const all: number[] = [];
  for (let b = 0; b < batches; b++) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) origRender.call(renderer, scene, camera);
    sync();
    all.push((performance.now() - t0) / n);
  }
  return { best: r2(Math.min(...all)), all: all.map(r2) };
}

const api = {
  pose,
  ready: () => !!(renderer && scene && camera && controls),
  // Point the camera at the capital and remember where, for the close pose.
  async settle() {
    const set = (window as unknown as { probeSet: (p: object) => void })
      .probeSet;
    if (!controls) throw new Error("not ready");
    const centre = controls.target.clone();
    if (capital) {
      set({ focusNodeId: capital.id });
      await sleep(3000);
    }
    const capitalTarget = controls.target.clone();
    spots = { centre, capital: capitalTarget };
    return {
      centre: centre.toArray().map(r2),
      capital: capitalTarget.toArray().map(r2),
    };
  },
  info() {
    const gl = renderer?.getContext() as WebGL2RenderingContext | undefined;
    const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
    let tris = 0;
    scene?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const idx = m.geometry.index;
      const c = idx
        ? idx.count
        : (m.geometry.getAttribute("position")?.count ?? 0);
      const inst = (m as THREE.InstancedMesh).isInstancedMesh
        ? (m as THREE.InstancedMesh).count
        : 1;
      tris += (c / 3) * inst;
    });
    const size = new THREE.Vector2();
    renderer?.getDrawingBufferSize(size);
    return {
      gpu: dbg && gl ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "?",
      buffer: size.toArray(),
      dpr: devicePixelRatio,
      pixelRatio: renderer?.getPixelRatio(),
      tris: Math.round(tris),
      nodes: galaxy.nodes.length,
      // Absent from the commits before rivers were drawn.
      riverLines: (
        terrainPixels as { extension?: { rivers?: { lines: unknown[] } } }
      )?.extension?.rivers?.lines.length,
      objects: (scene?.children ?? []).map((o) => o.name || o.type),
      limits: controls && {
        min: r2(controls.minDistance),
        max: r2(controls.maxDistance),
        maxPolar: r2(controls.maxPolarAngle),
      },
      perf: performanceMode,
    };
  },
  // The steady frame at each pose: best of `batches` batches of `n` renders.
  async frames(n = 30, batches = 6) {
    const out: Record<string, unknown> = {};
    for (const name of Object.keys(POSES) as PoseName[]) {
      const at = pose(name);
      await sleep(100);
      out[name] = { ...still(n, batches), ...at };
    }
    return out;
  },
  // Time the page took to make the map, and the bake as the view drew it.
  startup() {
    return {
      generateMs: r2(genMs),
      pixelsMs: r2(pixelsMs),
      firstMainFrameMs: r2(firstMainFrameMs),
      timeToFirstMainMs: r2(timeToFirstMain),
      bakeTiles: bake.length,
      bakeCpuMs: r2(bake.reduce((a, b) => a + b.cpuMs, 0)),
      bakeSyncedMs: r2(bake.reduce((a, b) => a + b.syncedMs, 0)),
      bakeWorstTileMs: r2(Math.max(0, ...bake.map((b) => b.syncedMs))),
      bakeTileMs: bake.map((b) => r2(b.syncedMs)),
    };
  },
};
(window as unknown as { probe: typeof api }).probe = api;

// The whole measurement, left on `window.__result` for the runner to wait on.
(window as unknown as { probeGo: () => Promise<void> }).probeGo = async () => {
  let seen = -1;
  while (bake.length !== seen || !api.ready()) {
    seen = bake.length;
    await sleep(1000);
  }
  const startup = api.startup();
  const spots = await api.settle();
  const frames = await api.frames();
  (window as unknown as { __result: unknown }).__result = JSON.stringify({
    query: location.search,
    info: api.info(),
    startup,
    spots,
    frames,
  });
};

function Probe() {
  const [props, setProps] = useState<{
    focusNodeId: string | null;
  }>({ focusNodeId: null });
  (window as unknown as { probeSet: unknown }).probeSet = (p: object) =>
    setProps((old) => ({ ...old, ...p }));
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <GalaxyView
        galaxy={galaxy}
        owners={owners}
        playerFactionId={galaxy.playerFactionId ?? "player"}
        terrainPixels={terrainPixels}
        display={{ performanceMode }}
        className="h-full w-full"
        {...props}
      />
    </div>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("no root");
createRoot(root).render(<Probe />);
