import { describe, expect, it } from "vitest";
import {
  describeJsonError,
  jsonErrorSnippet,
  locateJsonError,
} from "./jsonError";

describe("locateJsonError", () => {
  it("reads V8's explicit position and computes line/column", () => {
    const text = "line one\nline two";
    // position 9 = first char of the second line.
    const loc = locateJsonError(text, "... at position 9 (line 2 column 1)");
    expect(loc).toEqual({ position: 9, line: 2, column: 1 });
  });

  it("computes line/column from position alone (older V8)", () => {
    const text = "line one\nline two";
    const loc = locateJsonError(
      text,
      "Unexpected token in JSON at position 14",
    );
    // index 14 = 'w' of "two" → line 2, column 6.
    expect(loc).toEqual({ position: 14, line: 2, column: 6 });
  });

  it("falls back to line/column wording when no position is given", () => {
    const text = "a\nbc\nd";
    const loc = locateJsonError(text, "JSON error at line 2 column 2");
    expect(loc?.line).toBe(2);
    expect(loc?.column).toBe(2);
  });

  it("returns null for a JavaScriptCore-style message with no location", () => {
    expect(
      locateJsonError("{}", "JSON Parse error: Expected ',' or '}'"),
    ).toBeNull();
  });
});

describe("jsonErrorSnippet", () => {
  it("shows the offending line plus the one before it, with an aligned caret", () => {
    const text = '{\n  "a": 1\n  "b": 2\n}';
    const snippet = jsonErrorSnippet(text, {
      position: 13,
      line: 3,
      column: 3,
    });
    const lines = snippet.split("\n");
    // context line, error line, caret line.
    expect(lines[0]).toBe('2 |   "a": 1');
    expect(lines[1]).toBe('3 |   "b": 2');
    // the caret sits directly under the character at the error column.
    const errLine = lines[1];
    const caretLine = lines[2];
    expect(caretLine.indexOf("^")).toBe(errLine.indexOf('"'));
  });
});

describe("describeJsonError", () => {
  it("enriches a real JSON.parse failure with a located message and snippet", () => {
    const bad = '{\n  "a": 1\n  "b": 2\n}';
    let err: unknown;
    try {
      JSON.parse(bad);
    } catch (e) {
      err = e;
    }
    const d = describeJsonError(bad, err);
    // Node runs on V8, so a location is always recovered here.
    expect(d.message).toMatch(/^Line 3, column \d+:/);
    expect(d.snippet).toContain('"b": 2');
    expect(d.snippet).toContain("^");
  });

  it("passes the raw message through unchanged when unlocatable", () => {
    const d = describeJsonError("{}", new Error("JSON Parse error: something"));
    expect(d.message).toBe("JSON Parse error: something");
    expect(d.snippet).toBeUndefined();
  });
});
