// @vitest-environment happy-dom
/**
 * What a row says about where its own label came from (issue #2679).
 *
 * Every unit field the page can draw has a written label today, so the
 * undescribed case cannot be reached by driving the page. It is still worth
 * holding on to: the next engine bump adds keys nobody has read the C++ for,
 * and they land here labelled with the key. The row has to admit that rather
 * than letting the key pass for a label, which is the whole point of the flag.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedField } from "@/content/unitFields";
import type { CheckMarker } from "../../checkMarkers";
import type { FieldRow } from "../../unitSections";
import { UnitFieldRow } from "./UnitFieldRow";

const field = (over: Partial<ResolvedField>): ResolvedField => ({
  path: "someKey",
  key: "someKey",
  known: true,
  described: true,
  label: "Some key",
  type: "number",
  ...over,
});

const row = (f: ResolvedField): FieldRow => ({
  path: f.path,
  field: f,
  label: f.label,
  present: true,
  inherited: 1,
  value: 1,
  state: "inherited",
});

const draw = (f: ResolvedField) =>
  render(<UnitFieldRow row={row(f)} onChange={() => {}} onReset={() => {}} />);

const draw2 = (checkMarker: CheckMarker) =>
  render(
    <UnitFieldRow
      row={row(field({}))}
      checkMarker={checkMarker}
      onChange={() => {}}
      onReset={() => {}}
    />,
  );

afterEach(cleanup);

describe("a row whose label nobody wrote", () => {
  it("says the label is the engine's key", () => {
    draw(field({ described: false, label: "upDirSmoothing" }));
    expect(screen.getByText("upDirSmoothing")).toBeTruthy();
    expect(screen.getByText("engine key")).toBeTruthy();
  });

  it("keeps the key on screen rather than hiding it behind an apology", () => {
    draw(
      field({
        described: false,
        key: "upDirSmoothing",
        path: "upDirSmoothing",
        label: "upDirSmoothing",
      }),
    );
    // Twice: as the label, and on the path line under it. An experienced modder
    // recognises the key, and it is the only thing they can search for.
    expect(screen.getAllByText("upDirSmoothing")).toHaveLength(2);
  });

  it("says nothing extra once the field has a label", () => {
    draw(field({ described: true, label: "Tilt smoothing" }));
    expect(screen.getByText("Tilt smoothing")).toBeTruthy();
    expect(screen.queryByText("engine key")).toBeNull();
  });

  it("leaves a key only the game declares to the game marker", () => {
    draw(field({ known: false, described: false, label: "unitgroup" }));
    expect(screen.getByText("game")).toBeTruthy();
    expect(screen.queryByText("engine key")).toBeNull();
  });
});

/** Issue #3163. The rounded left accent bar that used to mark a field
 *  overridden from the game's default is now an "edited" marker instead,
 *  which must stay readable alongside a check marker on the same row. */
