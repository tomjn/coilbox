// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DownloadsConfig } from "../../../downloads/config";
import type { ContentRoot } from "../../bindings";

const h = vi.hoisted(() => ({
  cfg: { rapidRepos: [] } as DownloadsConfig,
  setCfg: vi.fn(),
}));

vi.mock("../../../downloads/config", () => ({
  useDownloadsConfig: () => [h.cfg, h.setCfg],
}));
// The real one is a Radix select, which happy-dom cannot open.
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="" />
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const { DownloadFolders } = await import("./DownloadFolders");

const root = (id: string, extra: Partial<ContentRoot> = {}) =>
  ({ id, path: `/data/${id}`, ...extra }) as ContentRoot;

const picker = (label: string) =>
  screen.getByLabelText(label) as HTMLSelectElement;
const optionsOf = (label: string) =>
  [...picker(label).options].map((o) => o.textContent).filter(Boolean);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.cfg = { rapidRepos: [] };
});

describe("DownloadFolders", () => {
  it("shows nothing when there is no folder to download into", () => {
    const { container } = render(
      <DownloadFolders roots={[root("bundle", { bundled: true })]} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("offers every folder but the bundled one, by label when it has one", () => {
    render(
      <DownloadFolders
        roots={[
          root("a", { label: "Main" }),
          root("b"),
          root("bundle", { bundled: true }),
        ]}
      />,
    );
    expect(optionsOf("Default")).toEqual(["Main", "/data/b"]);
    expect(optionsOf("Games")).toEqual(["Same as default", "Main", "/data/b"]);
    expect(optionsOf("Maps")).toEqual(["Same as default", "Main", "/data/b"]);
  });

  it("shows games and maps following the default until they are set", () => {
    h.cfg = { rapidRepos: [], writeRootId: "a", mapsRootId: "b" };
    render(<DownloadFolders roots={[root("a"), root("b")]} />);
    expect(picker("Default").value).toBe("a");
    expect(picker("Games").value).toBe("same-as-default");
    expect(picker("Maps").value).toBe("b");
  });

  it("shows a kind whose folder was removed as following the default", () => {
    h.cfg = { rapidRepos: [], writeRootId: "a", gamesRootId: "gone" };
    render(<DownloadFolders roots={[root("a"), root("b")]} />);
    expect(picker("Games").value).toBe("same-as-default");
  });

  it("saves a folder for one kind and leaves the rest of the config alone", () => {
    h.cfg = { rapidRepos: [], writeRootId: "a" };
    render(<DownloadFolders roots={[root("a"), root("b")]} />);
    fireEvent.change(picker("Maps"), { target: { value: "b" } });
    expect(h.setCfg).toHaveBeenCalledWith({
      rapidRepos: [],
      writeRootId: "a",
      mapsRootId: "b",
    });
  });

  it("clears a kind's folder when it is set back to the default", () => {
    h.cfg = { rapidRepos: [], writeRootId: "a", gamesRootId: "b" };
    render(<DownloadFolders roots={[root("a"), root("b")]} />);
    fireEvent.change(picker("Games"), {
      target: { value: "same-as-default" },
    });
    expect(h.setCfg).toHaveBeenCalledWith({
      rapidRepos: [],
      writeRootId: "a",
      gamesRootId: undefined,
    });
  });

  it("saves a new default", () => {
    h.cfg = { rapidRepos: [], writeRootId: "a" };
    render(<DownloadFolders roots={[root("a"), root("b")]} />);
    fireEvent.change(picker("Default"), { target: { value: "b" } });
    expect(h.setCfg).toHaveBeenCalledWith({ rapidRepos: [], writeRootId: "b" });
  });
});
