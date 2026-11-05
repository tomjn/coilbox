#!/usr/bin/env bun
/**
 * Gather every unit's animation script from one installed game, as the unit
 * builder reads them, into a folder for the sweep test in
 * `crates/coilbox-springlua/tests/unit_sweep.rs` (issue #2791).
 *
 * It asks the unitsync worker for the game's unit definitions (`--unit-defs`),
 * then for each unit its script and includes (`--unit-script`) and its model's
 * piece names and offsets (`--unit-model`). Each Lua unit is written as
 * `<unit>.json` holding `unit`, `script`, `includes`, `unitDef`, `pieces` and
 * `rest`, each piece's parent and offset as the app passes them. Units with a
 * `.cob` script or no script are counted and left out, because the sweep runs
 * Lua only.
 *
 * `--game` is the archive name from a scan, such as
 * `06860629e67e11ef60760893bbfb60d5.sdp`, not the game's display name. Build
 * the worker first with `bun run sidecar:unitsync`.
 *
 * Run:
 *   bun scripts/unit-script-sweep.ts --worker <worker binary> \
 *     --lib <libunitsync> --datadir <content root> --game <archive> <out folder>
 *   COILBOX_UNIT_SWEEP=<out folder> cargo test -p coilbox-springlua \
 *     --test unit_sweep -- --ignored --nocapture
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const flags: Record<string, string> = {};
const rest: string[] = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) flags[a.slice(2)] = argv[++i] ?? "";
  else rest.push(a);
}
const { worker, lib, datadir, game } = flags;
const out = rest[0];
if (!worker || !lib || !datadir || !game || !out) {
  console.error(
    "usage: bun scripts/unit-script-sweep.ts --worker <bin> --lib <libunitsync> --datadir <dir> --game <archive> <out folder>",
  );
  process.exit(2);
}
if (existsSync(out)) {
  console.error(`${out} already exists, give a folder that does not`);
  process.exit(2);
}

/** Run the worker in one mode and parse the JSON it prints. */
function ask(args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(worker, ["--lib", lib, "--datadir", datadir, ...args]);
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", reject);
    child.on("close", () => {
      const text = Buffer.concat(chunks).toString();
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error(`worker ${args.join(" ")} printed no JSON`));
      }
    });
  });
}

type Piece = { name?: string; offset?: number[]; children?: Piece[] };
type Rest = { parent: number | null; position: number[] };

/** The model's pieces depth first, each with the parent and offset the app
 *  hands the preview as its `rest`, in the same order as the names. */
function flatten(root: Piece | undefined): { pieces: string[]; rest: Rest[] } {
  const pieces: string[] = [];
  const rest: Rest[] = [];
  const visit = (p: Piece, parent: number | null) => {
    const at = pieces.length;
    pieces.push(p.name ?? "");
    rest.push({ parent, position: p.offset ?? [0, 0, 0] });
    for (const child of p.children ?? []) visit(child, at);
  };
  if (root) visit(root, null);
  return { pieces, rest };
}

const defs = await ask(["--unit-defs", "--game", game]);
const units = (defs.units ?? {}) as Record<string, { objectname?: string }>;
const names = Object.keys(units).sort();
if (names.length === 0) {
  console.error(`no units read from ${game}: ${JSON.stringify(defs.errors)}`);
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const counts = { lua: 0, cob: 0, none: 0, failed: 0 };
async function gather(unit: string) {
  const script = await ask(["--unit-script", "--game", game, "--unit", unit]);
  if (script.kind !== "lua") {
    counts[script.kind === "cob" ? "cob" : "none"]++;
    return;
  }
  const object = units[unit].objectname;
  const model = object
    ? await ask(["--unit-model", "--game", game, "--object", object])
    : {};
  const includes = Object.fromEntries(
    ((script.includes ?? []) as { name: string; text: string }[]).map((i) => [
      i.name,
      i.text,
    ]),
  );
  let unitDef: unknown = null;
  try {
    unitDef =
      typeof script.unitDef === "string" ? JSON.parse(script.unitDef) : null;
  } catch {
    counts.failed++;
  }
  writeFileSync(
    join(out, `${unit}.json`),
    JSON.stringify({
      unit,
      script: script.text,
      includes,
      unitDef,
      ...flatten(model.root as Piece | undefined),
    }),
  );
  counts.lua++;
}

// Four at a time: each call mounts the game, which is most of its cost.
const queue = [...names];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let unit = queue.shift(); unit; unit = queue.shift()) {
      try {
        await gather(unit);
      } catch (e) {
        counts.failed++;
        console.error(`${unit}: ${(e as Error).message}`);
      }
    }
  }),
);
console.log(
  `${names.length} units: ${counts.lua} Lua scripts written, ${counts.cob} .cob, ${counts.none} with no script found, ${counts.failed} failed to read`,
);
