import { describe, expect, it } from "vitest";
import {
  afterScriptReload,
  loadedFrom,
  relaunchMessage,
  sandboxChanges,
} from "./sandboxReload";
import type { WrittenScratchUnit } from "./writeScratchGame";

const DIR = "/data/games/coilbox-lego-test.sdd";

function written(
  digests: Partial<Record<"model" | "script" | "collision" | "def", string>>,
  { unit = "probe_unit", textures = "atlas-a" } = {},
): WrittenScratchUnit {
  const paths = {
    model: `${DIR}/objects3d/${unit}.s3o`,
    script: `${DIR}/scripts/${unit}.lua`,
    collision: `${DIR}/scripts/coilbox/${unit}_collision.lua`,
    def: `${DIR}/units/${unit}.lua`,
  };
  const files = (["model", "script", "collision", "def"] as const).map(
    (kind) => ({ path: paths[kind], sha256: digests[kind] ?? `${kind}-1` }),
  );
  return { dir: DIR, files, textures };
}

describe("sandboxChanges", () => {
  const launched = loadedFrom(written({}));

  it("finds nothing when the unit is as the game started with it", () => {
    expect(sandboxChanges(launched, written({}))).toEqual({
      reload: false,
      relaunch: [],
    });
  });

  it("reloads a changed script, with nothing to relaunch for", () => {
    expect(sandboxChanges(launched, written({ script: "script-2" }))).toEqual({
      reload: true,
      relaunch: [],
    });
  });

  it("counts the collision volumes as part of the script", () => {
    expect(
      sandboxChanges(launched, written({ collision: "collision-2" })).reload,
    ).toBe(true);
  });

  it("needs a relaunch for a changed definition, and still reloads the script", () => {
    expect(
      sandboxChanges(launched, written({ def: "def-2", script: "script-2" })),
    ).toEqual({ reload: true, relaunch: ["definition"] });
  });

  // The script moves the model's pieces, so a new script on the old model is a
  // unit that is neither one thing nor the other.
  it("holds the script back when the model changed too", () => {
    expect(
      sandboxChanges(
        launched,
        written({ model: "model-2", script: "script-2" }),
      ),
    ).toEqual({ reload: false, relaunch: ["model"] });
  });

  it("needs a relaunch for a different texture", () => {
    expect(
      sandboxChanges(launched, written({}, { textures: "atlas-b" })).relaunch,
    ).toEqual(["texture"]);
  });

  // A running game only sees files that were there when it started.
  it("needs a relaunch for a renamed unit, whose files are all new", () => {
    expect(
      sandboxChanges(launched, written({}, { unit: "probe_two" })),
    ).toEqual({ reload: false, relaunch: ["files"] });
  });

  it("names each part once, in a fixed order", () => {
    expect(
      sandboxChanges(
        launched,
        written({ def: "def-2", model: "model-2" }, { textures: "atlas-b" }),
      ).relaunch,
    ).toEqual(["definition", "model", "texture"]);
  });

  it("reads a Windows path the same way", () => {
    const win = (w: WrittenScratchUnit): WrittenScratchUnit => ({
      ...w,
      dir: w.dir.replaceAll("/", "\\"),
      files: w.files.map((f) => ({ ...f, path: f.path.replaceAll("/", "\\") })),
    });
    expect(
      sandboxChanges(
        loadedFrom(win(written({}))),
        win(written({ def: "def-2" })),
      ).relaunch,
    ).toEqual(["definition"]);
  });
});

describe("afterScriptReload", () => {
  it("takes on the new script and nothing else", () => {
    const launched = loadedFrom(written({}));
    const now = written({ script: "script-2", def: "def-2" });
    const loaded = afterScriptReload(launched, now);

    expect(sandboxChanges(loaded, now)).toEqual({
      reload: false,
      relaunch: ["definition"],
    });
  });
});

describe("relaunchMessage", () => {
  it("is null with nothing to relaunch for", () => {
    expect(relaunchMessage([])).toBeNull();
  });

  it("says what changed and that a relaunch shows it", () => {
    expect(relaunchMessage(["model"])).toBe(
      "The model changed. The engine cannot reload a model in a running game, so relaunch to see it.",
    );
  });

  it("names every part that changed", () => {
    expect(relaunchMessage(["definition", "model"])).toBe(
      "The unit definition and the model changed. The engine cannot reload them in a running game, so relaunch to see them.",
    );
  });

  it("does not claim the engine cannot reload a texture", () => {
    expect(relaunchMessage(["texture"])).toBe(
      "The texture changed. Coilbox does not reload a texture in a running game yet, so relaunch to see it.",
    );
  });

  it("makes no claim about a texture listed with other parts", () => {
    expect(relaunchMessage(["model", "texture"])).toBe(
      "The model and the texture changed. Relaunch to see them in the game.",
    );
  });

  it("says why new files need a relaunch", () => {
    expect(relaunchMessage(["files"])).toBe(
      "The unit has files the game did not start with, so relaunch to see them.",
    );
  });
});
