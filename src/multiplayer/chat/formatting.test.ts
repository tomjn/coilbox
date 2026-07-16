import { describe, expect, it } from "vitest";
import { type Format, wrapSelection } from "./formatting";
import { parseMessage } from "./parseMessage";

describe("wrapSelection", () => {
  it("wraps a selection in bold markers and keeps it selected", () => {
    expect(wrapSelection("hello world", 6, 11, "bold")).toEqual({
      value: "hello **world**",
      start: 8,
      end: 13,
    });
  });

  it("wraps in italic markers", () => {
    expect(wrapSelection("hello", 0, 5, "italic")).toEqual({
      value: "_hello_",
      start: 1,
      end: 6,
    });
  });

  it("wraps in code markers", () => {
    expect(wrapSelection("!status", 0, 7, "code")).toEqual({
      value: "`!status`",
      start: 1,
      end: 8,
    });
  });

  it("puts the caret between the markers when nothing is selected", () => {
    expect(wrapSelection("hi ", 3, 3, "bold")).toEqual({
      value: "hi ****",
      start: 5,
      end: 5,
    });
  });

  it("leaves a selection's trailing space outside the markers", () => {
    expect(wrapSelection("foo bar", 0, 4, "bold")).toEqual({
      value: "**foo** bar",
      start: 2,
      end: 5,
    });
  });

  it("leaves a selection's leading space outside the markers", () => {
    expect(wrapSelection("foo bar", 3, 7, "bold")).toEqual({
      value: "foo **bar**",
      start: 6,
      end: 9,
    });
  });

  it("treats a whitespace-only selection as a caret at its end", () => {
    expect(wrapSelection("a  b", 1, 3, "code")).toEqual({
      value: "a  ``b",
      start: 4,
      end: 4,
    });
  });

  it("wraps a multi-line selection as one span", () => {
    expect(wrapSelection("one\ntwo", 0, 7, "bold")).toEqual({
      value: "**one\ntwo**",
      start: 2,
      end: 9,
    });
  });
});

describe("wrapSelection output round-trips through parseMessage", () => {
  const cases: [Format, string][] = [
    ["bold", "bold"],
    ["italic", "italic"],
    ["code", "code"],
  ];
  for (const [format, type] of cases) {
    it(`emits markup the renderer tokenizes as ${type}`, () => {
      const { value } = wrapSelection("hey there", 4, 9, format);
      expect(parseMessage(value)).toContainEqual(
        expect.objectContaining({ type }),
      );
    });
  }
});
