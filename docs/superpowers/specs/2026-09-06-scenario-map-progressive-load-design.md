# Scenario map progressive load and shared cache

Opening a scenario waits for the map, the terrain and every unit before it shows anything, and a second visit to the same map pays most of the same cost again. This design makes the scene appear in stages as each input lands, shows a floating indicator while it does, and keeps decoded assets in a session cache shared by every scenario on the same map.

## What was measured

Measured on 6 September 2026 in `bun tauri dev` on "Silence the Jericho" (AcidicQuarry 5.17, 66 placements, 11 distinct unit models).

| Case | Canvas visible | All units drawn |
|---|---|---|
| Cold (full reload, disk caches warm) | 3.4s | 9.3s |
| Warm (navigate out and back) | 2.4s | not measured |

Findings that drive the design:

- On a warm revisit no unitsync command runs and the height field fetch takes under 0.1s, yet the canvas still takes 2.4s. The three.js build itself is under 0.2s from first texture to first frame.
- The 2s is a main thread stall between the React commit that receives the height grid and that commit's first passive effect. No instrumented code runs in it. It is either an uninstrumented effect cleanup or native work after a WebGL context is created and discarded. The scene effect runs three times at startup as sources flicker in, creating a renderer each time.
- Cold adds 11 sequential `unitsync_unit_model` calls at 0.4 to 1.0s each. The batched `unitsync_unit_models` command exists in Rust and bindings.ts and has no caller.
- Cold fires duplicate concurrent calls for the same key: minimap twice, heightmap twice, game info twice, unit dataset eight times. Only the model loader dedupes in flight.
- Nothing draws until both minimap and heightmap resolve. The 8 bit height picture is then deliberately withheld until the exact heights land, because MapPreview3D can only rebuild the whole scene, not update it.

## Goals

- Something is on screen as soon as the minimap arrives, and each later input refines it in place.
- A floating indicator shows each stage and fades once every stage is done.
- A revisit of the same map, from any scenario, and a hot reload, reuse decoded assets and skip the backend.
- Unit models load in parallel through one archive mount and persist on disk.
- The 2s stall is found and removed.

## Not in scope

- A shared app-wide renderer or GPU-side caching. On Apple silicon the copy into driver memory is not a bus transfer, and on every platform it measured under 0.2s.
- Changing what the terrain looks like, the camera, or any editing behaviour.
- Caching the height grid or the minimap to disk. They are already there.

## 1. Load stages and state

A `MapLoad` value describes the stages of one open scene:

```ts
type StageState = "idle" | "loading" | "done" | "failed";
interface MapLoad {
  minimap: StageState;
  heightPicture: StageState;
  exactHeights: StageState;
  skybox: StageState;
  unitDefs: StageState;
  models: { state: StageState; done: number; total: number };
}
```

`useMissionMapAssets` and `useScenarioUnits` already know when each of these starts and settles. They report into the value instead of only exposing `loading` and `ready` booleans. ScenarioMapScene owns it and passes it to the indicator and to the footnotes. No stage waits for a later one before its result is shown.

## 2. Session cache of decoded assets

A new module, `src/placement/assetCache.ts`, holds what is expensive to decode and independent of any renderer:

| Entry | Key | Value |
|---|---|---|
| Height grid | `dataDir::enginePath::mapName` | `HeightGrid` (the `Uint16Array` and its size) |
| Minimap | same | `ImageBitmap` |
| Skybox | same | the parsed DDS data |
| Unit model | `dataDir::enginePath::gameArchive::object` | merged `BufferGeometry` per material key, the texture atlas canvas, and the material descriptions that do not depend on team colour |

Team colour is applied at build time through the material, so one cached model serves every team. The units layer builds per-colour materials on top of the cached geometry instead of merging again.

The cache is keyed by map and game identity only. Two scenarios on the same map share every entry.

It lives in `import.meta.hot.data` when that exists, so a hot reload of the module keeps it. In production `import.meta.hot` is undefined and a plain module `Map` is used.

