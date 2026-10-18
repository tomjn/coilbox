import { describe, expect, it } from "vitest";
import { PRESETS } from "./animPresets";
import { type LegoProject, newProject } from "./model";
import { scenarioCallins } from "./scenarioMarks";
import { scenarioById } from "./scriptPlayback";
import { SOLO_SCENARIOS, soloProject, soloScenario } from "./soloPreset";

describe("the scenario for each preset", () => {
  it("names one for every preset, and no other", () => {
    expect(Object.keys(SOLO_SCENARIOS).sort()).toEqual(
      PRESETS.map((preset) => preset.id).sort(),
    );
  });

  it("names a scenario that exists", () => {
    for (const preset of PRESETS) {
      expect(
        scenarioById(soloScenario(preset.id) ?? ""),
        preset.id,
      ).toBeTruthy();
    }
  });

  /** Nano answers `QueryNanoPiece`, which no scenario fires. Hover and bob
   *  starts on `Create`, which every scenario fires. */
  it("fires a call-in the preset fills", () => {
    for (const preset of PRESETS) {
      const params = Object.fromEntries(
        preset.params.map((param) => [param.id, param.fallback]),
      );
      const result = preset.emit({
        params,
        signal: "SIG",
        pieces: () => ["piece"],
        wheels: () => [{ piece: "piece", radius: 1, front: true }],
        motion: { accRate: 0.5, decRate: 0.5 },
        weapons: () => [{ number: 1, piece: () => "piece", signal: "SIG" }],
        instances: () => [
          {
            id: "",
            params,
            number: 1,
            pieces: () => ["piece"],
            signal: "SIG",
            name: (n) => n,
          },
        ],
      });
      const filled = Object.entries(result?.hooks ?? {})
        .filter(([, lines]) => (lines?.length ?? 0) > 0)
        .map(([name]) => name);
      const fired = scenarioCallins(scenarioById(SOLO_SCENARIOS[preset.id])!);
      if (preset.id === "build.nano") {
        expect(filled).toEqual(["QueryNanoPiece"]);
      } else if (preset.id === "hover.bob") {
        expect(filled).toEqual(["Create"]);
      } else {
        expect(
          fired.some((name) => filled.includes(name)),
          preset.id,
        ).toBe(true);
      }
    }
  });
});

describe("soloProject", () => {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "unit",
    packId: "lego",
    packVersion: "1",
    now: "2026-08-22T00:00:00Z",
  });
  const project: LegoProject = {
    ...base,
    animations: [
      { presetId: "walk.biped", params: {} },
      { presetId: "idle.sway", params: { turn: 3 } },
    ],
  };

  it("keeps only the chosen preset, with its settings", () => {
    expect(soloProject(project, "idle.sway").animations).toEqual([
      { presetId: "idle.sway", params: { turn: 3 } },
    ]);
  });

  it("leaves the project it was given alone", () => {
    soloProject(project, "idle.sway");
    expect(project.animations).toHaveLength(2);
  });
});
