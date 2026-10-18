// @vitest-environment happy-dom
/**
 * Issue #4561. The switch is the only thing that builds a compat mutator, so
 * these check that it builds when turned on, that a stale folder offers
 * Rebuild, that Remove deletes, and that the setting survives a remount.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompatBuilt, CompatStatus } from "../../../compat/bindings";

const store = vi.hoisted(() => new Map<string, unknown>());
const build = vi.hoisted(() => vi.fn());
const status = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());

vi.mock("@picoframe/frame", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return {
    ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
    useSetting: <T,>(key: string, fallback: T): [T, (next: T) => void] => {
      const [value, setValue] = react.useState<T>(
        (store.get(key) as T | undefined) ?? fallback,
      );
      return [
        value,
        (next: T) => {
          store.set(key, next);
          setValue(next);
        },
      ];
    },
  };
});

vi.mock("../../../compat/bindings", () => ({
  compatBuild: (args: unknown) => build(args),
  compatStatus: (args: unknown) => status(args),
  compatRemove: (args: unknown) => remove(args),
}));

const { CompatMode } = await import("./CompatMode");

const BUILT: CompatBuilt = {
  dir: "/data/games/coilbox-compat-xta-9.65-2.sdd",
  folder: "coilbox-compat-xta-9.65-2.sdd",
  files: [],
  models: {
    modelsFound: 12,
    modelsWritten: 10,
    unreadable: {},
    didNotFit: [],
    errors: [],
  },
  notes: [],
  preludeFixes: ["a", "b", "c"],
  gadgets: ["coilbox_compat_aircraft", "coilbox_compat_ground"],
  defOverrides: 10,
};

const NONE: CompatStatus = { latest: 2, folder: null, stale: [] };
const CURRENT: CompatStatus = {
  latest: 2,
  folder: BUILT.folder,
  stale: [],
};
const STALE: CompatStatus = {
  latest: 2,
  folder: "coilbox-compat-xta-9.65-1.sdd",
  stale: [{ kind: "manifest", built: 1, now: 2 }],
};

const view = () => (
  <CompatMode
    enginePath="/engines/105"
    dataDir="/data"
    archiveName="xta-9.65.sd7"
    gameName="XTA 9.65"
    checksum="1234abcd"
  />
);

beforeEach(() => {
  store.clear();
  build.mockReset();
  status.mockReset();
  remove.mockReset();
});
afterEach(cleanup);

const compatSwitch = () =>
  screen.getByRole("switch", { name: "Compatibility mode" });

describe("CompatMode", () => {
  it("builds with the latest manifest when turned on and shows the result", async () => {
    status.mockResolvedValueOnce(NONE).mockResolvedValue(CURRENT);
    build.mockResolvedValue(BUILT);
    render(view());
    await waitFor(() =>
      expect((compatSwitch() as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(compatSwitch());
    await waitFor(() => expect(build).toHaveBeenCalledTimes(1));
    expect(build).toHaveBeenCalledWith({
      dataDir: "/data",
      enginePath: "/engines/105",
      archiveName: "xta-9.65.sd7",
      gameName: "XTA 9.65",
      baseChecksum: "1234abcd",
      manifestVersion: 2,
    });
    await screen.findByText("10 models converted of 12");
    screen.getByText("3 prelude functions");
    screen.getByText(/coilbox_compat_aircraft, coilbox_compat_ground/);
    screen.getByText("10 def overrides");
    expect(compatSwitch().getAttribute("aria-checked")).toBe("true");
    expect(store.get("content.compat")).toEqual({
      "xta-9.65.sd7": { enabled: true, version: 2 },
    });
  });

  it("turns off without building or deleting anything", async () => {
    status.mockResolvedValue(CURRENT);
    store.set("content.compat", {
      "xta-9.65.sd7": { enabled: true, version: 2 },
    });
    render(view());
    await waitFor(() =>
      expect((compatSwitch() as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(compatSwitch());
    expect(build).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(store.get("content.compat")).toEqual({
      "xta-9.65.sd7": { enabled: false, version: 2 },
    });
  });

  it("turns on a current folder without rebuilding it", async () => {
    status.mockResolvedValue(CURRENT);
    render(view());
    await waitFor(() =>
      expect((compatSwitch() as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(compatSwitch());
    expect(build).not.toHaveBeenCalled();
    expect(compatSwitch().getAttribute("aria-checked")).toBe("true");
  });

  it("offers Rebuild only when the folder is stale", async () => {
    status.mockResolvedValue(CURRENT);
    const first = render(view());
    await screen.findByRole("button", { name: /Remove/ });
    expect(screen.queryByRole("button", { name: /Rebuild/ })).toBeNull();
    first.unmount();

    status.mockResolvedValue(STALE);
    build.mockResolvedValue(BUILT);
    render(view());
    const rebuild = await screen.findByRole("button", { name: /Rebuild/ });
    screen.getByText(/built from compatibility version 1, now 2/);
    fireEvent.click(rebuild);
    await waitFor(() => expect(build).toHaveBeenCalledTimes(1));
  });

  it("deletes the folder and forgets the setting on Remove", async () => {
    status.mockResolvedValueOnce(CURRENT).mockResolvedValue(NONE);
    remove.mockResolvedValue([BUILT.folder]);
    store.set("content.compat", {
      "xta-9.65.sd7": { enabled: true, version: 2 },
    });
    render(view());
    fireEvent.click(await screen.findByRole("button", { name: /Remove/ }));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({
        dataDir: "/data",
        archiveName: "xta-9.65.sd7",
      }),
    );
    await waitFor(() => expect(store.get("content.compat")).toEqual({}));
    expect(compatSwitch().getAttribute("aria-checked")).toBe("false");
  });

  it("keeps the setting across a remount", async () => {
    status.mockResolvedValue(CURRENT);
    store.set("content.compat", {
      "xta-9.65.sd7": { enabled: true, version: 2 },
    });
    render(view());
    await waitFor(() =>
      expect(compatSwitch().getAttribute("aria-checked")).toBe("true"),
    );
  });

  it("shows a failed build and leaves the setting alone", async () => {
    status.mockResolvedValue(NONE);
    build.mockRejectedValue(new Error("no space left on device"));
    render(view());
    await waitFor(() =>
      expect((compatSwitch() as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(compatSwitch());
    await screen.findByText("no space left on device");
    expect(store.has("content.compat")).toBe(false);
    expect(compatSwitch().getAttribute("aria-checked")).toBe("false");
  });
});
