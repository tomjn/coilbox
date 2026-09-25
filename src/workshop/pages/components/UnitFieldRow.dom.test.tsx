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
        "The game changes this field as it loads. Its files say 0.1 and it loads as 0.009. It may change a value typed here too. A mutator archive gets a value the game turns into the typed one, where loading the game proves it. Beyond All Reason's tweak slots and edit in place write it as typed.",
      ),
    ).toBeTruthy();
  });

  it("says when the game sets a field its own files leave unset", () => {
    drawPost({ kind: "added", loaded: 0.3 });
    expect(
      screen.getByText(
        "The game sets this field as it loads, to 0.3. Its own files leave it unset. It may change a value typed here too. A mutator archive gets a value the game turns into the typed one, where loading the game proves it. Beyond All Reason's tweak slots and edit in place write it as typed.",
      ),
    ).toBeTruthy();
  });

  it("says nothing on a row nobody can type into", () => {
    drawPost({ kind: "changed", file: 0.1, loaded: 0.009 }, true);
    expect(screen.queryByText(/loads as/)).toBeNull();
  });
});
