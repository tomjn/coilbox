// @vitest-environment happy-dom

/**
 * The sheet's face for BYAR-Chobby's presets (issue #1297): records listed from
 * the file, picked ones imported under the selected game, a preset written in
 * after asking about a name clash, a record removed after asking, and a file
 * Chobby could not decode reported rather than touched.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChobbyPresetsView } from "./ChobbyPresetsView";
import type { SkirmishPreset } from "./presets";

const FILE = "/data/optionsPresets.json";
const RECORDS = {
  "Skirmish 2v2": {
    Map: "Supreme Isthmus v2.1",
    Modoptions: { ruins: "disabled", startmetal: 0 },
    Bots: {
      "BARb(1)": { aiLib: "BARb", allyNumber: 1, side: 1 },
    },
    "Start Boxes": [{ left: 0, top: 0, right: 100, bottom: 200 }],
  },
  "Multiplayer coop": {
    Map: "Full Metal Plate 1.7",
    "Multiplayer Battle Settings": { locked: false, teamSize: 8 },
  },
};

const read = vi.fn();
const write = vi.fn();
vi.mock("./bindings", () => ({
  playChobbyPresetsRead: (args: unknown) => read(args),
  playChobbyPresetsWrite: (args: unknown) => write(args),
}));

const savePreset = vi.fn();
const stored: SkirmishPreset[] = [];
vi.mock("./presets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./presets")>()),
  useSkirmishPresets: () => ({ presets: stored, savePreset }),
}));

vi.mock("./config", () => ({
  useSkirmishAis: () => ({
    ais: [{ shortName: "BARb", kind: "native", name: "BARb" }],
  }),
}));
vi.mock("@/content/config", () => ({
  useUnitsyncGameInfo: () => ({
    info: { sides: [{ name: "Armada" }, { name: "Cortex" }] },
  }),
}));

const notify = vi.fn();
vi.mock("@/notify/notify", () => ({ notify: (n: unknown) => notify(n) }));

function mine(id: string, name: string): SkirmishPreset {
  return {
    id,
    name,
    createdAt: "",
    lastUsedAt: "",
    participants: [],
    gameName: "BAR test",
    mapName: "Some Map",
    startPosType: 0,
    modOptionValues: {},
  };
}

function renderView(over: { disabled?: boolean; game?: string } = {}) {
  render(
    <ChobbyPresetsView
      files={[FILE]}
      currentGameName={over.game ?? "BAR test"}
      disabled={over.disabled}
    />,
  );
}

const asFile = (records: object) => ({ json: JSON.stringify(records) });

beforeEach(() => {
  stored.length = 0;
  read.mockResolvedValue(asFile(RECORDS));
  write.mockImplementation(
    async ({ edits }: { edits: { op: string; name: string }[] }) => {
      const next: Record<string, unknown> = { ...RECORDS };
      for (const e of edits)
        if (e.op === "remove") delete next[e.name];
        else next[e.name] = {};
      return { json: JSON.stringify(next), backup: "/data/backup.json" };
    },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the Chobby presets face", () => {
  it("lists the records in the file with what each holds", async () => {
    renderView();
    expect(await screen.findByText("Skirmish 2v2")).toBeTruthy();
    expect(screen.getByText("Multiplayer coop")).toBeTruthy();
    expect(
      screen.getByText("Supreme Isthmus v2.1 · 1 bot · 2 options"),
    ).toBeTruthy();
    expect(read).toHaveBeenCalledWith({ path: FILE });
  });

  it("imports the ticked records under the selected game and says what it left out", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Skirmish/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Multiplayer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Import 2 presets" }));

    expect(savePreset).toHaveBeenCalledTimes(2);
    const [name, draft] = savePreset.mock.calls[0];
    expect(name).toBe("Skirmish 2v2");
    expect(draft).toMatchObject({
      gameName: "BAR test",
      mapName: "Supreme Isthmus v2.1",
      modOptionValues: { ruins: "disabled", startmetal: "0" },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Imported 2 presets from Chobby",
        body: "Left out: Multiplayer Battle Settings",
      }),
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("gives an imported record a new name rather than replacing a preset of that name", async () => {
    stored.push(mine("a", "Skirmish 2v2"));
    renderView();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Skirmish/ }));
    fireEvent.click(screen.getByRole("button", { name: "Import 1 preset" }));
    expect(savePreset.mock.calls[0][0]).toBe("Skirmish 2v2 (2)");
  });

  it("cannot import with no game selected", async () => {
    renderView({ game: "" });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Skirmish/ }));
    expect(
      (
        screen.getByRole("button", {
          name: "Import 1 preset",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("removes a record only after asking, and reads nothing else from the write", async () => {
    renderView();
    await screen.findByText("Skirmish 2v2");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Skirmish 2v2 from Chobby" }),
    );
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(write).toHaveBeenCalledWith({
        path: FILE,
        edits: [{ op: "remove", name: "Skirmish 2v2" }],
      }),
    );
    await waitFor(() => expect(screen.queryByText("Skirmish 2v2")).toBeNull());
    expect(screen.getByText("Multiplayer coop")).toBeTruthy();
  });

  it("writes a preset in as a record without Multiplayer Battle Settings", async () => {
    stored.push(mine("a", "Mine"));
    renderView();
    await screen.findByText("Skirmish 2v2");
    fireEvent.click(screen.getByRole("combobox", { name: "Preset to write" }));
    fireEvent.click(screen.getByRole("option", { name: "Mine" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Write" }));
    });

    const { edits } = write.mock.calls[0][0];
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ op: "set", name: "Mine" });
    expect(edits[0].record).toMatchObject({
      Map: "Some Map",
      "Start Boxes": [],
    });
    expect(edits[0].record).not.toHaveProperty("Multiplayer Battle Settings");
  });

  it("asks before writing over a record with the same name", async () => {
    stored.push(mine("a", "Skirmish 2v2"));
    renderView();
    await screen.findByText("Multiplayer coop");
    fireEvent.click(screen.getByRole("combobox", { name: "Preset to write" }));
    fireEvent.click(screen.getByRole("option", { name: "Skirmish 2v2" }));
    fireEvent.click(screen.getByRole("button", { name: "Write" }));

    expect(write).not.toHaveBeenCalled();
    expect(
      screen.getByText('"Skirmish 2v2" is already in Chobby.'),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("reports a file Chobby could not decode and offers nothing to write over it", async () => {
    read.mockRejectedValue(
      "optionsPresets.json is not valid JSON: Unexpected end",
    );
    stored.push(mine("a", "Mine"));
    renderView();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("not valid JSON");
    expect(
      (screen.getByRole("button", { name: "Write" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it("changes nothing while a game is running", async () => {
    stored.push(mine("a", "Mine"));
    renderView({ disabled: true });
    await screen.findByText("Skirmish 2v2");
    for (const button of [
      screen.getByRole("button", { name: "Write" }),
      screen.getByRole("button", { name: "Remove Skirmish 2v2 from Chobby" }),
      screen.getByRole("button", { name: "Import" }),
    ])
      expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: /Skirmish/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows the error when the write itself is refused, and keeps the list", async () => {
    write.mockRejectedValue(
      "a game is running, so optionsPresets.json is left alone",
    );
    renderView();
    await screen.findByText("Skirmish 2v2");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Skirmish 2v2 from Chobby" }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "a game is running",
    );
    expect(screen.getByText("Skirmish 2v2")).toBeTruthy();
  });
});
