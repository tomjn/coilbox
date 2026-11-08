// @vitest-environment happy-dom
/**
 * Recompile from the Decompile page fills the Compile page from the decompiled
 * folder alone (issue #5111), turns clamping off for the heightmap it
 * brought (issue #5110), and writes a mapinfo.lua that starts from the
 * decompiled map's own (issue #5119). The Compile page keeps its fields between visits, so
 * these start with another map's sources already in the draft.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import CompilePage from "./CompilePage";
import { defaultAdvanced } from "./components/AdvancedOptions";

const m = vi.hoisted(() => ({
  suggest: vi.fn(),
  mapinfo: vi.fn(),
  compile: vi.fn(),
  writeMapinfo: vi.fn(),
  draft: {} as Record<string, unknown>,
}));

vi.mock("../bindings", () => ({
  mcProbe: async () => ({ available: true, compile: true, decompile: true }),
  mcReadMapinfo: m.mapinfo,
  mcReadSkybox: async () => ({ dataUrl: null }),
  mcSuggestSources: m.suggest,
  mcCancel: async () => {},
  mcCompile: m.compile,
  mcInstallMap: async () => {},
  mcOpenPath: async () => {},
  mcPackMap: async () => {},
  mcReadTeams: async () => ({ teams: [] }),
  mcWriteMapinfo: m.writeMapinfo,
}));
// The compile streams its log over a channel, which needs the Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage = () => {};
  },
}));
vi.mock("../config", () => ({
  useMapconvConfig: () => [
    { defaultCompressionType: 1, lastTextureDir: "" },
    () => {},
  ],
}));
vi.mock("../drafts", () => ({
  useCompileDraft: () => [m.draft, () => {}],
}));
vi.mock("../projects", () => ({
  useMapProjects: () => ({ upsertProject: () => {} }),
}));
vi.mock("@/downloads/config", () => ({
  useWriteRoot: () => ({ path: "" }),
}));
vi.mock("./components/MapPreview3D", () => ({ MapPreview3D: () => null }));
vi.mock("./components/MapinfoOptions", () => ({ default: () => null }));
vi.mock("./components/PlayabilityPanel", () => ({
  CompiledPlayability: () => null,
}));
// The picker is a native file dialog, so a plain input stands in for it.
vi.mock("./components/PathField", () => ({
  PathField: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const OTHER_MAP = {
  ...defaultAdvanced,
  heightmap: "/other/heightmap.png",
  metalmap: "/other/metalmap.png",
  typemap: "/other/typemap.png",
  minimap: "/other/minimap.png",
  vegmap: "/other/vegmap.png",
  features: "/other/features.txt",
  minh: "200",
  maxh: "800",
};

function setup(dir: string) {
  m.draft = {
    maintexture: "/other/texture.png",
    outDir: "/other",
    outSuffix: "other",
    advanced: OTHER_MAP,
  };
  render(
    <MemoryRouter
      initialEntries={[{ pathname: "/", state: { recompileDir: dir } }]}
    >
      <CompilePage />
    </MemoryRouter>,
  );
}

const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;
const number = (name: RegExp) =>
  screen.getByRole("spinbutton", { name }) as HTMLInputElement;
const noclampOn = () =>
  screen
    .getByRole("checkbox", { name: /Disable height clamping/ })
    .getAttribute("aria-checked") === "true";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Recompile over a draft holding another map", () => {
  it("replaces every source and the height range, and turns clamping off", async () => {
    m.suggest.mockResolvedValue({
      heightmap: "/hbh/heightmap.png",
      metalmap: "/hbh/metalmap.png",
      typemap: "/hbh/typemap.png",
      minimap: "/hbh/minimap.png",
      features: "/hbh/features.txt",
    });
    m.mapinfo.mockResolvedValue({ minHeight: -53, maxHeight: 430 });
    setup("/hbh");
    await waitFor(() => {
      expect(field("Heightmap (-h)").value).toBe("/hbh/heightmap.png");
    });
    expect(field("Metal map (-m)").value).toBe("/hbh/metalmap.png");
    expect(field("Type map (-z)").value).toBe("/hbh/typemap.png");
    expect(field("Minimap (-minimap)").value).toBe("/hbh/minimap.png");
    expect(field("Features file (-features)").value).toBe("/hbh/features.txt");
    await waitFor(() => {
      expect(number(/Min height/).value).toBe("-53");
    });
    expect(number(/Max height/).value).toBe("430");
    expect(noclampOn()).toBe(true);
  });

  it("leaves a source the folder lacks empty and the range empty without a mapinfo", async () => {
    m.suggest.mockResolvedValue({ heightmap: "/hbh/heightmap.png" });
    m.mapinfo.mockResolvedValue({});
    setup("/hbh");
    await waitFor(() => {
      expect(field("Heightmap (-h)").value).toBe("/hbh/heightmap.png");
    });
    expect(field("Metal map (-m)").value).toBe("");
    expect(field("Type map (-z)").value).toBe("");
    expect(field("Minimap (-minimap)").value).toBe("");
    expect(field("Vegetation map (-v)").value).toBe("");
    expect(field("Features file (-features)").value).toBe("");
    expect(number(/Min height/).value).toBe("");
    expect(number(/Max height/).value).toBe("");
  });

  it("keeps clamping on when the folder has no heightmap", async () => {
    m.suggest.mockResolvedValue({});
    m.mapinfo.mockResolvedValue({});
    setup("/hbh");
    fireEvent.click(screen.getByText(/Advanced options/));
    await waitFor(() => {
      expect(field("Heightmap (-h)").value).toBe("");
    });
    expect(noclampOn()).toBe(false);
  });

  it("ignores a Recompile lookup that settles after another texture is picked", async () => {
    let settle: (s: Record<string, string>) => void = () => {};
    m.suggest.mockImplementationOnce(
      () => new Promise((resolve) => (settle = resolve)),
    );
    m.suggest.mockResolvedValue({});
    m.mapinfo.mockResolvedValue({ minHeight: -53, maxHeight: 430 });
    setup("/hbh");
    fireEvent.click(screen.getByText(/Advanced options/));
    fireEvent.change(field("Main texture (-t)"), {
      target: { value: "/next/texture.png" },
    });
    await waitFor(() => {
      expect(m.suggest).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      settle({ heightmap: "/hbh/heightmap.png" });
    });
    expect(field("Heightmap (-h)").value).toBe("");
    expect(noclampOn()).toBe(false);
  });

  it("turns clamping back on when the mapper picks another heightmap by hand", async () => {
    m.suggest.mockResolvedValue({ heightmap: "/hbh/heightmap.png" });
    m.mapinfo.mockResolvedValue({});
    setup("/hbh");
    await waitFor(() => {
      expect(noclampOn()).toBe(true);
    });
    fireEvent.change(field("Heightmap (-h)"), {
      target: { value: "/drawn/mine.png" },
    });
    expect(field("Heightmap (-h)").value).toBe("/drawn/mine.png");
    expect(noclampOn()).toBe(false);
  });

  it("writes mapinfo.lua starting from the decompiled map's own", async () => {
    m.suggest.mockResolvedValue({ heightmap: "/hbh/heightmap.png" });
    m.mapinfo.mockResolvedValue({});
    m.compile.mockResolvedValue({
      smfPath: "/hbh/hbh.smf",
      outSuffix: "hbh",
    });
    m.writeMapinfo.mockResolvedValue({
      path: "/hbh/mapinfo.lua",
      created: true,
      changed: true,
    });
    setup("/hbh");
    await waitFor(() => {
      expect(field("Heightmap (-h)").value).toBe("/hbh/heightmap.png");
    });
    fireEvent.click(screen.getByRole("button", { name: /^Compile$/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Write mapinfo.lua/ }),
    );
    await waitFor(() => {
      expect(m.writeMapinfo).toHaveBeenCalledTimes(1);
    });
    expect(m.writeMapinfo.mock.calls[0][0].opts.seedFrom).toBe("/hbh");
  });

  it("starts from no map's mapinfo.lua once another texture is picked", async () => {
    m.suggest.mockResolvedValue({});
    m.mapinfo.mockResolvedValue({});
    m.compile.mockResolvedValue({
      smfPath: "/next/hbh.smf",
      outSuffix: "hbh",
    });
    m.writeMapinfo.mockResolvedValue({
      path: "/hbh/mapinfo.lua",
      created: true,
      changed: true,
    });
    setup("/hbh");
    fireEvent.change(field("Main texture (-t)"), {
      target: { value: "/next/texture.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Compile$/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Write mapinfo.lua/ }),
    );
    await waitFor(() => {
      expect(m.writeMapinfo).toHaveBeenCalledTimes(1);
    });
    expect(m.writeMapinfo.mock.calls[0][0].opts.seedFrom).toBeUndefined();
  });
});
