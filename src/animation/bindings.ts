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
    /** Where each piece sits, in the same order as `pieces`, for a script that
     *  asks where one of them is. Absent when nobody said. */
    rest?: import("../lego/pieceRest").PieceRest[];
  },
  import("../lego/scriptPlayback").ScriptTimeline
>("coilbox-anim", "anim_cob_run");

/**
 * Compile a `.bos` to `.cob`. Writes `<basename>.cob` next to the source unless
 * `output` is given. If the output exists and `overwrite` isn't set, it returns
 * `needsOverwrite: true` without writing, so the UI can confirm first.
 * `warnings` covers anything that compiled but is worth a second look, such as
 * a bare assignment sitting outside any function.
 */
export const animBos2cob = defineCommand<
  { path: string; output?: string; overwrite?: boolean },
  {
    output: string;
    bytes: number;
    needsOverwrite: boolean;
    warnings: string[];
  }
>("coilbox-anim", "anim_bos2cob");

/**
 * One thing a conversion did differently from the BOS, or an include that
 * could not be found.
 *
 * `file` and `line` name where in the source it comes from, when it names
 * anywhere at all: some, such as a script too big for Lua's own limits, name
 * nowhere in particular and leave both `null`. `main` says whether `file` is
 * the script's own file rather than one it includes, so a caller can tell
 * which warnings it can jump to in the box showing that file.
 */
export interface ConversionWarning {
  file: string | null;
  line: number | null;
  message: string;
  main?: boolean;
}

/**
 * Convert BOS source to a Lua unit script that runs as it is, comments and all.
 *
 * `includes` is the files it may `#include`, keyed by path. `pieces` is the
 * model's piece names, so the Lua asks for each by the model's own spelling.
 * `cob` is the compiled script beside the source, when there is one, which
 * settles how long `[1]` is: Scriptor, which built the older games, made it two
 * and a half elmos. `warnings` is anything the Lua may do differently.
 * `path` is the file the source was loaded from, when it was one: the headers
 * it includes are then read from around it, and the `.cob` beside it when
 * `cob` is not given. `missingIncludes` names each `#include` that was found
 * nowhere.
 */
export const animBos2lua = defineCommand<
  {
    source: string;
    name: string;
    includes?: Record<string, string>;
    pieces?: string[];
    cob?: number[];
    path?: string;
    /** Leave out what nothing uses. On unless this is false. */
    prune?: boolean;
  },
  {
    lua: string;
    warnings: ConversionWarning[];
    linearScale: number;
    cobVars: string | null;
    missingIncludes: string[];
  }
>("coilbox-anim", "anim_bos2lua");

/** One thing a lint pass found wrong with a BOS script. */
export interface LintDiagnostic {
  rule: string;
  severity: "error" | "warning" | "info";
  line: number;
  message: string;
}

/**
 * Lint BOS source and report what it finds, without converting it.
 *
 * Same inputs as {@link animBos2lua} minus `prune`, which no rule cares
 * about. `path`, when given, reads the script's includes from disk exactly as
 * `animBos2lua` does. `cob`, when given, still settles the linear scale and
 * precedence a rule needs to fold a `<x>` or `[x]` constant.
 *
 * A script that fails to parse comes back with an empty `diagnostics` array
 * and `error` set, rather than throwing, so the UI can show the parse
 * failure next to whatever source is on screen.
 */
export const animBosLint = defineCommand<
  {
    source: string;
    name: string;
    includes?: Record<string, string>;
    pieces?: string[];
    cob?: number[];
    path?: string;
  },
  { diagnostics: LintDiagnostic[]; error?: string }
>("coilbox-anim", "anim_bos_lint");

/** The text of a `.bos` on disk, for the converter page to show and edit. */
export const animBosRead = defineCommand<{ path: string }, { source: string }>(
  "coilbox-anim",
  "anim_bos_read",
);
