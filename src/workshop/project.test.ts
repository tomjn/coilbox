// @vitest-environment happy-dom
/**
 * What a project has to survive: being closed (issue #1282).
 *
 * The round trip below is the whole issue in one test. It builds a project
 * holding one of each of the five things a project can hold, saves it, reads it
 * back, and checks that what comes out is what went in, sparse set and all. Two
 * routes are checked because there are two: the settings store the app saves to,
 * and the container a `.json` export travels in.
 *
 * Everything is built through the stores' own functions rather than written out
 * by hand, so a project that could not be produced by using the page cannot be
 * what the round trip proves.
 */
import { PersistentStoreProvider } from "@picoframe/frame";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { identify } from "../container/container";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "../lib/storedSetting";
import { addToBuildMenu, moveInBuildMenu } from "./buildMenus";
import { addClone, deriveClone } from "./clones";
import { setUnitDisabled } from "./disabled";
import { setOverride } from "./overrides";
import {
  defaultProjectName,
  EMPTY_EDITS,
  editCounts,
  editSlot,
  type GameEdits,
  isEmptyEdits,
  modProjectCode,
  modProjectJson,
  parseGameEdits,
  parseModProjectJson,
  useModProjects,
} from "./project";
import { setUnitText } from "./unitText";

let storage = memorySettingsStorage();

beforeEach(() => {
  storage = memorySettingsStorage();
  installSettingsStorage(storage);
});

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(PersistentStoreProvider, { storage, children });

/** Balanced Annihilation's commander, cut down to the keys used here. */
const ARMCOM: Record<string, unknown> = {
  name: "armcom",
  humanName: "Commander",
  health: 3000,
};

/** What a factory in this game builds, which the menu operations replay over. */
const ARMLAB_MENU = ["armpw", "armrock", "armham"];

/** One of each of the five things a project can hold, built the way the page
 * builds them. */
function fullEdits(): GameEdits {
  let edits = EMPTY_EDITS;
  // A field the user changed, against the value the game gives.
  edits = editSlot(edits, "overrides", (o) =>
    setOverride(o, "armcom", "health", 5000, 3000),
  );
  // A unit of their own, taken of the commander as the project has it.
  edits = editSlot(edits, "clones", (c) =>
    addClone(
      c,
      deriveClone({
        key: "armcom2",
        source: "armcom",
        sourceDef: ARMCOM,
        patch: edits.overrides.armcom,
        displayName: "Super Commander",
        replacesGameUnit: false,
        home: "def",
      }).clone,
    ),
  );
  // A build menu with the new unit on it and one entry moved.
  edits = editSlot(edits, "menus", (m) =>
    addToBuildMenu(m, "armlab", "armcom2", ARMLAB_MENU),
  );
  edits = editSlot(edits, "menus", (m) =>
    moveInBuildMenu(m, "armlab", "armham", -1, ARMLAB_MENU),
  );
  // A unit switched off across the game.
  edits = editSlot(edits, "disabled", (d) => setUnitDisabled(d, "armpw", true));
  // A rename that lands in the language file rather than in the def.
  edits = editSlot(edits, "text", (t) =>
    setUnitText(t, "armrock", "en", "name", "Pebble", "Rocko"),
  );
  return edits;
}

