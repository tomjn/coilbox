import { describe, expect, it, vi } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import { coilboxWidgetInstalled, withUserWidgets } from "./userWidgets";

const h = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock("@/content/bindings", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  contentWidgetStatus: (args: unknown) => h.status(args),
}));

const option = (over: Partial<ConfigOption> = {}): ConfigOption =>
  ({
    key: "allowuserwidgets",
    name: "Allow user widgets",
    type: "bool",
    default: "0",
    ...over,
  }) as ConfigOption;

describe("withUserWidgets", () => {
  it("adds the option when a widget is installed and the game ships it off", () => {
    expect(withUserWidgets({ a: "1" }, [option()], true)).toEqual({
      a: "1",
      allowuserwidgets: "1",
    });
  });

  it("adds nothing with no widget installed", () => {
    expect(withUserWidgets({}, [option()], false)).toEqual({});
  });

  it("adds nothing when the game does not define the option", () => {
    expect(withUserWidgets({}, [option({ key: "other" })], true)).toEqual({});
    expect(withUserWidgets({}, [], true)).toEqual({});
  });

  it("does not mistake a section of that name for the option", () => {
    expect(withUserWidgets({}, [option({ type: "section" })], true)).toEqual(
      {},
    );
  });

  it("keeps a value the player set, including off", () => {
    expect(
      withUserWidgets({ allowuserwidgets: "0" }, [option()], true),
    ).toEqual({ allowuserwidgets: "0" });
  });

  it("adds nothing when the game already ships it on", () => {
    expect(withUserWidgets({}, [option({ default: "1" })], true)).toEqual({});
  });
});

describe("coilboxWidgetInstalled", () => {
  const status = (installed: boolean) => ({
    installed,
    current: true,
    files: [],
    stale: [],
  });

  it("is true when either widget is installed, read from the given root", async () => {
    h.status.mockImplementation(async ({ widget }: { widget: string }) =>
      status(widget === "skeleton"),
    );
    expect(await coilboxWidgetInstalled("/data")).toBe(true);
    expect(h.status).toHaveBeenCalledWith({
      rootPath: "/data",
      widget: "blueprints",
    });
  });

  it("is false when neither is installed", async () => {
    h.status.mockImplementation(async () => status(false));
    expect(await coilboxWidgetInstalled("/data")).toBe(false);
  });

  it("counts a failed read as not installed", async () => {
    h.status.mockRejectedValue(new Error("unreadable"));
    expect(await coilboxWidgetInstalled("/data")).toBe(false);
  });
});
