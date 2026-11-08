// @vitest-environment happy-dom
/** Issue #399. The duplicate report lists each group with the space it takes. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuplicateReport } from "../../bindings";

const h = vi.hoisted(() => ({
  report: null as unknown,
  fail: null as string | null,
  calls: [] as string[][],
}));

vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return {
    ...actual,
    contentOpenPath: async () => ({}),
    contentDuplicateReport: async ({ roots }: { roots: string[] }) => {
      h.calls.push(roots);
      if (h.fail) throw new Error(h.fail);
      return { report: h.report };
    },
  };
});

const { DuplicateContent } = await import("./DuplicateContent");

afterEach(() => {
  cleanup();
  h.report = null;
  h.fail = null;
  h.calls = [];
});

const MIB = 1024 * 1024;

const report: DuplicateReport = {
  wastedBytes: 15 * MIB,
  groups: [
    {
      kind: "sameName",
      category: "maps",
      name: "Tabula.sd7",
      sizesMatch: true,
      wastedBytes: 10 * MIB,
      copies: [
        {
          path: "/a/maps/Tabula.sd7",
          root: "/a",
          bytes: 10 * MIB,
          source: "file",
        },
        {
          path: "/b/maps/Tabula.sd7",
          root: "/b",
          bytes: 10 * MIB,
          source: "file",
        },
      ],
    },
    {
      kind: "mapInRapid",
      category: "maps",
      name: "ruins",
      sizesMatch: null,
      wastedBytes: 5 * MIB,
      copies: [
        {
          path: "/a/maps/ruins.sdz",
          root: "/a",
          bytes: 5 * MIB,
          source: "file",
        },
        {
          path: "/a/packages/ab.sdp",
          root: "/a",
          bytes: 8 * MIB,
          source: "rapid",
        },
      ],
    },
    {
      kind: "sameName",
      category: "games",
      name: "g.sdz",
      sizesMatch: false,
      wastedBytes: 0,
      copies: [
        { path: "/a/games/g.sdz", root: "/a", bytes: 1 * MIB, source: "file" },
        { path: "/b/games/g.sdz", root: "/b", bytes: 2 * MIB, source: "file" },
      ],
    },
  ],
};

describe("DuplicateContent", () => {
  it("lists each duplicate with its copies and the space it takes", async () => {
    h.report = report;
    render(<DuplicateContent roots={["/a", "/b"]} version={0} />);

    expect(await screen.findByText("Tabula.sd7")).toBeTruthy();
    expect(h.calls).toEqual([["/a", "/b"]]);
    expect(screen.getByText("/b/maps/Tabula.sd7")).toBeTruthy();
    expect(screen.getByText("/a/packages/ab.sdp")).toBeTruthy();
    expect(screen.getByText("3 duplicates", { exact: false })).toBeTruthy();
    expect(
      screen.getByText("15 MB in extra copies", { exact: false }),
    ).toBeTruthy();
    expect(screen.getByText("Same name and size")).toBeTruthy();
    expect(screen.getByText("Loose map and rapid package")).toBeTruthy();
    expect(screen.getByText("Same name, different sizes")).toBeTruthy();
  });

  it("says so when there are no duplicates", async () => {
    h.report = { groups: [], wastedBytes: 0 };
    render(<DuplicateContent roots={["/a"]} version={0} />);
    expect(await screen.findByText("No duplicates found.")).toBeTruthy();
  });

  it("shows the error when the report fails", async () => {
    h.fail = "boom";
    render(<DuplicateContent roots={["/a"]} version={0} />);
    expect(await screen.findByText(/boom/)).toBeTruthy();
  });

  it("reads again when the version changes", async () => {
    h.report = { groups: [], wastedBytes: 0 };
    const { rerender } = render(
      <DuplicateContent roots={["/a"]} version={0} />,
    );
    await screen.findByText("No duplicates found.");
    rerender(<DuplicateContent roots={["/a"]} version={1} />);
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
  });
});