describe("a project survives being closed", () => {
  it("saves, reloads and comes back identical", () => {
    const edits = fullEdits();

    const first = renderHook(() => useModProjects(), { wrapper });
    let id = "";
    act(() => {
      const project = first.result.current.createProject({
        name: "Big guns",
        gameName: "Balanced Annihilation V15.9.8",
        authoredChecksum: "abc123",
      });
      id = project.id;
      first.result.current.setEdits(project.id, edits);
    });
    first.unmount();

    // A second mount over the same storage is what reopening the app does.
    const second = renderHook(() => useModProjects(), { wrapper });
    const reloaded = second.result.current.projects.find((p) => p.id === id);

    expect(reloaded).toBeDefined();
    expect(reloaded?.name).toBe("Big guns");
    expect(reloaded?.gameName).toBe("Balanced Annihilation V15.9.8");
    expect(reloaded?.authoredChecksum).toBe("abc123");
    expect(reloaded?.edits).toEqual(edits);

    // The whole point of the override set, checked on the way back out: one
    // unit, one field, and nothing the user only looked at.
    expect(Object.keys(reloaded?.edits.overrides ?? {})).toEqual(["armcom"]);
    expect(Object.keys(reloaded?.edits.overrides.armcom ?? {})).toEqual([
      "health",
    ]);
    expect(editCounts(reloaded?.edits ?? EMPTY_EDITS)).toEqual({
      fields: 2,
      added: 1,
      menuOps: 2,
      off: 1,
    });
  });

  it("round trips through an exported file", () => {
    const edits = fullEdits();
    const project = {
      id: "whatever",
      name: "Big guns",
      gameName: "Balanced Annihilation V15.9.8",
      authoredChecksum: "abc123",
      edits,
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
    };

    const imported = parseModProjectJson(modProjectJson(project));

    expect(imported).toBeDefined();
    expect(imported?.name).toBe("Big guns");
    expect(imported?.gameName).toBe("Balanced Annihilation V15.9.8");
    expect(imported?.authoredChecksum).toBe("abc123");
    expect(imported?.edits).toEqual(edits);
    expect(Object.keys(imported?.edits.overrides ?? {})).toEqual(["armcom"]);
  });

  it("is a container anything can recognise without opening it", () => {
    const project = {
      id: "whatever",
      name: "Big guns",
      gameName: "Balanced Annihilation V15.9.8",
      edits: fullEdits(),
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
    };
    const id = identify(modProjectJson(project));
    expect(id.kind).toBe("mod-project");
    expect(id.compatibility).toBe("ok");
    expect(id.warnings).toEqual([]);
    expect(id.game?.name).toBe("Balanced Annihilation V15.9.8");
  });

  it("shares as a code small enough to paste", () => {
    const project = {
      id: "whatever",
      name: "Big guns",
      gameName: "Balanced Annihilation V15.9.8",
      edits: fullEdits(),
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
    };
    const result = modProjectCode(project);
    expect(result.ok).toBe(true);
    if (result.ok) expect(parseModProjectJson(result.code)).toBeTruthy();
  });
});

describe("editSlot", () => {
  it("writes one store and leaves the other four alone", () => {
    const before = fullEdits();
    const after = editSlot(before, "disabled", (d) =>
      setUnitDisabled(d, "armrock", true),
    );

    expect(after.disabled).toEqual(["armpw", "armrock"]);
    // Identity, not equality: the other four are the same objects, which is
    // what makes an undo snapshot cost the change and nothing else.
    expect(after.overrides).toBe(before.overrides);
    expect(after.clones).toBe(before.clones);
    expect(after.menus).toBe(before.menus);
    expect(after.text).toBe(before.text);
  });

  it("hands back what it was given when the store changed nothing", () => {
    const before = fullEdits();
    // Switching on a unit that was never off is not a change, and `disabled.ts`
    // says so by returning the set it was handed.
    const after = editSlot(before, "disabled", (d) =>
      setUnitDisabled(d, "armrock", false),
    );
    expect(after).toBe(before);
  });

  it("calls a project with nothing in any store empty", () => {
    expect(isEmptyEdits(EMPTY_EDITS)).toBe(true);
    expect(isEmptyEdits(fullEdits())).toBe(false);
    // One mark in one store is enough, including the one that is a list.
    expect(
      isEmptyEdits(
        editSlot(EMPTY_EDITS, "disabled", (d) =>
          setUnitDisabled(d, "armpw", true),
        ),
      ),
    ).toBe(false);
  });
});

