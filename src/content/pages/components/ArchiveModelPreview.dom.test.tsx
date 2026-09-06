// @vitest-environment happy-dom
/**
 * Drives `ArchiveModelPreview` under a real DOM, following the mocking shape
 * `GameUnitPage.dom.test.tsx` uses: `useUnitsyncUnitModel` is mocked so the
 * test exercises the preview's own render, not a real scan or a real WebGL
 * canvas.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnitModelResult } from "../../bindings";

let mockModel: UnitModelResult | null = null;

vi.mock("../../config", () => ({
  useUnitsyncUnitModel: () => ({
    model: mockModel,
    loading: false,
    failed: false,
  }),
}));

vi.mock("./ModelViewport", () => ({
  ModelViewport: () => null,
  ModelNotes: () => null,
}));

const { ArchiveModelPreview } = await import("./ArchiveModelPreview");

afterEach(cleanup);

function modelFixture(format: "s3o" | "3do"): UnitModelResult {
  return {
    format,
    path: `objects3d/thing.${format}`,
    radius: 10,
    height: 10,
    mid: [0, 0, 0],
    root: {
      name: "root",
      offset: [0, 0, 0],
      groups: [
        {
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
          uvs: [0, 0, 1, 0, 0, 1],
          indices: [0, 1, 2],
        },
      ],
      children: [],
    },
    textures: [],
    paletteFaces: 0,
    errors: [],
  } as unknown as UnitModelResult;
}

function renderPreview(format: "s3o" | "3do") {
  mockModel = modelFixture(format);
  return render(
    <MemoryRouter>
      <ArchiveModelPreview
        enginePath="/engines/105"
        dataDir="/data"
        archive="test.sdz"
        path={`objects3d/thing.${format}`}
        format={format}
      />
    </MemoryRouter>,
  );
}

describe("ArchiveModelPreview's open-in-the-builder button", () => {
  it("appears for an .s3o", () => {
    renderPreview("s3o");
    expect(
      screen.getByRole("button", { name: /open in the builder/i }),
    ).toBeTruthy();
  });

  it("appears for a .3do too", () => {
    renderPreview("3do");
    expect(
      screen.getByRole("button", { name: /open in the builder/i }),
    ).toBeTruthy();
  });
});
