// @vitest-environment happy-dom
/**
 * A scan whose unitsync Init failed has not said what is installed (issue
 * #3423). The arrival note for a pasted blueprint must not say the game is
 * "not installed here", and must not say coilbox is "still reading" either.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const scan = vi.hoisted(() => ({
  current: {
    data: null as unknown,
    error: null as string | null,
    loading: false,
    cancelled: false,
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/content/config", () => ({ useUnitsyncScan: () => scan.current }));
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({ target: {} }),
}));
vi.mock("@/content/useGameUnits", () => ({
  useGameUnits: () => ({ units: [], archive: undefined }),
}));
vi.mock("../../useGameSides", () => ({ useGameSides: () => [] }));
vi.mock("../../equivalentsStore", () => ({
  useEquivalents: () => ({ table: { groups: [] }, remember: () => {} }),
}));
vi.mock("../../store", () => ({
  saveBlueprint: vi.fn(),
  useBlueprintLibrary: () => ({ records: [] }),
}));

import { encodePayloadCode } from "../../transfer";
import { ImportBlueprintForm } from "./ImportBlueprintForm";

afterEach(cleanup);

const code = encodePayloadCode({
  name: "Opening solars",
  game: { name: "Zero-K 1.2.3" },
  buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 }],
  footprints: {},
});
if (!code.ok) throw new Error(code.message);

describe("ImportBlueprintForm arrival note", () => {
  it("does not say the game is not installed when the scan failed", async () => {
    scan.current = {
      data: null,
      error: "no space left on device",
      loading: false,
      cancelled: false,
    };
    render(
      <ImportBlueprintForm onImported={() => {}} initialCode={code.code} />,
    );
    expect(
      (await screen.findAllByText(/has not been checked against them/)).length,
    ).toBe(1);
    expect(screen.queryByText(/not installed here/)).toBeNull();
    expect(screen.queryByText(/still reading/)).toBeNull();
  });

  it("still says the game is not installed when the scan answered", async () => {
    scan.current = {
      data: { games: [] },
      error: null,
      loading: false,
      cancelled: false,
    };
    render(
      <ImportBlueprintForm onImported={() => {}} initialCode={code.code} />,
    );
    expect(await screen.findByText(/not installed here/)).toBeTruthy();
  });
});
