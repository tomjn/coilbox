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
      {...patch}
    />,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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
});
