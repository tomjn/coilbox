// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const info = vi.hoisted(() => vi.fn());
const status = vi.hoisted(() => vi.fn());
const exportSdz = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());

vi.mock("../../content/config", () => ({
  primeGameInfo: (...args: unknown[]) => info(...args),
}));
vi.mock("../../compat/bindings", () => ({
  compatStatus: (args: unknown) => status(args),
  compatExport: (args: unknown) => exportSdz(args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (args: unknown) => save(args),
}));

const { CompatHostExport } = await import("./CompatHostExport");

const press = () => {
  render(
    <CompatHostExport
      enginePath="/e"
      dataDir="/d"
      baseArchive="xta-9.65.sd7"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Export \.sdz/ }));
};

afterEach(cleanup);

beforeEach(() => {
  info.mockReset().mockResolvedValue({ checksum: "abc" });
  status.mockReset().mockResolvedValue({
    latest: 24,
    folder: "coilbox-compat-xta-9.65-24.sdd",
    stale: [],
  });
  save.mockReset().mockResolvedValue("/out/x.sdz");
  exportSdz.mockReset().mockResolvedValue({ path: "/out/x.sdz", files: [] });
});

describe("CompatHostExport", () => {
  it("exports the mutator to the path the host picks", async () => {
    press();
    await screen.findByText("/out/x.sdz");
    expect(save.mock.calls[0][0]).toMatchObject({
      defaultPath: "coilbox-compat-xta-9.65-24.sdz",
    });
    expect(exportSdz).toHaveBeenCalledWith({
      dataDir: "/d",
      enginePath: "/e",
      archiveName: "xta-9.65.sd7",
      baseChecksum: "abc",
      dest: "/out/x.sdz",
    });
  });

  it("writes nothing when the host cancels", async () => {
    save.mockResolvedValue(null);
    press();
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(exportSdz).not.toHaveBeenCalled();
  });

  it("shows why an export was refused", async () => {
    exportSdz.mockRejectedValue(new Error("mutator is stale"));
    press();
    await screen.findByText("mutator is stale");
  });

  it("says so when there is no mutator to export", async () => {
    status.mockResolvedValue({ latest: 24, folder: null, stale: [] });
    press();
    await screen.findByText("Not built");
    expect(save).not.toHaveBeenCalled();
  });
});
