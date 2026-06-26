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
 * Compile a `.bos` to `.cob`. Writes `<basename>.cob` next to the source unless
 * `output` is given. If the output exists and `overwrite` isn't set, it returns
 * `needsOverwrite: true` without writing, so the UI can confirm first.
 */
export const animBos2cob = defineCommand<
  { path: string; output?: string; overwrite?: boolean },
  { output: string; bytes: number; needsOverwrite: boolean }
>("coilbox-anim", "anim_bos2cob");

/** Reveal a file in the OS file manager (selects it where supported). */
export const animReveal = defineCommand<{ path: string }, { revealed: boolean }>(
  "coilbox-anim",
  "anim_reveal",
);
