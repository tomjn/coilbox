// @vitest-environment happy-dom
/**
 * Issue #1165. The exports are disabled with their reason when there is nothing
 * to write, closing the save dialog writes nothing and says nothing, and a
 * write that fails says so.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayerAggregate } from "../../mapAggregate";
import { WHOLE } from "../../mapAggregate";
import type { MapExportBasis } from "../../mapAggregateExport";
import type { PlaceRecord, StartRecords } from "../../mapRecords";
import type { StartRow } from "../../startNames";

const save = vi.fn();
const write = vi.fn();
const notify = vi.fn(async () => {});

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => save(...args),
}));
vi.mock("@/notify/notify", () => ({
  notify: (...args: unknown[]) => notify(...(args as [])),
}));
vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return { ...actual, contentWriteFile: (a: unknown) => write(a) };
});

const render_ = vi.fn();
const savePng = vi.fn();
vi.mock("../../mapImageExport", () => ({
  renderMapImage: (a: unknown) => render_(a),
  savePngBytes: (...a: unknown[]) => savePng(...a),
}));
vi.mock("../../../updater/updater", () => ({
  currentVersion: async () => "9.9.9",
}));

const { MapExportButtons } = await import("./MapExportButtons");

const info: MapExportBasis = {
  mapName: "Tabula",
  mapVersions: ["Tabula"],
  gameVersions: ["Game 1"],
  matches: 2,
  filters: {
    players: "any number of players",
    sides: "any sides",
    analysed: "analysed or not",
    playedFrom: "",
    playedUntil: "",
    replaySet: "",
    includesShort: false,
  },
  worldWidth: 200,
  worldHeight: 200,
};

function drawn(): LayerAggregate {
  const out = {
    field: null,
    available: 1,
    contributing: 1,
    unclassified: 0,
    events: 3,
    atPeak: null,
  } as LayerAggregate;
  const mean = new Float32Array(4);
  const events = new Float32Array(4);
  mean[3] = 1;
  events[3] = 3;
  Object.defineProperty(out, "grid", {
    value: { width: 2, height: 2, mean, events },
    enumerable: false,
  });
  return out;
}

const record: PlaceRecord = {
  place: { key: "d1", kind: "declared", number: 1, x: 10, z: 20, radius: 0 },
  taken: 1,
  known: 1,
  won: 1,
  sides: [
    { taken: 0, known: 0, won: 0 },
    { taken: 0, known: 0, won: 0 },
  ],
  byAi: 0,
};
const records: StartRecords = {
  places: [record],
  tolerance: null,
  scale: null,
  atDeclared: 1,
  grouped: 0,
  ungrouped: 0,
};
const rows: StartRow[] = [
  {
    key: "d1",
    number: 1,
    name: null,
    places: [record.place],
    taken: 1,
    known: 1,
    won: 1,
    sides: record.sides,
    byAi: 0,
  },
];

const view = (patch: Partial<Parameters<typeof MapExportButtons>[0]> = {}) =>
  render(
    <MapExportButtons
      info={info}
      layer="buildings"
      drawn={drawn()}
      normalise="share"
      window={WHOLE}
      records={records}
      rows={rows}
      split={false}
      layerSentence="Where buildings were ordered"
      minimapUrl="coilbox://localhost/unitsyncthumb/a.png"
      world={{ worldWidth: 200, worldHeight: 200 }}
      dots={[{ left: 0.5, top: 0.5 }]}
      places={[{ left: 0.25, top: 0.25, n: 1, name: "Front" }]}
      showStarts
      {...patch}
    />,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const pictureButton = () =>
  screen.getByRole("button", { name: /export picture/i });
const layerButton = () =>
  screen.getByRole("button", { name: /export layer csv/i });
const startsButton = () =>
  screen.getByRole("button", { name: /export start positions csv/i });

describe("MapExportButtons", () => {
  it("writes nothing when the dialog is closed", async () => {
    save.mockResolvedValue(null);
    view();
    fireEvent.click(layerButton());
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(write).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("writes the layer's cells to the path picked and says so", async () => {
    save.mockResolvedValue("/tmp/out.csv");
    write.mockResolvedValue({});
    view();
    fireEvent.click(layerButton());
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ level: "success" }),
      ),
    );
    const sent = write.mock.calls[0][0] as { dest: string; text: string };
    expect(sent.dest).toBe("/tmp/out.csv");
    expect(
      sent.text.split("\r\n")[1].startsWith("1,1,150,150,1,3,Tabula,"),
    ).toBe(true);
    expect(save.mock.calls[0][0].defaultPath).toBe(
      "tabula-building-density.csv",
    );
  });

  it("writes the start positions as their own file", async () => {
    save.mockResolvedValue("/tmp/starts.csv");
    write.mockResolvedValue({});
    view();
    fireEvent.click(startsButton());
    await waitFor(() => expect(write).toHaveBeenCalled());
    const sent = write.mock.calls[0][0] as { text: string };
    expect(
      sent.text.split("\r\n")[0].startsWith("row_number,position_key"),
    ).toBe(true);
    expect(save.mock.calls[0][0].defaultPath).toBe(
      "tabula-start-positions.csv",
    );
  });

  it("says when the write fails", async () => {
    save.mockResolvedValue("/tmp/out.csv");
    write.mockRejectedValue(new Error("disk full"));
    view();
    fireEvent.click(layerButton());
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          title: "Export failed: disk full",
        }),
      ),
    );
  });

  it("is disabled with the reason when the layer has nothing", () => {
    view({ drawn: null });
    expect((layerButton() as HTMLButtonElement).disabled).toBe(true);
    expect(layerButton().getAttribute("title")).toMatch(
      /nothing in the picture/i,
    );
  });

  it("is disabled with the reason when no layer is chosen", () => {
    view({ layer: "" });
    expect((layerButton() as HTMLButtonElement).disabled).toBe(true);
    expect(layerButton().getAttribute("title")).toMatch(
      /choose a density layer/i,
    );
  });

  it("is disabled with the reason when no start position is counted", () => {
    view({ rows: [] });
    expect((startsButton() as HTMLButtonElement).disabled).toBe(true);
    expect(startsButton().getAttribute("title")).toMatch(/no start position/i);
    expect((layerButton() as HTMLButtonElement).disabled).toBe(false);
  });

  const withField = () => {
    const out = drawn();
    Object.assign(out, {
      field: { peak: 1, width: 2, height: 2, radius: 100 },
    });
    return out;
  };

  it("makes the picture with the provenance and writes it where it was saved", async () => {
    save.mockResolvedValue("/tmp/picture.png");
    render_.mockResolvedValue(new Uint8Array([1, 2]));
    view({ drawn: withField() });
    fireEvent.click(pictureButton());
    await waitFor(() => expect(savePng).toHaveBeenCalled());
    expect(savePng).toHaveBeenCalledWith(
      "/tmp/picture.png",
      new Uint8Array([1, 2]),
    );
    const asked = render_.mock.calls[0][0];
    expect(asked.minimapUrl).toBe("coilbox://localhost/unitsyncthumb/a.png");
    expect(asked.words.appVersion).toBe("9.9.9");
    expect(asked.words.info.mapName).toBe("Tabula");
    expect(asked.words.info.exportedUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(asked.words.marks).toBe(true);
    expect(asked.places).toHaveLength(1);
    expect(save.mock.calls[0][0].defaultPath).toBe(
      "tabula-building-density.png",
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ level: "success" }),
    );
  });

  it("leaves the marks out of the picture when the section hides them", async () => {
    save.mockResolvedValue("/tmp/picture.png");
    render_.mockResolvedValue(new Uint8Array([1]));
    view({ drawn: withField(), showStarts: false });
    fireEvent.click(pictureButton());
    await waitFor(() => expect(render_).toHaveBeenCalled());
    const asked = render_.mock.calls[0][0];
    expect(asked.dots).toEqual([]);
    expect(asked.places).toEqual([]);
    expect(asked.words.marks).toBe(false);
  });

  it("says when the picture could not be made, and writes nothing", async () => {
    save.mockResolvedValue("/tmp/picture.png");
    render_.mockRejectedValue(new Error("tainted"));
    view({ drawn: withField() });
    fireEvent.click(pictureButton());
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          title: "Export failed: tainted",
        }),
      ),
    );
    expect(savePng).not.toHaveBeenCalled();
  });

  it("is disabled with the reason when the layer has no field to draw", () => {
    view({ drawn: drawn() });
    expect((pictureButton() as HTMLButtonElement).disabled).toBe(true);
    expect(pictureButton().getAttribute("title")).toMatch(
      /nothing in the picture/i,
    );
  });
});
