// @vitest-environment happy-dom

/**
 * The build picture drawer previews the frame, takes the picture with the
 * chosen settings, and says when the unit has changed since (issue #3347).
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pictureFingerprint } from "../../buildPicture";
import { type LegoProject, newProject } from "../../model";
import { BuildPictureDrawer } from "./BuildPictureDrawer";

const legoPictureSurvey = vi.fn();
const savePicture = vi.fn();

vi.mock("../../bindings", () => ({
  legoPictureSurvey: (args: unknown) => legoPictureSurvey(args),
}));
vi.mock("../../projects", () => ({
  savePicture: (id: string, canvas: HTMLCanvasElement) =>
    savePicture(id, canvas),
}));

const base: LegoProject = newProject({
  id: "p",
  rootPieceId: "base",
  name: "Sky Fortress",
  unitName: "skyfort",
  packId: "lego",
  packVersion: "1",
  now: "2026-10-16T00:00:00Z",
});

function frame(width = 320) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = width;
  canvas.toDataURL = () => "data:image/png;base64,AAAA";
  return canvas;
}

function show(
  project: LegoProject,
  capture = vi.fn(() => frame()),
  onTaken = vi.fn(),
) {
  render(
    <BuildPictureDrawer
      open
      onOpenChange={vi.fn()}
      project={project}
      capture={capture}
      onTaken={onTaken}
    />,
  );
  return { capture, onTaken };
}

beforeEach(() => {
  legoPictureSurvey.mockReset();
  savePicture.mockReset();
  savePicture.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("the build picture drawer", () => {
  it("previews the frame at the default size, with no background", async () => {
    const { capture } = show(base);
    await waitFor(() => expect(capture).toHaveBeenCalled());
    expect(capture).toHaveBeenCalledWith({
      pixels: 320,
      background: null,
      view: [9, 7, 11],
    });
    expect(
      await screen.findByAltText(/Sky Fortress as it will look/),
    ).toBeTruthy();
  });

  it("takes the picture, stores it and remembers how it was taken", async () => {
    const { onTaken } = show(base);
    fireEvent.click(screen.getByRole("button", { name: "Take picture" }));
    await waitFor(() => expect(onTaken).toHaveBeenCalled());
    expect(savePicture).toHaveBeenCalledWith("p", expect.anything());
    expect(onTaken).toHaveBeenCalledWith(
      expect.objectContaining({
        size: 320,
        background: null,
        view: "right",
        fingerprint: pictureFingerprint(base),
      }),
    );
  });

  it("uses the size and background chosen", async () => {
    const { capture } = show(base);
    fireEvent.change(screen.getByLabelText("Size in pixels"), {
      target: { value: "64" },
    });
    fireEvent.click(screen.getByLabelText("Transparent background"));
    fireEvent.change(screen.getByLabelText("Background colour"), {
      target: { value: "#336699" },
    });
    await waitFor(() =>
      expect(capture).toHaveBeenLastCalledWith(
        expect.objectContaining({ pixels: 64, background: "#336699" }),
      ),
    );
  });

  it("reports a failure to store the picture and remembers nothing", async () => {
    savePicture.mockRejectedValue(new Error("disk full"));
    const { onTaken } = show(base);
    fireEvent.click(screen.getByRole("button", { name: "Take picture" }));
    expect(await screen.findByText("disk full")).toBeTruthy();
    expect(onTaken).not.toHaveBeenCalled();
  });

  it("offers to update a picture of a unit that has since changed", () => {
    show({
      ...base,
      picture: {
        size: 320,
        background: null,
        view: "right",
        takenAt: "2026-10-16T00:00:00Z",
        fingerprint: "an older unit",
      },
    });
    expect(screen.getByRole("button", { name: "Update picture" })).toBeTruthy();
    expect(screen.getByText(/The unit has changed since/)).toBeTruthy();
  });

  it("says when the game's own pictures are another size", async () => {
    legoPictureSurvey.mockResolvedValue({
      pngSizes: [{ width: 64, height: 64, count: 30 }],
      otherFormats: [],
    });
    show({ ...base, exportDir: "/games/sf" });
    expect(
      await screen.findByText(
        /Most of this game's PNG build pictures are 64 by 64/,
      ),
    ).toBeTruthy();
  });
});
