// @vitest-environment happy-dom

/**
 * The battle room's strip about a player's widgets (issue #1292): it names the
 * cause, counts the widgets, lists them on request, and is absent when the room
 * costs the player nothing.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { UserWidgetGates } from "@/widgets/handlers";
import type { RoomWidgets } from "@/widgets/roomWidgets";
import type { WidgetRow } from "@/widgets/widgetList";
import { RoomWidgetsWarning } from "./RoomWidgetsWarning";

afterEach(cleanup);

function row(
  name: string,
  more: { control?: boolean; givesOrders?: boolean } = {},
): WidgetRow {
  return {
    path: `LuaUI/Widgets/${name}.lua`,
    folder: "LuaUI/Widgets",
    nested: false,
    coilbox: false,
    givesOrders: more.givesOrders ?? false,
    info: { name, control: more.control },
    error: null,
    loadedBy: ["Game"],
    switch: { kind: "ready", name, previousNames: [] },
  };
}

function widgets(rules: UserWidgetGates, rows: WidgetRow[]): RoomWidgets {
  return {
    game: { game: "Game", shortName: "G", handler: null },
    rules,
    rows,
    configFlag: null,
    localWidgets: null,
  };
}

function show(
  w: RoomWidgets | null,
  scriptTags: Record<string, string> = {},
  spectating = false,
) {
  return render(
    <MemoryRouter>
      <RoomWidgetsWarning
        widgets={w}
        scriptTags={scriptTags}
        spectating={spectating}
      />
    </MemoryRouter>,
  );
}

const sf: UserWidgetGates = {
  option: { key: "allowuserwidgets", loads: true, unset: false },
};
const bar: UserWidgetGates = {
  option: { key: "allowuserwidgets", loads: true, unset: true },
  spectators: "all",
  unitControlOption: "allowunitcontrolwidgets",
};

describe("RoomWidgetsWarning", () => {
  it("says a room that turns widgets off costs the player them, and lists which", () => {
    show(widgets(sf, [row("Build Watch"), row("Minimap")]));
    expect(
      screen.getByText(/does not allow player widgets/).textContent,
    ).toContain("2 widgets of yours will not load");
    expect(screen.queryByText("Build Watch")).toBeNull();
    fireEvent.click(screen.getByText("Show which"));
    expect(screen.getByText("Build Watch")).toBeTruthy();
    expect(screen.getByText("Minimap")).toBeTruthy();
  });

  it("is absent once the room turns them on", () => {
    const { container } = show(widgets(sf, [row("A")]), {
      "game/modoptions/allowuserwidgets": "1",
    });
    expect(container.textContent).toBe("");
  });

  it("is absent when the player has no widgets", () => {
    const { container } = show(widgets(sf, []));
    expect(container.textContent).toBe("");
  });

  it("is absent before the widgets are read", () => {
    const { container } = show(null);
    expect(container.textContent).toBe("");
  });

  it("links to the widget list", () => {
    show(widgets(sf, [row("A")]));
    expect(
      screen.getByText("Open your widgets").closest("a")?.getAttribute("href"),
    ).toBe("/library/widgets");
  });

  it("separates widgets the game skips from widgets that will fail", () => {
    show(
      widgets(bar, [
        row("Declares", { control: true, givesOrders: true }),
        row("Silent", { givesOrders: true }),
        row("Harmless"),
      ]),
      { "game/modoptions/allowunitcontrolwidgets": "0" },
    );
    expect(screen.getByText(/the game skips it/)).toBeTruthy();
    expect(screen.getByText(/raise an error each time it does/)).toBeTruthy();
    expect(screen.getAllByText("Show which")).toHaveLength(2);
  });

  it("says nothing to a spectator in Beyond All Reason", () => {
    const { container } = show(
      widgets(bar, [row("A", { givesOrders: true })]),
      {
        "game/modoptions/allowuserwidgets": "0",
        "game/modoptions/allowunitcontrolwidgets": "0",
      },
      true,
    );
    expect(container.textContent).toBe("");
  });
});
