import { describe, expect, it, vi } from "vitest";

// welcomeActions.ts pulls in pageLinks -> refs/pages (defineCommand) whose published
// dist won't load under Vitest's node resolver. The logic is pure, so stub the leaf.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { resolveWelcomeAction } from "./welcomeActions";

describe("resolveWelcomeAction", () => {
  it("maps quit to a quit action", () => {
    expect(resolveWelcomeAction("quit", null)).toEqual({ kind: "quit" });
  });

  it("resolves navigate + @route/ to the same route the markdown path produces", () => {
    expect(resolveWelcomeAction("navigate", "@route/singleplayer")).toEqual({
      kind: "navigate",
      to: "/singleplayer",
    });
  });

  it("resolves navigate + a .md ref to its page route", () => {
    expect(resolveWelcomeAction("navigate", "rules.md")).toEqual({
      kind: "navigate",
      to: "/pages/rules",
    });
  });

  it("resolves navigate + an app-absolute path to that route", () => {
    expect(resolveWelcomeAction("navigate", "/downloads/games")).toEqual({
      kind: "navigate",
      to: "/downloads/games",
    });
  });

  it("is a no-op for a navigate whose route doesn't resolve to a route", () => {
    expect(resolveWelcomeAction("navigate", "@widget/build-tree")).toBeNull();
    expect(resolveWelcomeAction("navigate", "https://example.org")).toBeNull();
    expect(resolveWelcomeAction("navigate", "@.coilbox/../escape")).toBeNull();
    expect(resolveWelcomeAction("navigate", undefined)).toBeNull();
    expect(resolveWelcomeAction("navigate", "")).toBeNull();
  });

  it("is a no-op for an unknown or missing action", () => {
    expect(resolveWelcomeAction("frobnicate", "@route/x")).toBeNull();
    expect(resolveWelcomeAction(null, "@route/x")).toBeNull();
    expect(resolveWelcomeAction(undefined, null)).toBeNull();
  });
});
