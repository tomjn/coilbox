/**
 * Whether this project's mutator would cover the game's own unit
 * post-processing (issue #2744).
 *
 * A mutator is a game archive that depends on another game, and the engine
 * merges the two into one namespace where a file at a path can only be one
 * file. The compiler has exactly one place it can put code that reads a
 * definition before writing it: `gamedata/unitdefs_post.lua`, which the
 * engine's definition parser includes once, by name, after every
 * `units/*.lua` has loaded (`cont/base/springcontent/gamedata/unitdefs.lua`).
 * The mutator is the root archive, so its copy is added first and the game's
 * own copy is skipped (`CVFSHandler::AddArchive`, called with `overwrite`
 * false for the mod in `PreGame.cpp`). The game's post-processing then never
 * runs.
 *
 * There is no way to chain. The parser's `VFS` table holds `DirList`,
 * `FileExists`, `Include`, `LoadFile` and `SubDirs` and nothing else
 * (`LuaParser::SetupEnv`), so `VFS.UseArchive`, the one call that can read
 * from a named archive, is out of reach, and the covered file does not appear
 * in a `DirList` of the folder it is in either. This is the opposite of the
 * answer issue #2743 reached for unit names: BAR's i18n module enumerates a
 * directory, so a second file could be added beside the first. One
 * `VFS.Include` of a fixed path leaves nowhere to stand.
 *
 * So the check. Two facts have to be true at once before there is anything to
 * say, and reporting either on its own would be noise:
 *
 * - the compile writes that file, which it only does for a project holding
 *   field changes or block-form Lua (`compile.rs`), so a project of added
 *   units and renames never trips this
 * - the game already has one, which most do but not all
 *
 * The game's own archives are read rather than the merged VFS, because the
 * engine's base content ships a `gamedata/unitdefs_post.lua` of its own and
 * would always answer yes. That file converts a pre-0.83 tag and strips a
 * leading colon from a description, which a mutator covering it costs almost
 * nothing, so it is deliberately not what this reports on.
 */
import { useEffect, useRef, useState } from "react";
import type { Archive, ArchiveFileEntry } from "@/content/bindings";
import { unitsyncArchiveTree } from "@/content/bindings";
import type { CompiledMod } from "./compile";

/**
 * The one file a mutator can run code in. Mirrors `compile::POST_FILE`, which
 * is private to that module, for the reason `ledger.rs` mirrors it: the path
 * is a fixed fact about the shape of a mutator archive rather than something
 * this module gets to choose. `the checked path is the one the compiler
 * writes` in the Rust tests holds the two together.
 */
export const POST_FILE = "gamedata/unitdefs_post.lua";

/** Whether a compiled mutator carries the post file at all. */
export function writesPostFile(compiled: CompiledMod | null): boolean {
  return !!compiled?.files.some((f) => f.path === POST_FILE);
}

/**
 * Whether an archive's member list holds the post file.
 *
 * Case-insensitive, because Spring's VFS matches member paths that way and
 * archives disagree in practice: SplinterFaction stores the folder as
 * `Gamedata/` and every other game here stores it as `gamedata/`. A
 * case-sensitive test would call SplinterFaction clear and let a coilbox
 * mutator cover its post-processing silently.
 */
export function holdsPostFile(files: ArchiveFileEntry[]): boolean {
  return files.some((f) => f.path.toLowerCase() === POST_FILE);
}

/** What the check has to say, once it knows. */
export type PostHookState =
  /** Nothing compiled that would cover anything, so there is nothing to say. */
  | { kind: "unwritten" }
  /** The game's archives could not be read, so the question is open. */
  | { kind: "unknown"; detail: string }
  /** The compile writes the file and no archive of the game's own has one. */
  | { kind: "clear" }
  /** The compile writes the file and this archive of the game's already has one. */
  | { kind: "covered"; archive: string };

/** What the hook reports while it is still working it out. */
export interface PostHookCheck {
  state: PostHookState | null;
  loading: boolean;
}

/**
 * Read the game's own archives and say whether a mutator would cover its unit
 * post-processing.
 *
 * The primary archive first and then each dependency, because a game that
 * builds on another game inherits that game's post file through the same
 * merge, and a mutator on top covers whichever of the two the engine would
 * have used. The engine's base content is not in this list: `AddArchive` puts
 * it in its own VFS section and no game declares it as a dependency, which is
 * exactly the separation this check wants.
 *
 * Read whenever a game is picked rather than only while the drawer is open.
 * The verdict on the button's face has to mean something was checked, which is
 * the same reason preflight reads live, and unlike preflight this depends on
 * the game rather than on the edits, so it runs once per game rather than once
 * per keystroke.
 */
export function usePostHookCheck(
  enginePath: string | undefined,
  dataDir: string | undefined,
  archives: Archive[],
  compiled: CompiledMod | null,
): PostHookCheck {
  const [found, setFound] = useState<{
    key: string;
    archive: string | null;
    error: string | null;
  } | null>(null);
  const names = archives.map((a) => a.name);
  const key = enginePath && dataDir ? `${enginePath}:${names.join("|")}` : "";
  // The names the effect reads, held in a ref so the effect depends on the
  // joined key rather than on an array the page rebuilds every render.
  const latest = useRef(names);
  latest.current = names;

  useEffect(() => {
    if (!key || !enginePath || !dataDir) {
      setFound(null);
      return;
    }
    let cancelled = false;
    const read = async () => {
      for (const archive of latest.current) {
        const tree = await unitsyncArchiveTree({
          enginePath,
          dataDir,
          archive,
        });
        if (holdsPostFile(tree.files)) return archive;
      }
      return null;
    };
    read()
      .then((archive) => {
        if (!cancelled) setFound({ key, archive, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setFound({
            key,
            archive: null,
            error: e instanceof Error ? e.message : String(e),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [key, enginePath, dataDir]);

  if (!writesPostFile(compiled))
    return { state: { kind: "unwritten" }, loading: false };
  if (!key) return { state: null, loading: false };
  if (!found || found.key !== key) return { state: null, loading: true };
  if (found.error)
    return { state: { kind: "unknown", detail: found.error }, loading: false };
  return {
    state: found.archive
      ? { kind: "covered", archive: found.archive }
      : { kind: "clear" },
    loading: false,
  };
}
