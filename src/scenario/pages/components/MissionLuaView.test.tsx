// @vitest-environment happy-dom
/**
 * The mission file put on screen for somebody to read (issue #2163).
 *
 * The compiler is already covered by `compile.test.ts`, so what is asserted
 * here is that the view shows that compiler's output rather than a rendering of
 * its own, that the clipboard gets the same bytes, and that a document the
 * compiler refuses says so instead of taking the editor down.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileScenario } from "../../compile";
import { newScenario } from "../../create";
import type { Scenario } from "../../model";
import { compiledMissionText, MissionLuaView } from "./MissionLuaView";

/** A scenario with something in it, so the Lua is more than an empty shell. */
function withAZone(name: string): Scenario {
  return {
    ...newScenario(name),
    zones: [
      {
        id: "landing",
        name: "Landing site",
        shape: "circle",
        center: { x: 512, z: 512 },
        radius: 300,
      },
    ],
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the compiled mission on screen", () => {
  it("shows exactly what the compiler emits", () => {
    const scenario = withAZone("Landing");
    render(<MissionLuaView scenario={scenario} />);

    expect(screen.getByText(/^-- Compiled by coilbox/)).toHaveProperty(
      "textContent",
      compileScenario(scenario),
    );
  });

  it("names where the file goes in the game", () => {
    const scenario = withAZone("Landing");
    render(<MissionLuaView scenario={scenario} />);

    expect(
      screen.getByText(`missions/${scenario.id}/mission.lua`),
    ).toBeTruthy();
  });

  it("copies the file itself, not a summary of it", async () => {
    const scenario = withAZone("Landing");
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<MissionLuaView scenario={scenario} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(compileScenario(scenario));
    expect(await screen.findByText("Copied")).toBeTruthy();
  });

  it("says why a document does not compile rather than throwing", () => {
    // The compiler refuses a coordinate it cannot write as a Lua literal, and a
    // mission that will not compile is exactly the one somebody opens this to
    // look at.
    const broken: Scenario = {
      ...newScenario("Broken"),
      actors: [
        {
          id: "lost",
          unitDef: "armcom",
          team: "player",
          pos: { x: Number.POSITIVE_INFINITY, z: 0 },
          facing: 0,
        },
      ],
    };

    expect(compiledMissionText(broken).error).toContain("non-finite");

    render(<MissionLuaView scenario={broken} />);

    expect(screen.getByText(/does not compile/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
