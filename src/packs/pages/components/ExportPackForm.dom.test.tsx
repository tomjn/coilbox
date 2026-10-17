// @vitest-environment happy-dom
/**
 * A scan whose unitsync Init failed has not said what is installed (issue
 * #3423), so the pickers must show the failure and not say no games or maps
 * are installed.
 */
import { memoryStorage, PersistentStoreProvider } from "@picoframe/frame";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const scan = vi.hoisted(() => ({
  current: {
    data: null as unknown,
    error: null as string | null,
    loading: false,
  },
}));

vi.mock("../../../content/config", () => ({
  useUnitsyncScan: () => scan.current,
}));
vi.mock("../../../play/config", () => ({
  usePreferredTarget: () => ({ target: {} }),
}));
vi.mock("../../../play/presets", () => ({
  useSkirmishPresets: () => ({ presets: [] }),
}));

const library = vi.hoisted(() => ({ records: [] as unknown[] }));
vi.mock("../../../blueprint/store", () => ({
  useBlueprintLibrary: () => ({ records: library.records }),
}));

import { decodeSetupPack } from "../../manifest";
import { ExportPackForm } from "./ExportPackForm";

afterEach(cleanup);

describe("ExportPackForm", () => {
  it("shows the failure and not an empty install when the scan failed", () => {
    scan.current = {
      data: null,
      error: "no space left on device",
      loading: false,
    };
    render(<ExportPackForm />);
    expect(screen.getAllByText(/no space left on device/)).toHaveLength(2);
    expect(screen.queryByText(/installed for this engine/)).toBeNull();
  });

  it("still says nothing is installed when the scan answered empty", () => {
    scan.current = {
      data: { games: [], maps: [] },
      error: null,
      loading: false,
    };
    render(<ExportPackForm />);
    expect(
      screen.getByText("No games installed for this engine."),
    ).toBeTruthy();
  });

  it("puts a ticked blueprint in the pack", () => {
    scan.current = {
      data: {
        games: [
          {
            name: "Game A",
            info: { shortname: "ga" },
            primaryArchive: { name: "game-a.sdz" },
          },
        ],
        maps: [],
      },
      error: null,
      loading: false,
    };
    const layout = {
      game: { name: "Game A", shortname: "ga" },
      name: "Opening solars",
      buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 }],
      footprints: { armsolar: { x: 4, z: 4 } },
    };
    library.records = [
      { id: "b1", createdAt: "", updatedAt: "", layout },
      {
        id: "b2",
        createdAt: "",
        updatedAt: "",
        layout: { ...layout, name: "Left out" },
      },
    ];
    render(
      <PersistentStoreProvider storage={memoryStorage()}>
        <ExportPackForm />
      </PersistentStoreProvider>,
    );
    const tick = (label: string) => {
      const row = screen.getByText(label).closest("label");
      if (!row) throw new Error(`no row for ${label}`);
      fireEvent.click(within(row).getByRole("checkbox"));
    };
    tick("Game A");
    tick("Opening solars");
    fireEvent.click(screen.getByText("Create pack code"));

    const code = (screen.getByRole("textbox") as HTMLTextAreaElement).value;
    const result = decodeSetupPack(code);
    expect(result.ok && result.settings.blueprints).toEqual([layout]);
  });
});
