import { describe, expect, it, vi } from "vitest";
import type {
  ContentState,
  PlayerWidgetFile,
  PlayerWidgetScan,
} from "@/content/bindings";

const failing = new Set<string>();
vi.mock("@/content/bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("@/content/bindings");
  return {
    ...actual,
    contentPlayerWidgets: async (args: { writeDir: string }) => {
      if (failing.has(args.writeDir)) throw new Error("denied");
      return {
        caseSensitive: args.writeDir === "/a",
        folders: [`${args.writeDir}-folder`],
        files: [file(args.writeDir)],
        errors: [`${args.writeDir}-error`],
      } satisfies PlayerWidgetScan;
    },
  };
});

const { scanWidgetRoots, widgetRoots } = await import("./widgetRoots");

function file(root: string): PlayerWidgetFile {
  return {
    root,
    caseSensitive: false,
    path: "LuaUI/Widgets/a.lua",
    folder: "LuaUI/Widgets",
    nested: false,
    coilbox: false,
    givesOrders: false,
    info: { name: "A" },
    error: null,
  };
}

const root = (path: string, over: object = {}) => ({
  path,
  exists: true,
  valid: true,
  ...over,
});
const state = (...roots: ReturnType<typeof root>[]) =>
  ({ schemaVersion: 1, roots }) as unknown as ContentState;

describe("widgetRoots", () => {
  it("lists the selected root first, then the others that exist and validate", () => {
    const s = state(
      root("/x"),
      root("/a"),
      root("/gone", { exists: false }),
      root("/bad", { valid: false }),
    );
    expect(widgetRoots(s, "/a")).toEqual(["/a", "/x"]);
  });

  it("lists the selected root when the state is not read yet", () => {
    expect(widgetRoots(null, "/a")).toEqual(["/a"]);
  });
});

describe("scanWidgetRoots", () => {
  it("joins the files and errors, and takes folders from the first root", async () => {
    const scan = await scanWidgetRoots(["/a", "/b"]);
    expect(scan.files.map((f) => f.root)).toEqual(["/a", "/b"]);
    expect(scan.folders).toEqual(["/a-folder"]);
    expect(scan.caseSensitive).toBe(true);
    expect(scan.errors).toEqual(["/a-error", "/b-error"]);
  });

  it("says so when another root cannot be scanned, and lists the rest", async () => {
    failing.add("/b");
    const scan = await scanWidgetRoots(["/a", "/b"]);
    failing.clear();
    expect(scan.files.map((f) => f.root)).toEqual(["/a"]);
    expect(scan.errors).toEqual(["/a-error", "could not read /b: denied"]);
  });

  it("throws when the first root cannot be scanned", async () => {
    failing.add("/a");
    await expect(scanWidgetRoots(["/a", "/b"])).rejects.toThrow("denied");
    failing.clear();
  });
});
