// @vitest-environment happy-dom

/**
 * Importing a warpath challenge when the game's unit data cannot give a unit
 * limit (issue #3488). The whole import is rendered, with the data reads mocked
 * at the binding, so what is asserted is what the player sees and whether a run
 * was saved.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  gameInfo: vi.fn(),
  unitDataset: vi.fn(),
  saveRun: vi.fn(),
  onImported: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../../../notify/notify", () => ({ notify: vi.fn() }));
vi.mock("../../../container/container", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  identify: () => ({ game: undefined }),
}));
vi.mock("../../../container/shortnames", () => ({
  rememberCarriedShortname: () => {},
}));

vi.mock("../../../challenge/ChallengeCodeInput", () => ({
  ChallengeCodeInput: (props: {
    onImport: (code: string) => Promise<void>;
  }) => (
    <button type="button" onClick={() => void props.onImport("code")}>
      Import challenge
    </button>
  ),
}));
vi.mock("../../../challenge/ImportedCodeRecord", () => ({
  ImportedCodeRecord: () => null,
}));
vi.mock("../../../content/pages/components/ResolveContentDrawer", () => ({
  ResolveContentGate: (props: { onContinue: () => Promise<void> }) => {
    const fired = useRef(false);
    useEffect(() => {
      if (fired.current) return;
      fired.current = true;
      void props.onContinue();
    });
    return null;
  },
}));

vi.mock("../../../content/bindings", () => ({
  unitsyncSkirmishAis: async () => ({ ais: [] }),
  unitsyncGameInfo: m.gameInfo,
  unitsyncUnitDataset: m.unitDataset,
}));
vi.mock("../../../content/config", () => ({
  useUnitsyncScan: () => ({
    data: {
      games: [
        {
          name: "Test Game 1",
          primaryArchive: { name: "test_game_1.sdz" },
          dependencyArchives: [],
          info: { shortname: "TG", version: "1" },
        },
      ],
      maps: [],
    },
    error: null,
    loading: false,
  }),
}));
vi.mock("../../../content/mapEligibility", () => ({
  useMapEligibility: () => ({ eligible: (maps: unknown[]) => maps }),
}));
vi.mock("../../../play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/engine", dataDir: "/data" },
    loading: false,
  }),
}));
vi.mock("../../../play/useGameCatalog", () => ({
  useGameCatalog: () => ({ entries: [], suggested: [], github: {} }),
}));
vi.mock("../../runs", () => ({ useRuns: () => ({ saveRun: m.saveRun }) }));
vi.mock("../../challenge", () => ({
  decodeWarpathChallenge: () => ({
    ok: true,
    settings: { game: { shortname: "TG" }, side: "Arm" },
  }),
  runFromChallenge: () => ({ nodes: [] }),
  substitutedMapCount: () => 0,
}));

import { ImportChallengeForm } from "./ImportChallengeForm";

const unit = (name: string, buildOptions: string[] = []) => ({
  name,
  buildOptions,
});

beforeEach(() => {
  m.gameInfo.mockResolvedValue({
    sides: [{ name: "Arm", startUnit: "armcom" }],
  });
  m.unitDataset.mockResolvedValue({
    units: [unit("armcom", ["armmex"]), unit("armmex")],
  });
  m.saveRun.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function runImport() {
  render(<ImportChallengeForm onImported={m.onImported} />);
  fireEvent.click(screen.getByText("Import challenge"));
}

describe("importing a warpath challenge", () => {
  it("creates the run with no warning when the start unit gives a limit", async () => {
    await runImport();

    await vi.waitFor(() => expect(m.saveRun).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/cannot limit your units/)).toBeNull();
    expect(m.onImported).toHaveBeenCalledTimes(1);
  });

  describe("when the unit data cannot be read", () => {
    beforeEach(() => {
      m.unitDataset.mockRejectedValue(new Error("worker crashed"));
    });

    it("stops before creating the run, and says what failed and why", async () => {
      await runImport();

      await screen.findByText(/could not read this game's unit data/);
      expect(screen.getByText(/worker crashed/)).toBeTruthy();
      expect(screen.getByText(/every unit will be available/)).toBeTruthy();
      expect(m.saveRun).not.toHaveBeenCalled();
    });

    it("reads the data again on retry, and creates the run when it works", async () => {
      await runImport();
      await screen.findByText(/worker crashed/);

      m.unitDataset.mockResolvedValue({
        units: [unit("armcom", ["armmex"]), unit("armmex")],
      });
      fireEvent.click(screen.getByText("Try again"));

      await vi.waitFor(() => expect(m.saveRun).toHaveBeenCalledTimes(1));
      expect(m.unitDataset).toHaveBeenCalledTimes(2);
      expect(m.onImported).toHaveBeenCalledTimes(1);
    });

    it("creates the run with no limit when the player chooses to", async () => {
      await runImport();
      await screen.findByText(/worker crashed/);

      fireEvent.click(screen.getByText("Create run with no unit limit"));

      await vi.waitFor(() => expect(m.saveRun).toHaveBeenCalledTimes(1));
      expect(m.onImported).toHaveBeenCalledTimes(1);
    });

    it("creates nothing when the player cancels", async () => {
      await runImport();
      await screen.findByText(/worker crashed/);

      fireEvent.click(screen.getByText("Cancel"));

      expect(m.saveRun).not.toHaveBeenCalled();
      expect(screen.queryByText(/worker crashed/)).toBeNull();
    });
  });

  it("stops when the game info cannot be read, and says why", async () => {
    m.gameInfo.mockRejectedValue(new Error("archive unreadable"));

    await runImport();

    await screen.findByText(/archive unreadable/);
    expect(
      screen.getByText(/could not read this game's unit data/),
    ).toBeTruthy();
    expect(m.saveRun).not.toHaveBeenCalled();
  });

  describe("when the side has no usable start unit", () => {
    it("warns before creating the run when the start unit is not in the data", async () => {
      m.unitDataset.mockResolvedValue({ units: [unit("other")] });

      await runImport();

      await screen.findByText(
        /The start unit for Arm, armcom, is not one of the units in Test Game 1/,
      );
      expect(screen.getByText(/code fixes the side to Arm/)).toBeTruthy();
      expect(screen.queryByText("Try again")).toBeNull();
      expect(m.saveRun).not.toHaveBeenCalled();
    });

    it("warns when the start unit builds nothing", async () => {
      m.unitDataset.mockResolvedValue({ units: [unit("armcom")] });

      await runImport();

      await screen.findByText(
        /Nothing can be built from armcom, the start unit for Arm/,
      );
      expect(m.saveRun).not.toHaveBeenCalled();
    });

    it("warns when the side has no start unit, without reading the unit data", async () => {
      m.gameInfo.mockResolvedValue({ sides: [{ name: "Arm" }] });

      await runImport();

      await screen.findByText(/Arm has no start unit in Test Game 1/);
      expect(m.unitDataset).not.toHaveBeenCalled();
      expect(m.saveRun).not.toHaveBeenCalled();
    });

    it("creates the run once the player confirms", async () => {
      m.unitDataset.mockResolvedValue({ units: [unit("armcom")] });
      await runImport();
      await screen.findByText(/Nothing can be built from armcom/);

      fireEvent.click(screen.getByText("Create run anyway"));

      await vi.waitFor(() => expect(m.saveRun).toHaveBeenCalledTimes(1));
      expect(m.onImported).toHaveBeenCalledTimes(1);
    });
  });
});
