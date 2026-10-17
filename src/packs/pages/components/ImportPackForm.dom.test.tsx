// @vitest-environment happy-dom
/**
 * Importing a setup pack saves what it bundles (issue #1727): presets as
 * before, and now blueprints into the library, named apart from what is
 * already there and noted as coming from a setup pack. A pack shared before
 * packs carried blueprints still imports exactly as it did.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredBlueprint } from "../../../blueprint/library";
import type { BlueprintPayload } from "../../../blueprint/payload";
import { encodeContainerCode } from "../../../container/container";

const spies = vi.hoisted(() => ({
  savePreset: vi.fn((name: string) => ({ id: `preset-${name}` })),
  saveBlueprints: vi.fn(),
  notify: vi.fn(),
  written: new Set<string>(),
  library: [] as unknown[],
}));

vi.mock("../../../challenge/ChallengeCodeInput", () => ({
  ChallengeCodeInput: ({
    initialCode,
    onImport,
  }: {
    initialCode?: string;
    onImport: (code: string) => Promise<void>;
  }) => (
    <button type="button" onClick={() => void onImport(initialCode ?? "")}>
      read
    </button>
  ),
}));
vi.mock("../../../content/pages/components/ResolveContentDrawer", () => ({
  ResolveContentGate: ({
    onContinue,
  }: {
    onContinue: () => void | Promise<void>;
  }) => (
    <button
      type="button"
      onClick={() =>
        void Promise.resolve(onContinue()).catch((e: Error) => {
          document.body.dataset.failed = e.message;
        })
      }
    >
      continue
    </button>
  ),
}));
vi.mock("../../../content/config", () => ({
  useUnitsyncScan: () => ({ data: null, error: null, loading: false }),
}));
vi.mock("../../../play/config", () => ({
  usePreferredTarget: () => ({ target: null, loading: false }),
  useSkirmishAis: () => ({ ais: [], loaded: false }),
}));
vi.mock("../../../play/presets", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSkirmishPresets: () => ({ presets: [], savePreset: spies.savePreset }),
}));
vi.mock("../../../blueprint/store", () => ({
  refreshBlueprints: async () => spies.library,
  saveBlueprints: spies.saveBlueprints,
  cachedBlueprint: (id: string) => (spies.written.has(id) ? { id } : undefined),
}));
vi.mock("../../../notify/notify", () => ({ notify: spies.notify }));
vi.mock("../../../container/shortnames", () => ({
  rememberCarriedShortname: () => {},
}));

import { ImportPackForm } from "./ImportPackForm";

const LAYOUT: BlueprintPayload = {
  game: { name: "Game A", shortname: "ga" },
  name: "Opening solars",
  buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 }],
  footprints: { armsolar: { x: 4, z: 4 } },
};

const PRESET = {
  name: "1v1",
  participants: [],
  gameName: "Game A",
  mapName: "Map One",
  startPosType: 0,
  modOptionValues: {},
};

function packCode(payload: object): string {
  return encodeContainerCode("setup-pack", 1, payload);
}

async function importPack(code: string) {
  render(<ImportPackForm initialCode={code} />);
  fireEvent.click(screen.getByText("read"));
  fireEvent.click(await screen.findByText("continue"));
}

beforeEach(() => {
  spies.savePreset.mockClear();
  spies.notify.mockClear();
  spies.written.clear();
  spies.library = [];
  delete document.body.dataset.failed;
  spies.saveBlueprints.mockReset();
  spies.saveBlueprints.mockImplementation(
    async (records: StoredBlueprint[]) => {
      for (const r of records) spies.written.add(r.id);
      return records;
    },
  );
});
afterEach(cleanup);

describe("ImportPackForm", () => {
  it("imports a pack shared before packs carried blueprints", async () => {
    await importPack(
      packCode({ games: [{ name: "Game A" }], presets: [PRESET] }),
    );
    await vi.waitFor(() => expect(spies.notify).toHaveBeenCalled());
    expect(spies.savePreset).toHaveBeenCalledTimes(1);
    expect(spies.saveBlueprints).not.toHaveBeenCalled();
    expect(spies.notify.mock.calls[0][0].body).not.toContain("blueprint");
  });

  it("saves a pack's blueprints, named apart from the library's", async () => {
    spies.library = [
      {
        id: "mine",
        createdAt: "",
        updatedAt: "",
        layout: { ...LAYOUT },
      },
    ];
    await importPack(
      packCode({
        title: "Comet nights",
        games: [{ name: "Game A" }],
        blueprints: [LAYOUT],
      }),
    );
    await vi.waitFor(() => expect(spies.notify).toHaveBeenCalled());
    const [saved] = spies.saveBlueprints.mock.calls[0][0] as StoredBlueprint[];
    expect(saved.layout.name).toBe("Opening solars 2");
    expect(saved.source).toMatchObject({
      kind: "setup-pack",
      title: "Comet nights",
      wasCalled: "Opening solars",
    });
    expect(spies.notify.mock.calls[0][0].body).toBe(
      "1 blueprint added to your library.",
    );
  });

  it("saves no preset when the blueprints fail, and no blueprint twice on a retry", async () => {
    spies.saveBlueprints.mockImplementationOnce(
      async (records: StoredBlueprint[]) => {
        spies.written.add(records[0].id);
        throw new Error("disk full");
      },
    );
    await importPack(
      packCode({
        games: [{ name: "Game A" }],
        presets: [PRESET],
        blueprints: [LAYOUT, { ...LAYOUT, name: "Wall" }],
      }),
    );
    await vi.waitFor(() =>
      expect(document.body.dataset.failed).toContain("disk full"),
    );
    expect(spies.savePreset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("continue"));
    await vi.waitFor(() => expect(spies.notify).toHaveBeenCalled());
    const retried = spies.saveBlueprints.mock.calls[1][0] as StoredBlueprint[];
    expect(retried.map((r) => r.layout.name)).toEqual(["Wall"]);
    expect(spies.savePreset).toHaveBeenCalledTimes(1);
  });
});
