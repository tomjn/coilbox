// @vitest-environment happy-dom
/**
 * What a table-valued field puts on screen (issue #2695).
 *
 * Drawn through `UnitFieldRow` rather than through `LuaTableValue` on its own,
 * because the bug was the row choosing `JSON.stringify` and a `truncate`d
 * `code` element, and a test that skipped the row would not have caught it.
 *
 * shiki is loaded lazily and never resolves inside a synchronous render, so
 * every assertion here is against the plain fallback. That is the text either
 * way. Colour is the layer on top and is not what the issue is about.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedField } from "@/content/unitFields";
import type { FieldRow } from "../../unitSections";
import { UnitFieldRow } from "./UnitFieldRow";

const draw = (path: string, label: string, value: unknown) => {
  const field: ResolvedField = {
    path,
    key: path,
    known: false,
    described: false,
    label,
    type: "table",
  };
  return render(
    <UnitFieldRow
      row={{
        path,
        field,
        label,
        present: true,
        inherited: value,
        value,
        state: "inherited",
      } satisfies FieldRow}
      onChange={() => {}}
      onReset={() => {}}
    />,
  );
};

/** Ten keys wide enough that the table cannot stay on one line. */
const big = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [`sound_${i}`, `explosion_sample_${i}`]),
);

afterEach(cleanup);

describe("a field whose value is a table", () => {
  it("shows a small one as Lua in the row", () => {
    draw("sfxtypes", "Effects", {
      explosiongenerators: ["custom:BLINK", "custom:FLASH"],
    });

    const block = screen.getByLabelText("Effects as Lua");
    expect(block.textContent).toContain("explosiongenerators = {");
    expect(block.textContent).toContain('[1] = "custom:BLINK"');
    expect(block.textContent).toContain('[2] = "custom:FLASH"');
  });

  it("writes Lua rather than JSON", () => {
    draw("sfxtypes", "Effects", { explosiongenerators: ["BLINK", "FLASH"] });

    const text = screen.getByLabelText("Effects as Lua").textContent ?? "";
    // JSON quotes its keys and separates them with a colon. Lua does neither.
    expect(text).not.toContain('"explosiongenerators"');
    expect(text).not.toContain(":");
    expect(text).toContain("explosiongenerators = ");
  });

  it("keeps a large one behind a button that says how large it is", () => {
    draw("sounds", "Sounds", big);

    expect(screen.queryByLabelText("Sounds as Lua")).toBeNull();
    const button = screen.getByRole("button", { name: "Read Sounds as Lua" });
    expect(button.textContent).toContain("10 keys");
    expect(button.textContent).toContain("12 lines of Lua");
  });

  it("opens the whole table in a drawer, with nothing cut off", () => {
    draw("sounds", "Sounds", big);
    fireEvent.click(screen.getByRole("button", { name: "Read Sounds as Lua" }));

    const text = screen.getByLabelText("Sounds as Lua").textContent ?? "";
    for (const key of Object.keys(big)) {
      expect(text, `${key} is in the drawer`).toContain(key);
    }
    // The path is what a reader searches the game's own files for, so the
    // drawer repeats it alongside the row that opened it.
    expect(screen.getAllByText("sounds").length).toBeGreaterThan(1);
  });

  it("still shows a value that is not a table as one line", () => {
    draw("weirdkey", "Weird key", undefined);
    expect(screen.getByText("not set")).toBeTruthy();
  });
});
