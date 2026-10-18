// @vitest-environment happy-dom

/**
 * Which of the game's builders build the unit (issue #4515): the chosen ones
 * are listed by name, one can be removed, and only the rest are offered.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LegoProject, newProject } from "../../model";
import { BuiltBySection } from "./BuiltBySection";

const source = vi.fn();
vi.mock("./useBuildMenuSource", () => ({ useBuildMenuSource: () => source() }));

function unit(builtBy?: string[]): LegoProject {
  return {
    ...newProject({
      id: "p",
      rootPieceId: "root",
      name: "Sky fort",
      packId: "lego",
      packVersion: "1",
      now: "2026-10-18T00:00:00Z",
    }),
    ...(builtBy ? { builtBy } : {}),
  };
}

beforeEach(() => {
  source.mockReturnValue({
    gameName: "Splinter Faction 0.1.93",
    gameFolder: "/games/SF.sdd",
    units: {
      fedlandfac: { name: "Land Factory", buildoptions: ["fedbear"] },
      fedengineer: { name: "Engineer", buildoptions: ["fedmex"] },
      fedbear: { name: "Bear" },
    },
    checksum: "sum",
    installed: [],
    unavailable: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BuiltBySection", () => {
  it("lists the chosen builders by name and removes one", () => {
    const onBuiltByChange = vi.fn();
    render(
      <BuiltBySection
        project={unit(["fedlandfac", "fedengineer"])}
        onBuiltByChange={onBuiltByChange}
      />,
    );
    expect(screen.getByText("Land Factory (fedlandfac)")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Engineer (fedengineer)" }),
    );
    expect(onBuiltByChange).toHaveBeenCalledWith(["fedlandfac"]);
  });

  it("offers only the builders not chosen yet, and adds one", async () => {
    const onBuiltByChange = vi.fn();
    render(
      <BuiltBySection
        project={unit(["fedlandfac"])}
        onBuiltByChange={onBuiltByChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add a builder/ }));
    const option = await screen.findByRole("option", {
      name: "Engineer (fedengineer)",
    });
    expect(
      screen.queryByRole("option", { name: "Land Factory (fedlandfac)" }),
    ).toBeNull();
    expect(screen.queryByRole("option", { name: /Bear/ })).toBeNull();
    fireEvent.click(option);
    expect(onBuiltByChange).toHaveBeenCalledWith(["fedlandfac", "fedengineer"]);
  });

  it("says why there is nothing to pick from", () => {
    source.mockReturnValue({
      gameName: null,
      gameFolder: null,
      units: null,
      checksum: undefined,
      installed: [],
      unavailable: "Choose a game for this unit first.",
    });
    render(<BuiltBySection project={unit()} onBuiltByChange={vi.fn()} />);
    expect(screen.getByText("Choose a game for this unit first.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add a builder/ })).toBeNull();
  });
});