describe("reading an untrusted file", () => {
  it("refuses anything that is not a tweak project container", () => {
    expect(parseModProjectJson("")).toBeNull();
    expect(parseModProjectJson("not json")).toBeNull();
    expect(parseModProjectJson(JSON.stringify({ name: "x" }))).toBeNull();
    expect(
      parseModProjectJson(
        JSON.stringify({
          format: "coilbox",
          container: 1,
          kind: "preset",
          kindVersion: 1,
          payload: { name: "x", gameName: "y", edits: {} },
        }),
      ),
    ).toBeNull();
  });

  it("refuses a payload from a newer coilbox", () => {
    expect(
      parseModProjectJson(
        JSON.stringify({
          format: "coilbox",
          container: 1,
          kind: "mod-project",
          kindVersion: 99,
          payload: { name: "x", gameName: "y", edits: {} },
        }),
      ),
    ).toBeNull();
  });

  it("drops junk inside the stores rather than adopting it", () => {
    const edits = parseGameEdits({
      // An empty patch is the non-sparse shape the whole design refuses, so it
      // is dropped rather than loaded back in.
      overrides: { armcom: { health: 5000 }, armpw: {}, armham: "nonsense" },
      clones: { good: { source: "armcom", def: {} }, bad: { source: 7 } },
      menus: {
        armlab: [
          { op: "add", unit: "armpw" },
          { op: "explode", unit: "armpw" },
          { op: "move", unit: "armpw", before: 3 },
        ],
        empty: [],
      },
      text: { armrock: { name: "Pebble", description: 7 }, blank: {} },
      disabled: ["ARMPW", "armpw", 7, " armrock "],
    });

    expect(edits.overrides).toEqual({ armcom: { health: 5000 } });
    expect(Object.keys(edits.clones)).toEqual(["good"]);
    expect(edits.clones.good.replacesGameUnit).toBe(false);
    expect(edits.menus).toEqual({ armlab: [{ op: "add", unit: "armpw" }] });
    // Lifted into English, which is the only language a store written in that
    // shape could hold: it predates #2672 and the worker read `language/en`
    // and nothing else.
    expect(edits.text).toEqual({ armrock: { en: { name: "Pebble" } } });
    // Lowercased, de-duplicated and sorted, which is what `disabled.ts` keeps.
    expect(edits.disabled).toEqual(["armpw", "armrock"]);
  });

  /**
   * Issue #2672. The text store gained a language dimension, and projects saved
   * before it hold the fields straight under the unit. Those are English edits,
   * because `language/en/units.json` was the only file the worker read.
   */
  it("reads a text store written before it had languages", () => {
    const edits = parseGameEdits({
      text: {
        armrock: { name: "Pebble", description: "Throws rocks" },
        armaak: { de: { name: "Erzengel" } },
        // Both shapes on one unit, which only a hand-edited file produces. The
        // language object wins, since it is the newer of the two.
        armcom: { name: "Boss", en: { name: "Overlord" } },
      },
    });

    expect(edits.text).toEqual({
      armrock: { en: { name: "Pebble", description: "Throws rocks" } },
      armaak: { de: { name: "Erzengel" } },
      armcom: { en: { name: "Overlord" } },
    });
  });

  /**
   * A unit built in the lego builder is a file in the game folder, read off the
   * folder each time (issue #2651). It is not an edit, so it has no `source`
   * and it does not belong in a project. Loading one drops it rather than
   * pinning a stale copy of a definition the game already owns.
   */
  it("refuses a unit that came from the lego builder rather than a copy", () => {
    const edits = parseGameEdits({
      clones: {
        skyfort: {
          key: "skyfort",
          origin: {
            kind: "lego",
            projectId: "p1",
            projectName: "Sky Fortress",
          },
          replacesGameUnit: false,
          def: { name: "Sky Fortress" },
        },
        armcom2: { source: "armcom", def: { name: "armcom2" } },
      },
    });
    expect(Object.keys(edits.clones)).toEqual(["armcom2"]);
  });
});

