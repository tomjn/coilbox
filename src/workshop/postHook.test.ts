/**
 * The two facts the post-processing check combines (issue #2744).
 *
 * The engine reasoning behind them is in `postHook.ts`'s own doc comment and
 * was settled by reading `LuaParser.cpp`, `VFSHandler.cpp` and
 * `springcontent/gamedata/unitdefs.lua`, then measuring it: a throwaway
 * mutator depending on Balanced Annihilation V15.9.8, carrying a 30-byte
 * `gamedata/unitdefs_post.lua`, was mounted through unitsync's Lua parser and
 * `VFS.LoadFile` on that path returned the mutator's 30 bytes rather than BA's
 * 1755. Removing the file from the mutator and re-running returned BA's. The
 * same run showed `VFS.DirList('gamedata/', '*.lua')` listing the path once,
 * so the covered copy cannot be reached by enumeration either.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CompiledMod } from "./compile";
import { holdsPostFile, POST_FILE, writesPostFile } from "./postHook";

function compiled(paths: string[]): CompiledMod {
  return {
    chunks: [],
    files: paths.map((path) => ({ path, contents: "" })),
    notes: [],
    barTweakdefs: null,
  };
}

describe("whether the compile writes the post file", () => {
  it("says no for a project that compiled to nothing", () => {
    expect(writesPostFile(null)).toBe(false);
    expect(writesPostFile(compiled([]))).toBe(false);
  });

  /** An added unit gets its own `units/<key>.lua` and needs no executable
   *  Lua, so a project of nothing but added units covers nothing. This is the
   *  case that makes the check quiet rather than constant. */
  it("says no for a compile that only wrote unit files and words", () => {
    expect(
      writesPostFile(
        compiled(["units/supercom.lua", "language/en/zz_coilbox.json"]),
      ),
    ).toBe(false);
  });

  it("says yes once the post file is among the compiled files", () => {
    expect(writesPostFile(compiled(["units/supercom.lua", POST_FILE]))).toBe(
      true,
    );
  });
});

describe("whether a game archive holds the post file", () => {
  it("says no for an archive that does not", () => {
    expect(holdsPostFile([])).toBe(false);
    expect(
      holdsPostFile([{ path: "gamedata/alldefs_post.lua", size: 3717 }]),
    ).toBe(false);
  });

  it("says yes for an archive that does", () => {
    expect(holdsPostFile([{ path: POST_FILE, size: 1755 }])).toBe(true);
  });

  /** SplinterFaction stores the folder as `Gamedata/`, and Spring's VFS
   *  matches member paths case-insensitively. A case-sensitive test would
   *  call it clear and let a mutator cover its post-processing silently. */
  it("matches the way the VFS does, whatever case the archive stores", () => {
    expect(
      holdsPostFile([{ path: "Gamedata/unitdefs_post.lua", size: 1831 }]),
    ).toBe(true);
  });

  /** A path that merely ends the same way is a different file. BAR ships
   *  `unitbasedefs/raptor_unitdefs_post.lua`, which the engine never
   *  includes and a mutator never covers. */
  it("does not match a file that only ends with the same name", () => {
    expect(
      holdsPostFile([
        { path: "unitbasedefs/raptor_unitdefs_post.lua", size: 1762 },
      ]),
    ).toBe(false);
  });
});

/**
 * The one mirrored fact in this module. `compile.rs` owns the path and keeps
 * it private, `ledger.rs` mirrors it for the same reason, and a drift here
 * would leave this check reading an archive for a file coilbox no longer
 * writes: a silent pass on exactly the case it exists to catch.
 */
describe("the checked path", () => {
  it("is the one the compiler writes", () => {
    const source = readFileSync(
      "crates/tauri-plugin-coilbox-workshop/src/compile.rs",
      "utf8",
    );
    expect(source).toContain(`const POST_FILE: &str = "${POST_FILE}";`);
  });
});
