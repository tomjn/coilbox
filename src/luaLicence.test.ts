/**
 * The Lua that runs inside the engine is offered under MIT or GPL version 2 or
 * later (issue #3981, notice in `lua/LICENSE.md`). Every `license` field in a
 * gadget or widget has to say so in the same words, so a new file cannot
 * quietly declare something else.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildStartUnitGadget } from "./lego/scratchGame";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The string every `GetInfo` `license` field carries. */
const LICENCE = "MIT or GNU GPL, v2 or later";

/** Matches the field and captures its value, whatever the spacing. */
const FIELD = /\blicense\s*=\s*(["'])(.*?)\1/g;

function luaFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...luaFiles(path));
    else if (entry.name.endsWith(".lua")) found.push(path);
  }
  return found;
}

/** Lua the engine loads: everything under `lua/`, plus the probes in
 *  `scripts/` that are mounted into a game for a harness run. */
const FILES = [
  ...luaFiles(join(REPO, "lua")),
  ...luaFiles(join(REPO, "scripts")),
];

function declared(path: string): string[] {
  return [...readFileSync(path, "utf8").matchAll(FIELD)].map((m) => m[2]);
}

describe("the licence the Lua declares", () => {
  it("finds the Lua to check", () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it("is the same string in every file that declares one", () => {
    const wrong = FILES.flatMap((path) =>
      declared(path)
        .filter((value) => value !== LICENCE)
        .map((value) => `${relative(REPO, path)}: ${value}`),
    );
    expect(wrong).toEqual([]);
  });

  it("is declared by every gadget and widget", () => {
    const silent = FILES.filter((path) => {
      const rel = relative(REPO, path).replaceAll("\\", "/");
      const loaded = /\/(gadgets|widgets)\/[^/]+\.lua$/.test(rel);
      return loaded && !rel.includes("/tests/") && declared(path).length === 0;
    }).map((path) => relative(REPO, path));
    expect(silent).toEqual([]);
  });

  it("is not changed by the unit builder's generated gadget", () => {
    const lua = buildStartUnitGadget("cakebot_test");
    for (const match of lua.matchAll(FIELD)) expect(match[2]).toBe(LICENCE);
  });

  it("has a notice that names the string and the GPL text beside it", () => {
    const notice = readFileSync(join(REPO, "lua", "LICENSE.md"), "utf8");
    expect(notice).toContain(`license = "${LICENCE}"`);
    expect(notice).toContain("MIT OR GPL-2.0-or-later");
    expect(existsSync(join(REPO, "lua", "COPYING"))).toBe(true);
  });

  it("has a notice for a game that names the same licence and the files beside it", () => {
    const repo = readFileSync(join(REPO, "lua", "LICENSE.md"), "utf8");
    const game = readFileSync(join(REPO, "lua", "GAME-NOTICE.md"), "utf8");
    const spdx = (text: string) =>
      text.match(/^SPDX-License-Identifier:.*$/m)?.[0];
    expect(spdx(repo)).toBeDefined();
    expect(spdx(game)).toBe(spdx(repo));
    expect(game).toContain(`license = "${LICENCE}"`);
    expect(game).toContain("(LICENSE-MIT)");
    expect(game).toContain("(COPYING)");
    expect(existsSync(join(REPO, "LICENSE"))).toBe(true);
  });
});

/** The three files that go beside the Lua, as the bundle's resource sources. */
const NOTICE_SOURCES = {
  "NOTICE.md": "../lua/GAME-NOTICE.md",
  "LICENSE-MIT": "../LICENSE",
  COPYING: "../lua/COPYING",
};

/**
 * The Lua folders in a bundle's resource map that have no notice beside them
 * (issue #4005). A Lua folder is a resource whose source is a folder under
 * `lua/` holding a `.lua` file. The notice is beside it when the map puts all
 * three files in one folder named like the games' `coilbox-licence`, and that
 * folder has the same parent as the Lua folder's destination.
 */
function luaWithoutNotice(resources: Record<string, string>): string[] {
  const luaFolders = Object.keys(resources).filter((source) => {
    if (!/^\.\.\/lua\/[^/]+$/.test(source)) return false;
    const path = join(REPO, "src-tauri", source);
    return (
      existsSync(path) &&
      statSync(path).isDirectory() &&
      luaFiles(path).length > 0
    );
  });
  const folders = Object.entries(NOTICE_SOURCES).map(([name, source]) =>
    resources[source]?.endsWith(`/${name}`)
      ? resources[source].slice(0, -name.length - 1)
      : undefined,
  );
  const [folder] = folders;
  if (
    folder === undefined ||
    !folder.endsWith("coilbox-licence") ||
    !folders.every((f) => f === folder)
  ) {
    return luaFolders;
  }
  const parent = (path: string) => path.split("/").slice(0, -1).join("/");
  return luaFolders.filter(
    (source) => parent(resources[source]) !== parent(folder),
  );
}

describe("the licence notice in the app bundle", () => {
  const conf = JSON.parse(
    readFileSync(join(REPO, "src-tauri", "tauri.conf.json"), "utf8"),
  );
  const resources: Record<string, string> = conf.bundle.resources;

  it("sits beside the Lua the bundle ships", () => {
    expect(Object.keys(resources)).toContain("../lua/mission-runtime");
    expect(luaWithoutNotice(resources)).toEqual([]);
  });

  it("is noticed when a Lua folder is added without it", () => {
    const withoutNotice = Object.fromEntries(
      Object.entries(resources).filter(
        ([source]) => !Object.values(NOTICE_SOURCES).includes(source),
      ),
    );
    expect(luaWithoutNotice(withoutNotice)).toContain("../lua/mission-runtime");

    const missingOne = { ...resources };
    delete missingOne["../lua/COPYING"];
    expect(luaWithoutNotice(missingOne)).toContain("../lua/mission-runtime");

    const elsewhere = { ...resources, "../lua/rewind-player": "deep/rewind" };
    expect(luaWithoutNotice(elsewhere)).toEqual(["../lua/rewind-player"]);
  });

  it("is made of files that exist", () => {
    for (const source of Object.values(NOTICE_SOURCES)) {
      expect(existsSync(join(REPO, "src-tauri", source))).toBe(true);
    }
  });

  it("is moved with the Lua by the Windows installer", () => {
    const hooks = readFileSync(
      join(REPO, "src-tauri", "nsis-hooks.nsh"),
      "utf8",
    );
    expect(hooks).toContain(
      'Rename "$INSTDIR\\coilbox-licence" "$INSTDIR\\.coilbox\\resources\\coilbox-licence"',
    );
  });
});