describe("naming and copying", () => {
  it("names a project after its game, and numbers a second one", () => {
    const existing = [
      { name: "Balanced Annihilation V15.9.8 tweaks" },
      { name: "Balanced Annihilation V15.9.8 tweaks 2" },
    ];
    expect(defaultProjectName("Balanced Annihilation V15.9.8", [])).toBe(
      "Balanced Annihilation V15.9.8 tweaks",
    );
    expect(defaultProjectName("Balanced Annihilation V15.9.8", existing)).toBe(
      "Balanced Annihilation V15.9.8 tweaks 3",
    );
  });

  it("duplicates a project without sharing its identity or its edits", () => {
    const { result } = renderHook(() => useModProjects(), { wrapper });
    let id = "";
    act(() => {
      const project = result.current.createProject({
        name: "Big guns",
        gameName: "Balanced Annihilation V15.9.8",
        authoredChecksum: "abc123",
        edits: fullEdits(),
      });
      id = project.id;
    });

    let copyId = "";
    act(() => {
      copyId = result.current.duplicateProject(id)?.id ?? "";
    });

    const copy = result.current.projects.find((p) => p.id === copyId);
    const original = result.current.projects.find((p) => p.id === id);
    expect(copyId).not.toBe(id);
    expect(copy?.name).toBe("Big guns copy");
    expect(copy?.edits).toEqual(original?.edits);
    // The copy was written against the same game, so it keeps saying so, and
    // copying edits does not count as changing them.
    expect(copy?.authoredChecksum).toBe("abc123");
    expect(copy?.updatedAt).toBe(original?.updatedAt);

    // Editing one does not reach the other.
    act(() => {
      result.current.setEdits(copyId, EMPTY_EDITS);
    });
    expect(result.current.projects.find((p) => p.id === id)?.edits).not.toEqual(
      EMPTY_EDITS,
    );
  });

  it("renames and describes without touching anything else", () => {
    const { result } = renderHook(() => useModProjects(), { wrapper });
    let id = "";
    act(() => {
      id = result.current.createProject({
        name: "Big guns",
        description: "  Everything shoots further.  ",
        gameName: "Balanced Annihilation V15.9.8",
        edits: fullEdits(),
      }).id;
    });
    expect(result.current.projects.find((p) => p.id === id)?.description).toBe(
      "Everything shoots further.",
    );

    act(() => {
      result.current.updateProjectDetails(id, {
        name: "  Bigger guns  ",
        description: "  Even further.  ",
      });
    });
    const renamed = result.current.projects.find((p) => p.id === id);
    expect(renamed?.name).toBe("Bigger guns");
    expect(renamed?.description).toBe("Even further.");
    expect(renamed?.edits).toEqual(fullEdits());

    // An empty name is not a name, so the whole save is refused rather than
    // stored. An empty description is one somebody deleted, so it goes.
    act(() => {
      result.current.updateProjectDetails(id, { name: "   " });
    });
    expect(result.current.projects.find((p) => p.id === id)?.name).toBe(
      "Bigger guns",
    );
    act(() => {
      result.current.updateProjectDetails(id, {
        name: "Bigger guns",
        description: "  ",
      });
    });
    expect(result.current.projects.find((p) => p.id === id)).not.toHaveProperty(
      "description",
    );
  });

  it("keeps two games' projects apart", () => {
    const { result } = renderHook(() => useModProjects(), { wrapper });
    act(() => {
      result.current.createProject({
        name: "BA tweaks",
        gameName: "Balanced Annihilation V15.9.8",
        edits: editSlot(EMPTY_EDITS, "overrides", (o) =>
          setOverride(o, "armcom", "health", 5000, 3000),
        ),
      });
      result.current.createProject({
        name: "BAR tweaks",
        gameName: "Beyond All Reason test-30922-8064a43",
      });
    });

    const ba = result.current.projects.find((p) => p.name === "BA tweaks");
    const bar = result.current.projects.find((p) => p.name === "BAR tweaks");
    expect(ba?.edits.overrides.armcom).toEqual({ health: 5000 });
    expect(bar?.edits.overrides).toEqual({});
  });
});
