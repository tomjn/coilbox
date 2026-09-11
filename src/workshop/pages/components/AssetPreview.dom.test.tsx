// @vitest-environment happy-dom
/**
 * Issue #2694. Three claims the component exists to make.
 *
 * The model is not read until somebody asks for it, which is the whole reason
 * the picture and the model are drawn differently: a page somebody moves
 * through 564 units of cannot mount a viewport per unit. The test watches what
 * the reader was asked for rather than what is on screen, because a viewport
 * that is mounted but empty still cost the read.
 *
 * The builder link follows the file's own format, not the field it came out of.
 * The engine loads nine model formats and the builder reads two of them, so a
 * unit whose `objectname` is a `.dae` must not be offered a door into an editor
 * that cannot open it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSET_KINDS, assetIndex } from "@/content/assetKinds";
import type { AssetBrowsing, AssetField } from "../../assetFields";
import { AssetPreview } from "./AssetPreview";

const { modelAsked, fileAsked } = vi.hoisted(() => ({
  modelAsked: [] as (string | undefined)[],
  fileAsked: [] as (string | undefined)[],
}));

vi.mock("@/content/config", () => ({
  useUnitsyncUnitModel: (
    _engine?: string,
    _data?: string,
    _archive?: string,
    object?: string,
  ) => {
    modelAsked.push(object);
    return { model: null, loading: object !== undefined, failed: false };
  },
  useUnitsyncArchiveFile: (
    _engine?: string,
    _data?: string,
    _archive?: string,
    file?: string,
  ) => {
    fileAsked.push(file);
    return {
      data: { kind: "image", dataUrl: "data:image/png;base64,x", size: 1 },
      loading: false,
    };
  },
}));

// Three.js needs a WebGL context happy-dom has not got, and nothing here is a
// claim about what the model looks like.
vi.mock("@/content/pages/components/ModelViewport", () => ({
  ModelViewport: () => <div data-testid="viewport" />,
}));

const browsing = (member: string): AssetBrowsing => ({
  index: assetIndex([{ path: member, size: 2048 }]),
  derived: new Map(),
  archive: "ba.sdz",
  archiveLabel: "Balanced Annihilation",
  enginePath: "/engines/105",
  dataDir: "/data",
});

const asset = (kind: keyof typeof ASSET_KINDS): AssetField => ({
  kind: ASSET_KINDS[kind],
  root: ASSET_KINDS[kind].root,
  declared: true,
});

const draw = (kind: keyof typeof ASSET_KINDS, member: string) =>
  render(
    <MemoryRouter>
      <AssetPreview
        field={asset(kind)}
        member={member}
        assets={browsing(member)}
        label="Model"
      />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  modelAsked.length = 0;
  fileAsked.length = 0;
});

describe("a model field", () => {
  it("reads nothing until the preview is opened", () => {
    draw("model", "objects3d/ARMCOM.3do");
    expect(modelAsked.every((asked) => asked === undefined)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /show the model/i }));
    expect(modelAsked).toContain("objects3d/ARMCOM.3do");
  });

  it("offers the builder a .3do and an .s3o alike", () => {
    for (const member of ["objects3d/ARMCOM.3do", "objects3d/armaak.s3o"]) {
      draw("model", member);
      const link = screen.getByRole("link", { name: /open in the builder/i });
      expect(link.getAttribute("href")).toBe(
        `/lego/open?archive=ba.sdz&member=${encodeURIComponent(member)}&name=Balanced+Annihilation`,
      );
      cleanup();
    }
  });

  it("does not offer the builder a format it cannot open", () => {
    // A `.gltf` is drawn by the engine through a parser of its own, and there
    // is no reader for it here. A `.dae` stood in this test until the builder
    // learned to convert one, which is the case below.
    draw("model", "objects3d/thing.gltf");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/cannot open it/)).toBeTruthy();
  });

  it("offers the builder a Collada model, which it converts on the way in", () => {
    draw("model", "objects3d/thing.dae");
    expect(screen.queryByRole("link")).not.toBeNull();
  });
});

describe("the other two kinds", () => {
  it("draws a picture without being asked", () => {
    draw("picture", "unitpics/armaap.dds");
    expect(fileAsked).toContain("unitpics/armaap.dds");
    expect(screen.getByText("unitpics/armaap.dds")).toBeTruthy();
  });

  it("gives a script the file it resolved to and nothing else", () => {
    // The surprise the line exists for: the script framework searches below
    // `scripts/`, so a definition naming a bare file name reaches one nested
    // three folders down.
    draw("script", "scripts/fed/hbot/fedengineer_lus.lua");
    expect(
      screen.getByText("scripts/fed/hbot/fedengineer_lus.lua"),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
