import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * Typed bindings to `plugin:coilbox-anim|*` (the BOS/COB Rust crate). A port of
 * BARScriptCompiler; see the crate's PORTING.md. Provides COB disassembly and
 * byte-exact BOS→COB compilation (matching the reference's `--nopcpp` mode).
 */

/** Disassemble a `.cob` into a human-readable listing (not recompilable BOS). */
export const animCobDisasm = defineCommand<
  { path: string },
  { listing: string }
>("coilbox-anim", "anim_cob_disasm");

/**
 * The same disassembly for a `.cob` that is not a file on disk.
 *
 * A unit script read out of a game archive is bytes in memory, and the archive
 * is somebody else's game. Nothing is opened and nothing is written: the `.cob`
 * inside the archive is only ever read.
 */
export const animCobDisasmBytes = defineCommand<
  { bytes: number[] },
  { listing: string }
>("coilbox-anim", "anim_cob_disasm_bytes");

/**
 * Play a `.cob` and report where its pieces are on each frame.
 *
 * The disassembly makes a compiled script legible. This makes it move, which is
 * what somebody opening a unit out of an older game wanted. `pieces` is the
 * model's own piece names, matched against the ones inside the file.
 *
 * The timeline is the same shape the Lua unit script runtime produces, so the
 * viewport plays both the same way. A script that will not decode or that loops
 * without sleeping comes back carrying the reason rather than throwing.
 *
 * Read only, like the disassembly: bytes in, poses out.
 */
export const animCobRun = defineCommand<
  {
    bytes: number[];
    pieces: string[];
    events: { frame: number; callin: string; args?: number[] }[];
    frames: number;
  },
  import("../lego/scriptPlayback").ScriptTimeline
>("coilbox-anim", "anim_cob_run");

/**
 * Compile a `.bos` to `.cob`. Writes `<basename>.cob` next to the source unless
 * `output` is given. If the output exists and `overwrite` isn't set, it returns
 * `needsOverwrite: true` without writing, so the UI can confirm first.
 */
export const animBos2cob = defineCommand<
  { path: string; output?: string; overwrite?: boolean },
  { output: string; bytes: number; needsOverwrite: boolean }
>("coilbox-anim", "anim_bos2cob");
