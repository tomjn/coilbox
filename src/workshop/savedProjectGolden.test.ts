import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addToBuildMenu, moveBeforeInBuildMenu } from "./buildMenus";
import { removeFromBuildMenu } from "./buildMenus";
import { addClone } from "./clones";
import { setUnitDisabled } from "./disabled";
import { setOverride } from "./overrides";
import type { GameEdits, ModProject } from "./project";
import { EMPTY_EDITS } from "./project";
import { setUnitText } from "./unitText";

/**
 * One saved project, written by this side and read by the other (issue #2751).
 *
 * `crates/tauri-plugin-coilbox-workshop/src/model.rs` is a hand written mirror
 * of the five stores here, a cost accepted in writing when the compiler moved
 * to Rust (issue #1275). Nothing had ever checked the two against each other.
 * Every Rust test built its input in Rust and every test on this side replaced
 * `defineCommand` with a mock, so a project in the shape the settings store
 * actually holds had never once reached the real deserialiser.
 *
 * This is that project. The stores build it through their own functions rather
 * than from a literal, so the file holds what the app would really save, and
 * the Rust crate reads the same file back in `lib.rs`. A store that changes
 * shape moves this file, and the Rust job fails until `model.rs` follows.
 *
 * `galaxyGolden.test.ts` is the pattern, down to the env var. Regenerate after
 * an intended change with:
 *   UPDATE_WORKSHOP_FIXTURE=1 bun run test savedProjectGolden
 * then read the diff before committing it.
 */

const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "crates",
  "tauri-plugin-coilbox-workshop",
  "tests",
  "fixtures",
  "saved-project.json",
);

/** What the game's own build menu holds before the project touches it. */
const INHERITED_MENU = ["armpw", "armflash"];

function buildEdits(): GameEdits {
  let { overrides, clones, menus, text, disabled } = EMPTY_EDITS;

  // A number and a nested path, so the dotted keys an override set uses are
  // both in the file.
  overrides = setOverride(overrides, "armcom", "maxDamage", 5000, 3000);
  overrides = setOverride(
    overrides,
    "armcom",
    "weapondefs.disintegrator.range",
    400,
    300,
  );
  overrides = setOverride(overrides, "armflash", "buildTime", 900, 800);

  clones = addClone(clones, {
    key: "supercom",
    source: "armcom",
    replacesGameUnit: false,
    def: { name: "Super Commander", maxDamage: 9000, buildTime: 12000 },
  });

  // All three operations, in an order none of them prunes away.
  menus = addToBuildMenu(menus, "armlab", "armstump", INHERITED_MENU);
  menus = removeFromBuildMenu(menus, "armlab", "armflash", INHERITED_MENU);
  menus = moveBeforeInBuildMenu(
    menus,
    "armlab",
    "armstump",
    "armpw",
    INHERITED_MENU,
  );

  // Two languages under one unit, which is the nesting #2672 introduced.
  text = setUnitText(text, "armcom", "en", "name", "Commander", "Peewee");
  text = setUnitText(
    text,
    "armcom",
    "de",
    "description",
    "Kommandant",
    "Commander",
  );

  disabled = setUnitDisabled(disabled, "armbanth", true);
  disabled = setUnitDisabled(disabled, "armaser", true);

  return { overrides, clones, menus, text, disabled };
}

/**
 * The whole record, typed as `ModProject` so a field added to the project
 * fails here before it can reach the fixture unnoticed. Identity and timestamps
 * are fixed rather than generated: the only thing that should ever move this
 * file is a change to what a project holds.
 */
function buildProject(): ModProject {
  return {
    id: "5f6c1d9e-0000-4000-8000-0000000000ab",
    name: "Faster commanders",
    description: "What the checked-in fixture is for",
    gameName: "Balanced Annihilation V15.9.8",
    game: { name: "Balanced Annihilation V15.9.8", shortname: "BA" },
    authoredChecksum: "c6a15f1f",
    edits: buildEdits(),
    createdAt: "2026-09-08T11:44:47.201Z",
    updatedAt: "2026-09-08T11:47:21.638Z",
  };
}

describe("the saved project fixture the Rust crate reads", () => {
  it("matches what the stores produce today", () => {
    const emitted = `${JSON.stringify(buildProject(), null, 2)}\n`;

    if (process.env.UPDATE_WORKSHOP_FIXTURE) writeFileSync(FIXTURE, emitted);

    expect(emitted).toBe(readFileSync(FIXTURE, "utf8"));
  });

  /**
   * The fixture only proves anything about a store it actually holds something
   * for. A sixth store added to `GameEdits` with nothing written into it here
   * would reach `model.rs` unchecked, so this fails until the builder above
   * covers it.
   */
  it("holds something in every store a project has", () => {
    const edits = buildProject().edits;
    const empty = Object.entries(edits)
      .filter(([, value]) =>
        Array.isArray(value)
          ? value.length === 0
          : Object.keys(value).length === 0,
      )
      .map(([slot]) => slot);

    expect(empty).toEqual([]);
    expect(Object.keys(edits).sort()).toEqual(
      Object.keys(EMPTY_EDITS).sort(),
    );
  });
});
