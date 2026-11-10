// @vitest-environment happy-dom
/**
 * Opening a unit from a game offers a skeleton proposed from the roles its
 * script proposed (#5185), and passes those roles on when it is taken.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdoptedScript } from "../../adoptGameScript";
import type { RoleFindings } from "../../inferRoles";
import { type LegoPiece, newProject } from "../../model";
import { GameModelDrawer } from "./GameModelDrawer";

const project = (() => {
  const base = newProject({
    id: "u",
    rootPieceId: "root",
    name: "Gun",
    packId: "p",
    packVersion: "1",
    now: "2026-11-10T00:00:00.000Z",
  });
  const turret: LegoPiece = {
    id: "turret",
    name: "turret",
    parentId: "root",
    partId: null,
    position: [0, 10, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
  return { ...base, pieces: [...base.pieces, turret] };
})();

const findings: RoleFindings = {
  proposals: [
    {
      pieceName: "turret",
      role: "turret",
      evidence: "observed",
      callin: "AimWeapon1",
    },
  ],
  legs: [],
  notes: [],
  error: null,
};

const adopted = vi.hoisted(() => ({ current: null as unknown }));

const GAME = {
  name: "Test Game",
  primaryArchive: { name: "test.sdz" },
  dependencyArchives: [],
  info: {},
};

vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/e", dataDir: "/d" },
  }),
}));
vi.mock("@/content/config", () => ({
  useUnitsyncScan: () => ({ data: { games: [GAME] }, loading: false }),
  useUnitsyncArchiveTree: () => ({
    tree: { files: [], archivePath: "/d/test.sdz" },
    loading: false,
  }),
  useUnitsyncUnitDataset: () => ({ dataset: { units: [] }, status: "ready" }),
  useUnitsyncUnitBuildpics: () => ({ units: {} }),
}));
vi.mock("../../projects", () => ({
  useLegoProjects: () => ({ projects: [] }),
}));
vi.mock("../../gameModels", () => ({
  gameModelRows: () => ({
    rows: [{ member: "objects3d/gun.s3o", label: "gun", unit: "gun" }],
    unresolvedUnits: 0,
    unopenableUnits: 0,
  }),
}));
vi.mock("../../gameImport", () => ({
  modelSource: () => "game",
  stageModel: async () => ({ path: "/tmp/gun.s3o", staged: null }),
  stageTextures: async () => undefined,
}));
vi.mock("../../unitGame", () => ({ gameRecordFor: () => undefined }));
vi.mock("../../adoptGameScript", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../adoptGameScript")>()),
  adoptGameScript: async () => adopted.current,
}));
vi.mock("./ImportResult", () => ({
  readModel: async () => ({ state: "imported", imported: { project } }),
  stageProject: (stage: { state: string }) =>
    stage.state === "imported" ? project : null,
  ImportResult: ({
    children,
    onAccept,
    pending,
  }: {
    children?: ReactNode;
    onAccept: () => void;
    pending?: string | null;
  }) => (
    <div>
      {children}
      <button type="button" disabled={!!pending} onClick={onAccept}>
        Open the unit
      </button>
    </div>
  ),
}));

afterEach(cleanup);

function script(found: RoleFindings | null): AdoptedScript {
  return {
    script: "return {}",
    member: "scripts/gun.lua",
    kind: "lua",
    declared: null,
    findings: found,
    converted: null,
    compiled: null,
    unitDef: null,
    includes: {},
    notes: [],
  };
}

async function openGun(found: RoleFindings | null) {
  adopted.current = script(found);
  const onOpened = vi.fn();
  render(
    <GameModelDrawer
      open
      onOpenChange={vi.fn()}
      onOpened={onOpened}
      onExisting={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Test Game/ }));
  fireEvent.click(await screen.findByRole("button", { name: /gun/ }));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Open the unit",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  return { onOpened };
}

describe("GameModelDrawer proposing a skeleton (#5185)", () => {
  it("offers it for a unit with roles proposed, and passes them on", async () => {
    const { onOpened } = await openGun(findings);
    const offer = screen.getByRole("checkbox", { name: "Propose a skeleton" });
    expect(offer.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Open the unit" }));

    expect(onOpened).toHaveBeenCalledWith(expect.anything(), findings);
  });

  it("opens without one when the offer is turned off", async () => {
    const { onOpened } = await openGun(findings);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Propose a skeleton" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open the unit" }));

    expect(onOpened).toHaveBeenCalledWith(expect.anything(), undefined);
  });

  it("does not offer it when no roles were proposed", async () => {
    await openGun({ ...findings, proposals: [] });
    expect(
      screen.queryByRole("checkbox", { name: "Propose a skeleton" }),
    ).toBeNull();
  });
});
