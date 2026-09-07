// @vitest-environment happy-dom
/**
 * Issue #2573. The whole value of a batch conversion is the report at the end:
 * a run over 720 models that quietly drops five of them is far worse than one
 * that names the five. So these check that everything the worker says went
 * wrong reaches the screen, and that the three reasons a face comes out flat
 * grey stay told apart.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Convert3doResult } from "../../bindings";

const convert = vi.fn();
const openDialog = vi.fn();

// A real `Channel` registers a callback with the Tauri IPC bridge, which is not
// here. The drawer only ever assigns `onmessage`, so a plain object is enough.
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((value: unknown) => void) | null = null;
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialog(...args),
}));

vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return {
    ...actual,
    contentOpenPath: vi.fn(async () => ({})),
    unitsyncCancel: vi.fn(async () => ({})),
    unitsyncConvert3do: (args: unknown) => convert(args),
  };
});

const { Convert3doDrawer } = await import("./Convert3doDrawer");

const RESULT: Convert3doResult = {
  outDir: "/out",
  modelsFound: 6,
  modelsWritten: 4,
  unreadable: { "objects3d/broken.3do": "file is 0 bytes, need at least 52" },
  errors: [],
  groups: [
    {
      folder: "objects3d",
      atlas: "unittextures/3do/objects3d.png",
      texture1: "3do/objects3d.png",
      atlasSide: 2048,
      reusedAtlas: false,
      tilesPacked: 653,
      tilesThatDidNotFit: ["camoc02"],
      missingTextures: { explode2: 1 },
      undecodableTextures: {
        oddtile: { member: "unittextures/tatex/oddtile00.tga", wantedBy: 3 },
      },
      modelsWritten: 4,
      didNotFit: ["armtank.3do (needs camoc02, which did not fit)"],
      paletteFaces: 7,
      paletteModels: ["armcom.3do"],
      missingTextureFaces: 2,
      vertices: 316362,
      triangles: 157800,
      droppedPieces: 1,
    },
  ],
};

function drawer() {
  return render(
    <Convert3doDrawer
      enginePath="/engines/105"
      dataDir="/data"
      archive="ba.sdz"
      models={6}
    />,
  );
}

async function runIt() {
  openDialog.mockResolvedValue("/out");
  convert.mockResolvedValue(RESULT);
  drawer();
  fireEvent.click(screen.getByRole("button", { name: /choose folder/i }));
  await waitFor(() => screen.getByText("/out"));
  fireEvent.click(screen.getByRole("button", { name: /convert models/i }));
  await waitFor(() => screen.getByText(/wrote 4 of 6 models/i));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Convert3doDrawer", () => {
  it("will not run until a folder is picked", () => {
    drawer();

    const button = screen.getByRole("button", { name: /convert models/i });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(convert).not.toHaveBeenCalled();
  });

  it("sends the picked folder and an id it can cancel by", async () => {
    await runIt();

    const args = convert.mock.calls[0][0];
    expect(args.outDir).toBe("/out");
    expect(args.archive).toBe("ba.sdz");
    expect(typeof args.opId).toBe("string");
    expect(args.onProgress).toBeTruthy();
  });

  /// The one that matters: every model the run could not convert is named, and
  /// the two reasons stay apart.
  it("names the models it could not read and the ones that did not fit", async () => {
    await runIt();

    expect(screen.getByText(/could not be read at all \(1\)/i)).toBeTruthy();
    expect(screen.getByText(/objects3d\/broken.3do/)).toBeTruthy();
    expect(screen.getByText(/did not fit on the sheet \(1\)/i)).toBeTruthy();
    expect(
      screen.getByText(/armtank.3do \(needs camoc02, which did not fit\)/),
    ).toBeTruthy();
  });

  /// A texture the game does not ship and a texture coilbox cannot decode are
  /// opposite problems, and reporting the second as the first sends somebody
  /// looking for a file that is right there.
  it("keeps a missing texture apart from one it could not decode", async () => {
    await runIt();

    expect(
      screen.getByText(/textures the game does not ship \(1\)/i),
    ).toBeTruthy();
    expect(screen.getByText(/explode2/)).toBeTruthy();
    expect(
      screen.getByText(/textures coilbox could not decode \(1\)/i),
    ).toBeTruthy();
    expect(screen.getByText(/unittextures\/tatex\/oddtile00.tga/)).toBeTruthy();
  });

  /// The palette line means "entries that could not be resolved", which is a
  /// different reason from a named tile simply being missing from the sheet.
  it("counts the two reasons a face comes out flat grey separately", async () => {
    await runIt();

    expect(
      screen.getByText(/7 faces took a palette colour nothing could resolve/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/2 faces are flat because their tile is missing/i),
    ).toBeTruthy();
  });

  /// Coilbox writes no second texture for a converted model, and says so rather
  /// than leaving somebody to work out why the unit has no glow.
  it("says the second texture is empty and why", async () => {
    await runIt();

    expect(screen.getByText(/no model has a second texture/i)).toBeTruthy();
  });

  /// The engine tries .3do before .s3o for an extensionless objectname, so an
  /// overlay does nothing until the originals are gone. A user who does not
  /// know that concludes the conversion did not work.
  it("says the original .3do files have to go", async () => {
    await runIt();

    expect(screen.getByText(/remove the original/i).textContent).toMatch(
      /tries .3do before .s3o/,
    );
  });
});
