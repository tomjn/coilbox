// @vitest-environment happy-dom
/**
 * Drives `ArchiveModelPreview` under a real DOM, following the mocking shape
 * `GameUnitPage.dom.test.tsx` uses: `useUnitsyncUnitModel` is mocked so the
 * test exercises the preview's own render, not a real scan or a real WebGL
 * canvas.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnitModelResult } from "../../bindings";

let mockModel: UnitModelResult | null = null;
let mockError: string | null = null;
const retry = vi.fn();

vi.mock("../../config", () => ({
  useUnitsyncUnitModel: () => ({
    model: mockModel,
    loading: false,
    failed: mockError !== null,
    error: mockError,
    retry,
  }),
}));

vi.mock("./ModelViewport", () => ({
  ModelViewport: () => null,
  ModelNotes: () => null,
}));

const { ArchiveModelPreview } = await import("./ArchiveModelPreview");

afterEach(() => {
  cleanup();
  mockError = null;
  retry.mockClear();
});

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

// Issue #1916: a read that cannot finish must end in something the screen says,
// with a way to ask again, rather than a loading line that never changes.
describe("ArchiveModelPreview when the read fails", () => {
  it("says why and reads again on Try again", () => {
    mockError = "unitsync unit models timed out after 120s";
    renderPreview("s3o");
    expect(
      screen.getByText(
        "Could not read this model: unitsync unit models timed out after 120s.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
