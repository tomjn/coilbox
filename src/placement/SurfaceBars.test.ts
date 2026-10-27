/**
 * The undo and redo buttons, rendered (issue #1442).
 *
 * What matters about them is what they say when they cannot be pressed. A
 * button that is greyed out with no explanation reads as broken, and the start
 * of a history is exactly where somebody reaches for undo first.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HistoryControls, turnNoteText } from "./SurfaceBars";

const noop = () => {};

function markup(canUndo: boolean, canRedo: boolean): string {
  return renderToStaticMarkup(
    createElement(HistoryControls, {
      canUndo,
      canRedo,
      undo: noop,
      redo: noop,
    }),
  );
}

describe("HistoryControls", () => {
  it("offers both once there is a history and a way forward", () => {
    const html = markup(true, true);
    expect([...html.matchAll(/disabled=""/g)]).toHaveLength(0);
    expect(html).toContain('aria-label="Undo"');
    expect(html).toContain('aria-label="Redo"');
    // The shortcut is on the button, because it is the only place the editor
    // says what the keyboard does.
    expect(html).toMatch(/title="Undo \((Cmd|Ctrl) Z\)"/);
    expect(html).toMatch(/title="Redo \((Cmd|Ctrl) Shift Z\)"/);
  });

  it("says why rather than sitting there greyed out", () => {
    const html = markup(false, false);
    expect(html).toContain('title="Nothing to undo yet"');
    expect(html).toContain('title="Nothing to redo"');
    expect([...html.matchAll(/disabled=""/g)]).toHaveLength(2);
  });

  it("disables only the one with nowhere to go", () => {
    const html = markup(true, false);
    expect([...html.matchAll(/disabled=""/g)]).toHaveLength(1);
    expect(html).toContain('title="Nothing to redo"');
  });
});

/**
 * Issue #1541. The outlined square is the answer, and the sentence is what ties
 * it to the button the pointer is on.
 */
describe("turnNoteText", () => {
  const note = (moves: boolean | null) => turnNoteText(moves) ?? "";

  it("says nothing until the turn is being considered", () => {
    expect(turnNoteText(null)).toBeNull();
  });

  it("points at the outlined squares when the turn moves the building", () => {
    expect(note(true)).toContain("outlined");
  });

  /** A square factory still faces a new way after a turn, so "nothing
   *  changes" would be false. */
  it("says nothing when the turn leaves the building on the same squares", () => {
    expect(turnNoteText(false)).toBeNull();
  });
});
