/**
 * The project as Lua, from the Rust compiler (issue #1275).
 *
 * The editor holds the project and the game reads Lua. The step between them is
 * `crates/tauri-plugin-coilbox-workshop`, which takes the whole project over one
 * command and hands back both the Lua and its own reasoning about it. Nothing is
 * read off disk and nothing is written, so compiling is free to do on every edit
 * and there is nothing to undo.
 *
 * The compiler lives in Rust rather than beside the stores here because of what
 * happens to what it produces. The preflight parses it with `coilbox-springlua`
 * (issue #1276), the local test run writes it into a `.sdd` under the content
 * root (issue #1278), and packing it up for somebody else builds an archive
 * (issue #1283). All three are Rust already.
 */
import { defineCommand } from "@picoframe/plugin-sdk";
import { useEffect, useRef, useState } from "react";
import type { ModProject } from "./project";

/**
 * Which of the two forms a piece of generated Lua is written in.
 *
 * `table` is a plain map of unit name to definition, which is what BAR's
 * `tweakunits` slot carries and what a game's own `units/<name>.lua` returns.
 * `block` is executable Lua wrapped in `do ... end` with `UnitDefs` in scope,
 * which is what `tweakdefs` carries. The second is needed the moment a change
 * has to read a definition before writing it.
 */
export type LuaForm = "table" | "block";

/** One piece of generated Lua, and the compiler's reason for its form. */
export interface CompiledChunk {
  form: LuaForm;
  /** What this chunk changes, as a heading. */
  title: string;
  /** Why the compiler wrote it this way rather than the other way. */
  reason: string;
  lua: string;
}

/** One file of the generated mutator archive. */
export interface CompiledFile {
  /** Relative to the archive root, always with forward slashes. */
  path: string;
  contents: string;
}

/** What a project compiled to. */
export interface CompiledMod {
  chunks: CompiledChunk[];
  files: CompiledFile[];
  /** What the compiler could not do, and what to watch in what it did. */
  notes: string[];
}

export const workshopCompile = defineCommand<
  { project: ModProject },
  CompiledMod
>("coilbox-workshop", "workshop_compile");

/** What the caller has: the Lua, or the reason there is none yet. */
export interface CompileState {
  compiled: CompiledMod | null;
  loading: boolean;
  /** What went wrong, which in practice means the command itself failed. */
  error: string | null;
}

/**
 * Nothing compiled and nothing being compiled.
 *
 * One shared value rather than a fresh object, so that a page holding the hook
 * with the drawer shut settles on the same object React already has and does
 * not re-render for it. `EMPTY_EDITS` in `project.ts` is there for the same
 * reason.
 */
const IDLE: CompileState = { compiled: null, loading: false, error: null };

/**
 * Compile a project when something is looking at the result.
 *
 * `enabled` is the drawer being open. Compiling is cheap, but a page that
 * recompiled on every keystroke for a panel nobody has opened would be spending
 * a round trip per character for no reason.
 *
 * Keyed on `updatedAt` rather than on the project object, because the editor
 * hands down a fresh object on every render and the edits are what the output
 * depends on.
 */
export function useCompiledProject(
  project: ModProject | undefined,
  enabled: boolean,
): CompileState {
  const [state, setState] = useState<CompileState>(IDLE);
  // The project the effect reads, held in a ref so that the effect can depend
  // on the key rather than on an object identity the editor may hand down fresh
  // on every render. What compiles is always the current project, and `key`
  // decides when to compile it.
  const latest = useRef(project);
  latest.current = project;
  const key = project ? `${project.id}:${project.updatedAt}` : "";

  useEffect(() => {
    const current = latest.current;
    if (!enabled || !key || !current) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    workshopCompile({ project: current })
      .then((compiled) => {
        if (!cancelled) setState({ compiled, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState({
            compiled: null,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [key, enabled]);

  return state;
}
