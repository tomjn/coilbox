// @vitest-environment happy-dom

/**
 * The detail panel beside the inventory grid (#4537): one frame with a body
 * for a part, a shape or a module, and a module's actions as labelled buttons.
 * The canvas is replaced by a hook that runs the view's build.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InventoryRef } from "../../inventory";
import { type LegoProject, newProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import { SHAPE_KINDS } from "../../shapes";

const motion = vi.hoisted(() => ({ reduce: false }));

vi.mock("@/lib/useCanvas3D", async () => {
  const { useLayoutEffect } = await import("react");
  return {
    useCanvas3D: (
      _host: unknown,
      build: (canvas: unknown) => { dispose: () => void } | undefined,
      deps: unknown[],
    ) => {
      useLayoutEffect(() => {
        const renderer = {
          domElement: document.createElement("canvas"),
          render() {},
        };
        const scene = build({ renderer });
        return () => scene?.dispose();
      }, deps);
    },
  };
});

vi.mock("../../../general/display", () => ({
  useReduceMotion: () => motion.reduce,
}));

vi.mock("../../geometry", () => ({
  addStandardLights: () => {},
  partMaterial: () => new THREE.MeshBasicMaterial(),
  importedMaterial: () => ({
    material: new THREE.MeshBasicMaterial(),
    dispose: () => {},
  }),
}));

vi.mock("../../pack", async (actual) => ({
  ...(await actual<typeof import("../../pack")>()),
  getPartGeometry: () => new THREE.BoxGeometry(),
}));

vi.mock("../../rawGeometry", async (actual) => ({
  ...(await actual<typeof import("../../rawGeometry")>()),
  loadRawGeometry: () => new Promise(() => {}),
}));

import { DetailPanel, type ModuleActions } from "./DetailPanel";

function part(id: string, colourway: string): LegoPartInfo {
  return {
    id,
    name: `${colourway} beam`,
    shape: "beam",
    shapeId: "beam-4",
    colourway,
    tags: ["beam", "huge"],
    sourceNames: [`Object-${id}`],
    packId: "lego",
    iCount: 36,
    vCount: 24,
    uvBox: { min: [0, 0], max: [0.5, 0.5] },
    bbox: { min: [0, 0, 0], max: [4, 0.5, 0.5] },
  } as unknown as LegoPartInfo;
}

const grey = part("p-grey", "grey");
const tan = part("p-tan", "tan");

function packWith(packs = ["lego"]): LoadedPack {
  return {
    manifest: {
      categories: [
        { id: "grey", label: "Grey" },
        { id: "tan", label: "Tan" },
      ],
    },
    library: {
      packs: packs.map((id) => ({ id })),
      atlases: [{ tex1: "atlas.png", packId: "lego", folder: null }],
    },
    parts: [grey, tan],
    byId: new Map([
      [grey.id, grey],
      [tan.id, tan],
    ]),
  } as unknown as LoadedPack;
}

function module(id: string, over: Partial<LegoProject> = {}): LegoProject {
  return {
    ...newProject({
      id,
      rootPieceId: "root",
      name: id,
      packId: "lego",
      packVersion: "1",
      now: "2026-10-18T00:00:00Z",
    }),
    ...over,
  };
}

const builtIn = module("builtin.hull", {
  name: "Hull section",
  category: "Chassis",
  tags: ["hull", "plate"],
});
const saved = module("block9", { name: "block9" });
const other = module("twin", { name: "Twin turret", category: "Turret" });
const lifted = module("armcom-arm", {
  name: "Commander arm",
  game: { name: "Beyond All Reason" } as LegoProject["game"],
  pieces: [
    {
      ...newProject({
        id: "x",
        rootPieceId: "root",
        name: "x",
        packId: "lego",
        packVersion: "1",
        now: "2026-10-18T00:00:00Z",
      }).pieces[0],
      lifted: {
        game: { name: "Beyond All Reason" },
        member: "objects3d/armcom.s3o",
        unit: "armcom",
      } as NonNullable<LegoProject["pieces"][number]["lifted"]>,
    },
  ],
});
const compounds = [builtIn, saved, other, lifted];

function actions(over: Partial<ModuleActions> = {}): ModuleActions {
  return {
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onCopy: vi.fn(() => Promise.resolve(module("copy"))),
    onSaveFile: vi.fn(),
    onShare: vi.fn(),
    onLabels: vi.fn(),
    ...over,
  };
}

function show(
  selected: InventoryRef,
  props: Partial<Parameters<typeof DetailPanel>[0]> = {},
) {
  const all = {
    onSelect: vi.fn(),
    onClose: vi.fn(),
    moduleActions: actions(),
    ...props,
  };
  const view = render(
    <DetailPanel
      pack={packWith()}
      selected={selected}
      compounds={compounds}
      {...all}
    />,
  );
  return { ...all, ...view };
}

const button = (name: string) => screen.queryByRole("button", { name });

let frames: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  motion.reduce = false;
  frames = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the frame", () => {
  it("closes with its X", () => {
    const { onClose } = show({ kind: "part", id: grey.id });
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("is the builder's right column width", () => {
    show({ kind: "part", id: grey.id });
    expect(screen.getByRole("complementary").className).toContain("w-72");
  });

  it("keeps the frame rate label off its preview", () => {
    const { container } = show({ kind: "part", id: grey.id });
    // `frameRate.dom.test.ts` covers what the mark does.
    expect(container.querySelectorAll("[data-frame-rate=off]")).toHaveLength(1);
  });

  it("shows nothing for a module that has gone", () => {
    const { container } = show({ kind: "module", id: "deleted" });
    expect(container.textContent).toBe("");
  });
});

describe("a part", () => {
  it("shows its name, size and where it came from", () => {
    const { container } = show({ kind: "part", id: grey.id });
    expect(screen.getByRole("heading", { name: "grey beam" })).toBeTruthy();
    expect(container.textContent).toContain("4.00 x 0.50 x 0.50");
    expect(container.textContent).toContain("beam, huge");
    expect(container.textContent).toContain("12 from 24 vertices");
    expect(container.textContent).toContain("Object-p-grey");
    expect(screen.queryByText("Pack")).toBeNull();
  });

  it("switches colourway by choosing the other part", () => {
    const { onSelect } = show({ kind: "part", id: grey.id });
    expect(button("Grey")?.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button("Tan") as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith({ kind: "part", id: tan.id });
  });

  it("names the pack once there is more than one", () => {
    render(
      <DetailPanel
        pack={packWith(["lego", "extras"])}
        selected={{ kind: "part", id: grey.id }}
        compounds={compounds}
        moduleActions={actions()}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Pack")).toBeTruthy();
  });
});

describe("a shape", () => {
  const cylinder = SHAPE_KINDS.find((s) => s.id === "cylinder");

  it("shows the kind, its numbers and its tags, and no part fields", () => {
    const { container } = show({ kind: "shape", id: "cylinder" });
    expect(screen.getByRole("heading", { name: "Cylinder" })).toBeTruthy();
    expect(container.textContent).toContain(cylinder?.size.join(" x "));
    expect(container.textContent).toContain(cylinder?.tags.join(", "));
    expect(screen.getByText("sides")).toBeTruthy();
    for (const label of ["Part id", "Colourway", "Pack", "Atlas"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("turns the preview, unless motion is reduced", () => {
    show({ kind: "shape", id: "cylinder" });
    expect(frames).toHaveBeenCalled();
    cleanup();
    frames.mockClear();
    motion.reduce = true;
    show({ kind: "shape", id: "cylinder" });
    expect(frames).not.toHaveBeenCalled();
  });

  it("offers Add in the builder only", () => {
    show({ kind: "shape", id: "cylinder" });
    expect(button("Add")).toBeNull();
    cleanup();
    const onAddShape = vi.fn();
    show({ kind: "shape", id: "cylinder" }, { onAddShape });
    fireEvent.click(button("Add") as HTMLElement);
    expect(onAddShape).toHaveBeenCalledWith(cylinder);
  });
});

describe("a built in module", () => {
  it("shows its labels and pieces, with no fields to change them", () => {
    const { container } = show({ kind: "module", id: builtIn.id });
    expect(container.textContent).toContain("Built in · 1 piece");
    expect(container.textContent).toContain("Chassis");
    expect(container.textContent).toContain("hull, plate");
    expect(screen.queryByLabelText("Module name")).toBeNull();
    expect(screen.queryByLabelText("Module category")).toBeNull();
  });

  it("offers a copy and no Share or Delete", () => {
    show({ kind: "module", id: builtIn.id });
    expect(button("Make my own copy")).toBeTruthy();
    expect(button("Share")).toBeNull();
    expect(button("Delete")).toBeNull();
  });

  it("opens the copy once it is saved", async () => {
    const copy = module("mine");
    const moduleActions = actions({
      onCopy: vi.fn(() => Promise.resolve(copy)),
    });
    const { onSelect } = show(
      { kind: "module", id: builtIn.id },
      { moduleActions },
    );
    fireEvent.click(button("Make my own copy") as HTMLElement);
    expect(moduleActions.onCopy).toHaveBeenCalledWith(builtIn);
    await vi.waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({ kind: "module", id: "mine" }),
    );
  });

  it("spins its preview", () => {
    show({ kind: "module", id: builtIn.id });
    expect(frames).toHaveBeenCalled();
  });
});

describe("a saved module", () => {
  const name = () => screen.getByLabelText("Module name") as HTMLInputElement;

  it("says it is saved, and offers Save to file, Share and Delete", () => {
    const { container } = show({ kind: "module", id: saved.id });
    expect(container.textContent).toContain("Saved · 1 piece");
    for (const label of ["Save to file", "Share", "Delete"]) {
      expect(button(label)).toBeTruthy();
    }
    expect(button("Make my own copy")).toBeNull();
  });

  it("saves to file and shares", () => {
    const { moduleActions } = show({ kind: "module", id: saved.id });
    fireEvent.click(button("Save to file") as HTMLElement);
    fireEvent.click(button("Share") as HTMLElement);
    expect(moduleActions.onSaveFile).toHaveBeenCalledWith(saved);
    expect(moduleActions.onShare).toHaveBeenCalledWith(saved);
  });

  it("deletes and closes", () => {
    const { moduleActions, onClose } = show({ kind: "module", id: saved.id });
    fireEvent.click(button("Delete") as HTMLElement);
    expect(moduleActions.onDelete).toHaveBeenCalledWith(saved.id);
    expect(onClose).toHaveBeenCalled();
  });

  it("renames when the name field is left", () => {
    const { moduleActions } = show({ kind: "module", id: saved.id });
    fireEvent.change(name(), { target: { value: "  Big block " } });
    fireEvent.blur(name());
    expect(moduleActions.onRename).toHaveBeenCalledWith(
      expect.objectContaining({ id: saved.id }),
      "Big block",
    );
  });

  it("renames on Enter, and only once", () => {
    const { moduleActions } = show({ kind: "module", id: saved.id });
    fireEvent.change(name(), { target: { value: "Big block" } });
    fireEvent.keyDown(name(), { key: "Enter" });
    fireEvent.blur(name());
    expect(moduleActions.onRename).toHaveBeenCalledTimes(1);
  });

  it("keeps an empty or clashing name in the field with the reason", () => {
    const { moduleActions } = show({ kind: "module", id: saved.id });
    fireEvent.change(name(), { target: { value: "   " } });
    fireEvent.blur(name());
    expect(screen.getByText("Name cannot be empty")).toBeTruthy();
    fireEvent.change(name(), { target: { value: "twin turret" } });
    fireEvent.blur(name());
    expect(
      screen.getByText("Another module already has this name"),
    ).toBeTruthy();
    expect(name().getAttribute("aria-invalid")).toBe("true");
    expect(moduleActions.onRename).not.toHaveBeenCalled();
  });

  it("gives up an edit on Escape, and keeps that Escape from closing the panel", () => {
    const outside = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: listens for what reaches it
      <div onKeyDown={(event) => outside(event.defaultPrevented)}>
        <DetailPanel
          pack={packWith()}
          selected={{ kind: "module", id: saved.id }}
          compounds={compounds}
          moduleActions={actions()}
          onSelect={vi.fn()}
          onClose={vi.fn()}
        />
      </div>,
    );
    fireEvent.change(name(), { target: { value: "Something" } });
    fireEvent.keyDown(name(), { key: "Escape" });
    expect(name().value).toBe("block9");
    expect(outside).toHaveBeenLastCalledWith(true);
    // Nothing left to give up, so this one is the panel's.
    fireEvent.keyDown(name(), { key: "Escape" });
    expect(outside).toHaveBeenLastCalledWith(false);
  });

  it("starts from the module's own category and tags", () => {
    show({ kind: "module", id: "twin" });
    expect(
      (screen.getByLabelText("Module category") as HTMLInputElement).value,
    ).toBe("Turret");
  });

  it("saves a typed category using the spelling already in use", () => {
    const { moduleActions } = show({ kind: "module", id: saved.id });
    fireEvent.change(screen.getByLabelText("Module category"), {
      target: { value: "turret" },
    });
    fireEvent.blur(screen.getByLabelText("Module category"));
    fireEvent.change(screen.getByLabelText("Module tags"), {
      target: { value: "gun, gun, big" },
    });
    fireEvent.keyDown(screen.getByLabelText("Module tags"), { key: "Enter" });
    expect(moduleActions.onLabels).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: saved.id, category: "Turret" }),
      { category: "Turret", tags: ["gun", "big"] },
    );
  });

  it("saves a picked suggestion straight away", () => {
    const { moduleActions } = show({ kind: "module", id: saved.id });
    fireEvent.click(button("Leg") as HTMLElement);
    expect(moduleActions.onLabels).toHaveBeenCalledWith(saved, {
      category: "Leg",
      tags: [],
    });
  });

  it("does not save labels that did not change", () => {
    const { moduleActions } = show({ kind: "module", id: "twin" });
    fireEvent.blur(screen.getByLabelText("Module category"));
    expect(moduleActions.onLabels).not.toHaveBeenCalled();
  });

  it("saves an emptied category as none", () => {
    const { moduleActions } = show({ kind: "module", id: "twin" });
    fireEvent.change(screen.getByLabelText("Module category"), {
      target: { value: "  " },
    });
    fireEvent.blur(screen.getByLabelText("Module category"));
    expect(moduleActions.onLabels).toHaveBeenCalledWith(other, {
      category: undefined,
      tags: [],
    });
  });

  it("offers Place in the builder only", () => {
    show({ kind: "module", id: saved.id });
    expect(button("Place")).toBeNull();
    cleanup();
    const onPlaceModule = vi.fn();
    show({ kind: "module", id: saved.id }, { onPlaceModule });
    fireEvent.click(button("Place") as HTMLElement);
    expect(onPlaceModule).toHaveBeenCalledWith(saved);
  });
});

describe("a module lifted from a game", () => {
  it("names the game and credits the unit", () => {
    const { container } = show({ kind: "module", id: lifted.id });
    expect(screen.getByText("Lifted from")).toBeTruthy();
    expect(container.textContent).toContain("Beyond All Reason");
    expect(container.textContent).toContain(
      "From Beyond All Reason, unit armcom",
    );
  });

  it("can be shared and deleted but not saved to a file", () => {
    show({ kind: "module", id: lifted.id });
    expect(button("Share")).toBeTruthy();
    expect(button("Delete")).toBeTruthy();
    expect(button("Save to file")).toBeNull();
  });
});