Eviction keeps the current map and the previous map and drops entries for older maps when a third arrives. This is a choice, not a measured limit. Unit model entries follow the game archive rather than the map and are dropped when no cached map uses that game.

`invalidateMapPreview()` and `invalidateScans()` in config.ts clear the matching entries, so a downloaded or replaced map never draws stale terrain.

The existing per-layer `prototypes` map in unitsLayer.ts stays as the per-mount cache of built objects. What changes is that a miss there reads from the session cache before it reads from the backend.

## 3. Request layer and backend

In-flight deduplication. Every unitsync hook in config.ts that fetches by key (minimap, heightmap, height field, skybox, unit dataset, game info, map info, skirmish AIs) keeps a pending promise per key, the way `unitModelPending` already does, and a second caller awaits the same promise. This removes the duplicate calls seen on cold start.

Batched models. The units layer collects every distinct object name in the draw, calls `unitsync_unit_models` once, and reads each model back from the file the worker wrote into the model cache dir. Models for one draw load in parallel and the scene fills in as each batch's geometry is built. The single-model command stays for callers outside the scenario editor.

Disk cache for the skirmish AI list. The unit dataset and game info are already cached on disk by the worker's `infocache` module, keyed by the archive's path, size and modification time. The skirmish AI list is not, and it took 20s on the cold run. It joins `infocache`, keyed by the engine library's file identity plus the game archive's, so a restart reads the file after one cheap unitsync `Init` instead of mounting the game.

## 4. Progressive scene

MapPreview3D keeps one renderer and one scene for the life of the mount. Inputs arrive as props and are applied in place:

1. Minimap arrives: a flat plane with the minimap as its colour map. The indicator shows the rest still loading.
2. Height picture arrives: the plane's displacement map is set and the geometry redisplaced. The picture is no longer withheld from the caller.
3. Exact heights arrive: the displacement texture is replaced with the 16 bit words texture. No rebuild.
4. Skybox arrives: the scene background is set and the water reflection capture runs once.
5. Unit defs and models arrive: batches draw as they resolve, in parallel.

Appearance changes (water colour, sun, fog, sky colour) update the existing materials and lights. The `useCanvas3D` dependency list shrinks to the inputs that genuinely need a new canvas: world size, wireframe mode, and the interaction flags. Everything else goes through an update path on the built scene.

The renderer is created once. That removes the three creations seen at startup, which is one of the two candidates for the stall.

`useMissionMapAssets` stops withholding `heightSrc`. It hands over the picture as soon as it lands and the words when they land, and MapPreview3D applies each without tearing down.

## 5. Indicator and captions

A small floating panel in a corner of the scene lists the stages from `MapLoad`, each with a spinner, a tick or a cross, and the models row shows `done / total`. It uses the existing `Loader2` spinner and the picoframe primitives. It fades out once every stage is done and stays if any stage failed, with the failure text.

Any caption that says the game's units or heights have not been read shows a spinner and "Reading units" or "Reading heights" while that stage is loading, and only says "not read" once the stage has failed. This covers the footnotes in `ScenarioMapSceneChrome` and the note in `BlueprintPanel`.

## 6. The stall

The first implementation task reproduces the 2s stall with the app window visible and pins it to one of the two candidates: an effect cleanup that runs when the height grid lands, or native work after a renderer is created and discarded. The measurement method is in the memory note `scenario-preview-load-profile` and in the git stash "temporary timing probes". The fix lands before the scene refactor so the refactor can be measured against a known baseline.

## 7. Testing

- Vitest for `assetCache.ts`: keying, sharing across scenarios, eviction of the third map, survival across a simulated `import.meta.hot.data`, and clearing on invalidation.
- Vitest for the `MapLoad` transitions in the hooks.
- Vitest for in-flight deduplication: two callers, one command.
- Existing PlacementSurface and MapPreview3D tests keep passing.
- The timing runs from the measurement section are repeated cold, warm and after a hot reload, with the window visible, and the numbers go in the PR.

## Sizing

L. The scene refactor in section 4 is most of it. Sections 2, 3 and 5 are each S to M and can land as separate PRs ahead of it.
