// @vitest-environment happy-dom

/**
 * The Terrain button and its toolbar (issue #4793). Turning Terrain on shows
 * the toolbar with no tool pressed and opens no menu, and picking a tool
 * presses it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { draftDefaults } from "@/blueprint/terrainDraft";
import type { TerrainTool } from "@/blueprint/terrainEdit";
import { TerrainDraftBar, TerrainToolsButton } from "./TerrainControls";

afterEach(cleanup);

/** The two as the editor lays them out: the button in its toolbar, and the
 *  terrain toolbar under it while the button is on. */
function Harness() {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<TerrainTool | null>(null);
  return (
    <>
      <TerrainToolsButton open={open} onOpen={setOpen} />
      {open && (
        <TerrainDraftBar
          tool={tool}
          onTool={setTool}
          settings={draftDefaults(tool)}
          onSettings={() => {}}
          drawing={false}
          onDone={() => setTool(null)}
          onCancel={() => setTool(null)}
          enabled
          onEnabled={() => {}}
        />
      )}
    </>
  );
}

const tool = (name: string) => screen.getByRole("radio", { name });

describe("the Terrain button", () => {
  it("shows the toolbar with no tool pressed and opens no menu", () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Terrain" });
    expect(button.getAttribute("aria-haspopup")).toBeNull();

    fireEvent.click(button);

    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    for (const name of ["Wall", "Area", "Ramp", "Smooth"]) {
      expect(tool(name).getAttribute("aria-checked")).toBe("false");
    }
  });

  it("presses a tool when it is picked", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Terrain" }));

    fireEvent.click(tool("Wall"));

    expect(tool("Wall").getAttribute("aria-checked")).toBe("true");
    expect(tool("Area").getAttribute("aria-checked")).toBe("false");
  });

  it("hides the toolbar when turned off again", () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Terrain" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByRole("radio", { name: "Wall" })).toBeNull();
  });
});