describe("a row overridden from the game's default", () => {
  it("carries an edited marker, and none of the old accent bar classes", () => {
    const { container } = render(
      <UnitFieldRow
        row={{ ...row(field({})), state: "overridden" }}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.getByText("edited")).toBeTruthy();
    const rowDiv = container.querySelector("#field-someKey");
    expect(rowDiv?.className).not.toMatch(/border-l/);
  });

  it("keeps the edited marker and a check marker both readable on one row", () => {
    render(
      <UnitFieldRow
        row={{ ...row(field({})), state: "overridden" }}
        checkMarker={{ severity: "blocker", messages: ["Out of range."] }}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.getByText("edited")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Blocker" })).toBeTruthy();
  });

  it("says nothing extra on a row still at the game's default", () => {
    draw(field({}));
    expect(screen.queryByText("edited")).toBeNull();
  });
});

/** Issue #3116. A field a compatibility check found something about. */
describe("a row a check has something to say about", () => {
  it("marks a blocker and puts the message in a tooltip", async () => {
    draw2({
      severity: "blocker",
      messages: ["armcom no longer has weapondefs, so this is dead weight."],
    });
    const marker = screen.getByRole("button", { name: "Blocker" });
    expect(marker.className).toMatch(/text-destructive/);
    fireEvent.focus(marker);
    expect(
      await screen.findByText(
        "armcom no longer has weapondefs, so this is dead weight.",
      ),
    ).toBeTruthy();
  });

  it("marks a review item differently from a blocker", () => {
    draw2({ severity: "review", messages: ["worth a look"] });
    const marker = screen.getByRole("button", { name: "Worth a look" });
    expect(marker.className).toMatch(/amber/);
  });

  it("says nothing extra for a field no check has flagged", () => {
    draw(field({}));
    expect(screen.queryByRole("button", { name: "Blocker" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Worth a look" })).toBeNull();
  });
});

/**
 * Issue #2633. The row on a game the edit-in-place route can write, when the
 * unit's file cannot take a change to this field.
 */
describe("a row the edit-in-place route cannot write", () => {
  const check = {
    field: "someKey",
    refusal: {
      unit: "u",
      field: "someKey",
      file: "units/u.lua",
      kind: "postCheckFailed",
      message: "The edit would also change v.somekey, so it was not made.",
      location: null,
    },
    excerpt: null,
  };

  const drawRouted = (routed: boolean, overridden: boolean) => {
    const onRoute = vi.fn();
    const f = field({ label: "Some key" });
    render(
      <UnitFieldRow
        row={{ ...row(f), state: overridden ? "overridden" : "inherited" }}
        inPlace={{ check, routed, onRoute }}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );
    return onRoute;
  };

  it("keeps a change already made on screen, read only, and offers the mutator for it", () => {
    const onRoute = drawRouted(false, true);
    expect(screen.getByLabelText("Some key")).toHaveProperty("disabled", true);
    expect(
      screen.getByText(
        "Read only for edit in place. This change stops an in-place write.",
      ),
    ).toBeTruthy();
    // Taking the change out is always allowed.
    expect(
      screen.getByRole("button", {
        name: "Reset Some key to the inherited value",
      }),
    ).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByText("Send this change to the mutator"));
    expect(onRoute).toHaveBeenCalledWith(true);
  });

  it("is editable once its change goes through the mutator, and can be taken back", () => {
    const onRoute = drawRouted(true, false);
    expect(screen.getByLabelText("Some key")).toHaveProperty("disabled", false);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Stop sending Some key through the mutator route",
      }),
    );
    expect(onRoute).toHaveBeenCalledWith(false);
  });
});

/** Issue #3057. A field the game's post files change as it loads. */
describe("a row the game's post files change", () => {
  const drawPost = (
    post: Parameters<typeof UnitFieldRow>[0]["post"],
    readOnly = false,
  ) =>
    render(
      <UnitFieldRow
        row={row(field({}))}
        post={post}
        readOnly={readOnly}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );

  it("says what the game does to its own value", () => {
    drawPost({ kind: "changed", file: 0.1, loaded: 0.009 });
    expect(
      screen.getByText(
        "The game changes this field as it loads. Its files say 0.1 and it loads as 0.009. It may change a value typed here too. A mutator archive, an edit-in-place write and the tweak slots each get a value the game turns into the typed one, where loading the game proves it.",
      ),
    ).toBeTruthy();
  });

  it("says when the game sets a field its own files leave unset", () => {
    drawPost({ kind: "added", loaded: 0.3 });
    expect(
      screen.getByText(
        "The game sets this field as it loads, to 0.3. Its own files leave it unset. It may change a value typed here too. A mutator archive, an edit-in-place write and the tweak slots each get a value the game turns into the typed one, where loading the game proves it.",
      ),
    ).toBeTruthy();
  });

  it("says nothing on a row nobody can type into", () => {
    drawPost({ kind: "changed", file: 0.1, loaded: 0.009 }, true);
    expect(screen.queryByText(/loads as/)).toBeNull();
  });
});
