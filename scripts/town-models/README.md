# Town models and Persepolis

Exports the conquest map's town buildings from the app's own generator, as a model package and as the Persepolis Recoil map. The buildings come from `src/conquest/galaxy3d/towns3d/`, so a change to a building there shows up in the next export.

Each step is a vitest file run with this folder's `vitest.config.ts`. None of them run in `bun run test`. Everything they write goes to `docs/reports/town-models/`, which is gitignored. The map's Lua in `persepolis-lua/` is source and stays here.

Run every command from this folder.

## The model package

`bake.test.ts` writes `coilbox-town-models/` to `docs/reports/town-models/out/`. It has every open town building, lot filler and outpost as STL, OBJ per colourway, baked textures and AO, plus Recoil `.s3o` models.

```sh
BAKE=1 DENSITY=256 bunx vitest run bake.test.ts --testTimeout=0
cp package-README.md ../../docs/reports/town-models/out/coilbox-town-models/README.md
cd ../../docs/reports/town-models/out
zip -r -q -X ../coilbox-town-models-$(date +%F).zip coilbox-town-models -x '*.DS_Store'
```

Without `BAKE=1` it writes the geometry and the plan but no textures. `ONLY=tower` bakes one building and keeps the rest of the package.

## Persepolis

Building a release takes four steps. Set `VERSION` in `map.test.ts` first, because it names the `.smf` and `.smt` files as well as the map.

1. Render the skybox. `map.test.ts` reads it, so rerun this only when the sky or the skyline changes.

   ```sh
   DENSITY=256 bunx vitest run sky.test.ts
   ```

2. Bake the buildings and write the map's archive folder and source images. `bake-parallel.sh` runs 4 shards side by side, then a last run that writes `docs/reports/town-models/persepolis/`.

   ```sh
   DENSITY=256 ./bake-parallel.sh
   ```

   Bakes are kept in `docs/reports/town-models/persepolis-bake-cache/`. A building is baked again only when its geometry, `townkit.ts` or `src/conquest/galaxy3d/landmarks/material.ts` changes.

3. Compile the map with mapconv. `mapcompile` is in `src-tauri/mapconv/`, which `bun tauri dev` fills. Call it by name on `PATH`, because the git-safe hook rejects the command when it has the absolute path. `height-range.txt` holds the `-minh` and `-maxh` the heightmap was written with. The `-o` name is `persepolis_` plus `VERSION` with underscores.

   ```sh
   cd ../../docs/reports/town-models/persepolis/src
   read LO HI < height-range.txt
   PATH="$(git rev-parse --show-toplevel)/src-tauri/mapconv:$PATH" mapcompile -t texture.png -m metal.png -h height.png -minh "$LO" -maxh "$HI" -minimap minimap.png -ct 1 -features features.txt -o persepolis_v1_7 > ../mapconv.log 2>&1
   ```

4. Pack the archive with `7zz` (`brew install sevenzip`). Every release so far was packed with solid compression off (`-ms=off`).

   ```sh
   cd ..
   mv src/persepolis_v1_7.smf src/persepolis_v1_7.smt persepolis.sdd/maps/
   cd persepolis.sdd
   7zz a -t7z -mx=9 -ms=off ../persepolis_v1.7.sd7 mapinfo.lua mapconfig maps features objects3d unittextures LuaRules LuaUI > ../7z.log 2>&1
   ```

   Copy the `.sd7` to `~/.spring/maps/` to play it.

`map.test.ts -t layout` writes only the street layout to `persepolis-layout.json`, in seconds, for checking a layout change. `-t "ground crops"` writes the paving round a junction and a walk to `persepolis-crop-*.png` without an export. `-t "plinth caps"` writes each building's cap at the plinth cut to `persepolis-caps.txt`.

## Checks

These write files to look at, in `docs/reports/town-models/`. Use them while changing a building or the bake.

- `dims.test.ts` writes every building's footprint and height to `dims.txt`.
- `tris.test.ts` writes triangle counts per model to `tris.txt`.
- `zfight.test.ts` writes coplanar overlapping faces per building to `zfight-report.txt`.
- `ao.test.ts` bakes `ONLY` (default `tower`) with and without AO, and `render.test.ts` renders those bakes to PNG for comparison.
- `normals.test.ts` writes normal bake previews to `out/normals/`.
- `colourways.test.ts` writes an OBJ per colourway for models already in `out/`.
