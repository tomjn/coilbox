import { describe, expect, it } from "vitest";
import { type Format, formatSelection, listContinuation } from "./formatting";
import { parseMessage } from "./parseMessage";

describe("formatSelection wrapping", () => {
  it("wraps a selection in bold markers and keeps it selected", () => {
    expect(formatSelection("hello world", 6, 11, "bold")).toEqual({
      value: "hello **world**",
      start: 8,
      end: 13,
    });
  });

  it("wraps in italic markers", () => {
    expect(formatSelection("hello", 0, 5, "italic")).toEqual({
      value: "_hello_",
      start: 1,
      end: 6,
    });
  });

  it("wraps in code markers", () => {
    expect(formatSelection("!status", 0, 7, "code")).toEqual({
      value: "`!status`",
      start: 1,
      end: 8,
    });
  });

  it("puts the caret between the markers when nothing is selected", () => {
    expect(formatSelection("hi ", 3, 3, "bold")).toEqual({
      value: "hi ****",
      start: 5,
      end: 5,
    });
  });

  it("leaves a selection's trailing space outside the markers", () => {
    expect(formatSelection("foo bar", 0, 4, "bold")).toEqual({
      value: "**foo** bar",
      start: 2,
      end: 5,
    });
  });

  it("leaves a selection's leading space outside the markers", () => {
    expect(formatSelection("foo bar", 3, 7, "bold")).toEqual({
      value: "foo **bar**",
      start: 6,
      end: 9,
    });
  });

  it("treats a whitespace-only selection as a caret at its end", () => {
    expect(formatSelection("a  b", 1, 3, "code")).toEqual({
      value: "a  ``b",
      start: 4,
      end: 4,
    });
  });

  it("wraps a multi-line selection as one span", () => {
    expect(formatSelection("one\ntwo", 0, 7, "bold")).toEqual({
      value: "**one\ntwo**",
      start: 2,
      end: 9,
    });
  });
});

describe("formatSelection quoting", () => {
  it("prefixes the selected line", () => {
    expect(formatSelection("hello", 0, 5, "quote")).toEqual({
      value: "> hello",
      start: 0,
      end: 7,
    });
  });

  it("prefixes every line the selection touches", () => {
    expect(formatSelection("one\ntwo\nthree", 0, 7, "quote")).toEqual({
      value: "> one\n> two\nthree",
      start: 0,
      end: 11,
    });
  });

  it("quotes whole lines, not from where the selection started", () => {
    // The parser reads `>` at the head of a line or not at all, so quoting from
    // the caret would emit a line that renders as literal text.
    expect(formatSelection("hello there", 6, 11, "quote").value).toBe(
      "> hello there",
    );
  });

  it("leaves the lines around the selection alone", () => {
    expect(formatSelection("one\ntwo\nthree", 4, 7, "quote").value).toBe(
      "one\n> two\nthree",
    );
  });

  it("carries the caret rather than selecting the line", () => {
    // A selection here would be wiped by the next keystroke.
    expect(formatSelection("hello", 5, 5, "quote")).toEqual({
      value: "> hello",
      start: 7,
      end: 7,
    });
  });

  it("starts a quote in an empty draft", () => {
    expect(formatSelection("", 0, 0, "quote")).toEqual({
      value: "> ",
      start: 2,
      end: 2,
    });
  });
});

describe("formatSelection bulleting", () => {
  it("prefixes every line the selection touches", () => {
    expect(formatSelection("one\ntwo", 0, 7, "bullet")).toEqual({
      value: "- one\n- two",
      start: 0,
      end: 11,
    });
  });

  it("leaves the lines around the selection alone", () => {
    expect(formatSelection("one\ntwo\nthree", 4, 7, "bullet").value).toBe(
      "one\n- two\nthree",
    );
  });

  it("carries the caret rather than selecting the line", () => {
    expect(formatSelection("one", 3, 3, "bullet")).toEqual({
      value: "- one",
      start: 5,
      end: 5,
    });
  });
});

describe("listContinuation", () => {
  it("continues a bullet line", () => {
    expect(listContinuation("- first", 7)).toBe("- ");
  });

  it("keeps the marker the line already uses", () => {
    expect(listContinuation("+ first", 7)).toBe("+ ");
    expect(listContinuation("* first", 7)).toBe("* ");
  });

  it("keeps the line's indent", () => {
    expect(listContinuation("  - first", 9)).toBe("  - ");
  });

  it("continues from the last line of a list", () => {
    expect(listContinuation("- first\n- second", 16)).toBe("- ");
  });

  it("does not continue an ordinary line", () => {
    expect(listContinuation("hello", 5)).toBeNull();
  });

  it("does not continue a line whose dash has no space", () => {
    expect(listContinuation("-5 points", 9)).toBeNull();
  });

  it("does not continue from a plain line under a list", () => {
    expect(listContinuation("- first\nprose", 13)).toBeNull();
  });

  it("continues from a caret mid-item", () => {
    expect(listContinuation("- first", 4)).toBe("- ");
  });

  it("does not continue from a caret before the marker", () => {
    expect(listContinuation("- first", 1)).toBeNull();
  });
});

describe("formatSelection output round-trips through parseMessage", () => {
  const cases: [Format, string][] = [
    ["bold", "bold"],
    ["italic", "italic"],
    ["code", "code"],
    ["strike", "strike"],
    ["quote", "quote"],
  ];
  for (const [format, type] of cases) {
    it(`emits markup the renderer tokenizes as ${type}`, () => {
      const { value } = formatSelection("hey there", 4, 9, format);
      expect(parseMessage(value)).toContainEqual(
        expect.objectContaining({ type }),
      );
    });
  }

  it("emits a list once the button is used on two lines", () => {
    // A single bulleted line is deliberately not a list, so the button can only
    // produce one over a multi-line selection.
    const { value } = formatSelection("one\ntwo", 0, 7, "bullet");
    expect(parseMessage(value)).toContainEqual(
      expect.objectContaining({ type: "list" }),
    );
  });

  it("emits plain text when the button bullets a single line", () => {
    const { value } = formatSelection("one", 0, 3, "bullet");
    expect(parseMessage(value)).toEqual([{ type: "text", value: "- one" }]);
  });
});
