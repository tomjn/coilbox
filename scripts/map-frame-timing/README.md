# Map frame timing

Measures what one frame of the whole strategic map costs, so a terrain change can be checked against the 16.7 ms a frame that 60 FPS needs (issue #3666).

`probe.html` mounts the real `GalaxyView` on a generated land map. `run.mjs` drives it in headless Chrome through `agent-browser`. `summary.mjs` prints the table.

## What a number means

- The window is 1285 by 1003 CSS pixels at a device pixel ratio of 2, so the drawing buffer is 2570 by 2006, the size of the app's window.
- Each pose is the best of 6 batches of 30 renders of the whole scene. The renders are queued back to back and waited on once, so one number is what a frame costs the GPU with the CPU work overlapped. It is not the time between frames, because Chrome skips presenting frames when it can.
- The CSS labels are not in it. They cost 0.16 to 0.32 ms of CPU a frame on 29 labels when #3652 measured them.
- The poses are far (distance 118, 0.48 rad from vertical, over the middle of the map), close (distance 25, 0.48 rad, over the player's capital) and tilted (distance 60, 1.25 rad, over the middle).
- The maps are the temperate, desert and ice planets as Territories maps, and a 30 city Cities map, all from seed 54785. Temperate has rivers, towns and fields. Ice has taiga.
- `--perf 1` turns on performance mode. It also draws at a pixel ratio of 1, so the buffer is 1285 by 1003 and those numbers are not comparable pixel for pixel.
- The first page load of a map also records its startup: the time to make the land on the main thread (the app does that in a worker) and the ground's bake, one tile a frame. Each bake tile is timed to the end of its GPU work, so the first one or two include shader compiling. These are in the `.jsonl` file under `startup`.

## Run it

You need `agent-browser` on `PATH`. Measure with the machine quiet. `run.mjs` will not start a run at or above a 1 minute load average of 6 (`--max-load`), and waits up to 240 seconds for it to fall.

1. Start vite on a free port and leave it running. Launch it as `./node_modules/.bin/vite` so you can stop it by process ID.

   ```sh
   ./node_modules/.bin/vite --port 1479 --strictPort
   ```

2. Measure the checked out commit. Each run is one page load per map. Output goes to `docs/reports/map-frame-timing/<label>.jsonl`, which is gitignored.

   ```sh
   node scripts/map-frame-timing/run.mjs --label new --runs 1 --port 1479
   ```

3. Compare with an older commit by putting its `src/` in the working tree, measuring, and putting yours back. Measure each commit in turn, three rounds, and keep the best.

   ```sh
   git diff HEAD <old-commit> -- src > old.patch
   git apply old.patch
   node scripts/map-frame-timing/run.mjs --label old --runs 1
   git apply -R old.patch
   ```

   The probe only needs `GalaxyView`, `generateMap` and `generatedTerrainPixels`, so it runs on any commit that has the Territories and Cities land maps.

4. Print the table. Each cell is the best of every run in that file.

   ```sh
   node scripts/map-frame-timing/summary.mjs docs/reports/map-frame-timing/old.jsonl docs/reports/map-frame-timing/new.jsonl
   ```

`run.mjs` takes `--maps temperate,desert,ice,cities` to measure some of them, and `--out` to write elsewhere.

## The towns' share

`--towns 1` times the towns and their fields on their own. It measures far, close and tilted over both the map centre and the capital, six views. In each, batches with the towns and fields shown and hidden take turns, and the towns' share is the best shown batch less the best hidden one. Output goes to `<label>-towns.jsonl`, and `summary.mjs` prints the share first.

```sh
node scripts/map-frame-timing/run.mjs --label new --runs 1 --towns 1 --maps cities,temperate
```
