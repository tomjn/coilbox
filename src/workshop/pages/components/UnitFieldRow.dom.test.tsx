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
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
