// @vitest-environment happy-dom
/**
 * The settings drawer (issue #1291) over an in-memory game folder: it shows what
 * a widget saved, writes edits together, and stays read only while a game runs.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetHandler } from "../handlers";
import type { WidgetRow } from "../widgetList";

const DIR = "/home/player/.spring/engine/2026.09.01";
const CONTENT = "/home/player/.spring";
const FILE = `${DIR}/LuaUI/Config/MF.lua`;
const WIDGET = `${CONTENT}/LuaUI/Widgets/watch.lua`;

const DATA = `return {
\tdata = {
\t\t["Build Watch"] = {
\t\t\tcolours = {
\t\t\t\t[1] = 0.5,
\t\t\t},
\t\t\tenabled = true,
\t\t\tlabel = "hello",
\t\t\tsize = 12,
\t\t},
\t},
\torder = {
\t\t["Build Watch"] = 1,
\t},
}
`;

const disk = new Map<string, string>();
const writes: string[] = [];
const play = { running: false };

vi.mock("@/blueprint/fileIO", () => ({
  appFileIO: {
    read: async (p: string) => disk.get(p) ?? null,
    write: async (p: string, text: string) => {
      writes.push(p);
      disk.set(p, text);
    },
  },
}));

vi.mock("@/play/PlayProvider", () => ({
  usePlay: () => play,
}));

const { WidgetSettingsDrawer } = await import("./WidgetSettings");

const handler: WidgetHandler = {
  id: "engine",
  family: "engine",
  folders: ["LuaUI/Widgets"],
  subfolders: false,
  config: { files: ["{short}.lua"], shape: "nested" },
};

const row = {
  path: "LuaUI/Widgets/watch.lua",
  info: { name: "Build Watch" },
} as WidgetRow;

const open = (name = "Build Watch") =>
  render(
    <WidgetSettingsDrawer
      writeDir={DIR}
      widgetDir={CONTENT}
      onClose={() => {}}
      target={{
        row,
        sw: { kind: "ready", name, previousNames: [] },
        game: "Metal Factions v2.58",
        shortName: "MF",
        handler,
      }}
    />,
  );

beforeEach(() => {
  disk.clear();
  writes.length = 0;
  play.running = false;
  disk.set(FILE, DATA);
  disk.set(WIDGET, "function widget:GetConfigData() return {} end");
});

afterEach(cleanup);

describe("WidgetSettingsDrawer", () => {
  it("shows the keys and values a widget saved, with their types", async () => {
    open();
    expect(
      ((await screen.findByLabelText("size")) as HTMLInputElement).value,
    ).toBe("12");
    expect(
      ((await screen.findByLabelText("label")) as HTMLInputElement).value,
    ).toBe("hello");
    expect(
      screen
        .getByRole("switch", { name: "enabled" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText("number")).toBeTruthy();
    expect(screen.getByText("text")).toBeTruthy();
    expect(screen.getByText("true or false")).toBeTruthy();
    // A table inside the first is closed until it is opened.
    expect(screen.queryByLabelText("1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /colours/ }));
    expect((screen.getByLabelText("1") as HTMLInputElement).value).toBe("0.5");
  });

  it("writes every edit in one save, changing only those values", async () => {
    open();
    fireEvent.change(await screen.findByLabelText("size"), {
      target: { value: "18" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "enabled" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toBe(FILE);
    expect(disk.get(FILE)).toBe(
      DATA.replace("size = 12", "size = 18").replace(
        "enabled = true",
        "enabled = false",
      ),
    );
    expect(disk.get(writes[0])).toBe(DATA);
    expect(await screen.findByText(/^Saved\./)).toBeTruthy();
    expect(
      ((await screen.findByLabelText("size")) as HTMLInputElement).value,
    ).toBe("18");
  });

  it("will not save a number that is not one", async () => {
    open();
    fireEvent.change(await screen.findByLabelText("size"), {
      target: { value: "twelve" },
    });
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(
      ((await screen.findByLabelText("size")) as HTMLInputElement).value,
    ).toBe("12");
  });

  it("is read only while a game is running", async () => {
    play.running = true;
    open();
    const size = (await screen.findByLabelText("size")) as HTMLInputElement;
    expect(size.disabled).toBe(true);
    expect(screen.getByText(/A game is running/)).toBeTruthy();
  });

  it("says a widget that never saves through GetConfigData has no saved settings", async () => {
    disk.set(WIDGET, "local size = 12");
    open("Other");
    expect(
      await screen.findByText("This widget has no saved settings."),
    ).toBeTruthy();
  });

  it("says a widget that has not run yet has nothing saved", async () => {
    open("Other");
    expect(await screen.findByText(/Nothing saved yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("shows the error for a file it cannot read, and writes nothing", async () => {
    disk.set(FILE, "return {\n\tdata = {");
    open();
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /could not read/,
    );
    expect(writes).toEqual([]);
  });
});
