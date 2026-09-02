// @vitest-environment happy-dom
/**
 * The mission file put on screen for somebody to read (issue #2163), and the
 * line numbers, colour and find box issue #2282 adds on top of it.
 *
 * The compiler is already covered by `compile.test.ts`, so what is asserted
 * here is that the view shows that compiler's output rather than a rendering of
 * its own, that the clipboard gets the same bytes, that a document the
 * compiler refuses says so instead of taking the editor down, and that find
 * counts and steps through matches without fighting the drawer it lives in.
 * `MissionLuaCode`'s own line numbers, highlighting and virtualization are
 * covered directly in `MissionLuaCode.test.tsx`.
 */

import { Drawer } from "@picoframe/frame";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
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

/** `MissionLuaView` rendered inside a real, open drawer, the way
 *  `ScenarioEditPage` uses it, so the escape-key test below exercises the
 *  actual Radix dialog this view has to coexist with rather than a stand-in. */
function InDrawer({
  scenario,
  onOpenChange,
}: {
  scenario: Scenario;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        setOpen(next);
      }}
      title="mission.lua"
    >
      <MissionLuaView scenario={scenario} />
    </Drawer>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the compiled mission on screen", () => {
  it("shows exactly what the compiler emits, line by line", () => {
    const scenario = withAZone("Landing");
    render(<MissionLuaView scenario={scenario} />);

    const rendered = screen
      .getAllByTestId("mission-lua-line-text")
      .map((el) => el.textContent)
      .join("\n");
    expect(rendered).toBe(compileScenario(scenario));
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

describe("finding a line in the mission", () => {
  it("announces nothing until there is a query", () => {
    render(<MissionLuaView scenario={withAZone("Landing")} />);
    expect(screen.getByTestId("mission-lua-match-count").textContent).toBe("");
  });

  it("counts matches and steps forward and back with Enter and Shift+Enter", () => {
    render(<MissionLuaView scenario={withAZone("Landing")} />);
    const input = screen.getByLabelText("Find in mission.lua");

    fireEvent.change(input, { target: { value: "id" } });
    expect(screen.getByText("1 of 2")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("2 of 2")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("1 of 2")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByText("2 of 2")).toBeTruthy();
  });

  it("says plainly when a query has no matches", () => {
    render(<MissionLuaView scenario={withAZone("Landing")} />);
    const input = screen.getByLabelText("Find in mission.lua");

    fireEvent.change(input, { target: { value: "nothing to find here" } });

    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("focuses the find box on Cmd/Ctrl+F", () => {
    render(<MissionLuaView scenario={withAZone("Landing")} />);
    const input = screen.getByLabelText("Find in mission.lua");
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(window, { key: "f", metaKey: true });

    expect(document.activeElement).toBe(input);
  });

  it("leaves the find box on Escape without closing the drawer around it", () => {
    const onOpenChange = vi.fn();
    render(
      <InDrawer scenario={withAZone("Landing")} onOpenChange={onOpenChange} />,
    );
    const input = screen.getByLabelText("Find in mission.lua");
    act(() => input.focus());
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape" });

    expect(document.activeElement).not.toBe(input);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
