import { describe, expect, it, vi } from "vitest";

// pageWidgets.ts pulls in refs.ts (defineCommand) whose published dist won't load under
// Vitest's node resolver. splitWidgets is pure, so stubbing the leaf lets it load.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { splitWidgets } from "./pageWidgets";

describe("splitWidgets", () => {
  it("returns one text segment when there are no widget lines", () => {
    expect(splitWidgets("# Hi\n\ntext")).toEqual([
      { kind: "text", text: "# Hi\n\ntext" },
    ]);
  });

  it("splits a lone @widget/ line into a widget segment", () => {
    expect(splitWidgets("before\n@widget/onboarding\nafter")).toEqual([
      { kind: "text", text: "before" },
      { kind: "widget", name: "onboarding" },
      { kind: "text", text: "after" },
    ]);
  });

  it("carries a widget arg through", () => {
    expect(splitWidgets("@widget/build-tree/zk")).toEqual([
      { kind: "widget", name: "build-tree", arg: "zk" },
    ]);
  });

  it("coalesces consecutive text lines into one segment", () => {
    expect(splitWidgets("a\nb\n@widget/welcome\nc\nd")).toEqual([
      { kind: "text", text: "a\nb" },
      { kind: "widget", name: "welcome" },
      { kind: "text", text: "c\nd" },
    ]);
  });

  it("leaves a widget ref that isn't alone on its line as text", () => {
    expect(splitWidgets("see @widget/welcome here")).toEqual([
      { kind: "text", text: "see @widget/welcome here" },
    ]);
  });

  it("handles back-to-back widgets with no text between them", () => {
    expect(splitWidgets("@widget/onboarding\n@widget/map-pack")).toEqual([
      { kind: "widget", name: "onboarding" },
      { kind: "widget", name: "map-pack" },
    ]);
  });
});
