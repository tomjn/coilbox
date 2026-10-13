/**
 * The Lua that runs inside the engine is offered under MIT or GPL version 2 or
 * later (issue #3981, notice in `lua/LICENSE.md`). Every `license` field in a
 * gadget or widget has to say so in the same words, so a new file cannot
 * quietly declare something else.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
});
