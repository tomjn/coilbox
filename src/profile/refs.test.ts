import { describe, expect, it, vi } from "vitest";

// refs.ts imports defineCommand from @picoframe/plugin-sdk (for the profile_file
// binding) whose published dist won't load under Vitest's node resolver. These tests
// exercise only the pure parser/resolver, so stubbing the leaf lets it load.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { parseRef, resolveFileRef } from "./refs";

describe("parseRef", () => {
  it("returns null for non-@ tokens", () => {
    expect(parseRef("hello")).toBeNull();
    expect(parseRef("")).toBeNull();
    expect(parseRef("@")).toBeNull();
  });

  it("parses a .coilbox file ref, stripping the namespace to a root-relative path", () => {
    expect(parseRef("@.coilbox/test.md")).toEqual({
      kind: "file",
      path: "test.md",
    });
    expect(parseRef("@.coilbox/pages/shared.md")).toEqual({
      kind: "file",
      path: "pages/shared.md",
    });
  });

  it("rejects escaping / absolute / empty file paths", () => {
    expect(parseRef("@.coilbox/../secret")).toBeNull();
    expect(parseRef("@.coilbox//etc/passwd")).toBeNull();
    expect(parseRef("@.coilbox/")).toBeNull();
    expect(parseRef("@.coilbox")).toBeNull();
  });

  it("parses a route ref to a leading-slash app route", () => {
    expect(parseRef("@route/singleplayer")).toEqual({
      kind: "route",
      to: "/singleplayer",
    });
    expect(parseRef("@route/content/games")).toEqual({
      kind: "route",
      to: "/content/games",
    });
    expect(parseRef("@route/")).toBeNull();
  });

  it("parses a widget ref with an optional slash-delimited arg", () => {
    expect(parseRef("@widget/onboarding")).toEqual({
      kind: "widget",
      name: "onboarding",
    });
    expect(parseRef("@widget/build-tree/zk")).toEqual({
      kind: "widget",
      name: "build-tree",
      arg: "zk",
    });
    expect(parseRef("@widget/build-tree/")).toEqual({
      kind: "widget",
      name: "build-tree",
    });
    expect(parseRef("@widget/")).toBeNull();
  });

  it("returns null for an unknown namespace", () => {
    expect(parseRef("@bogus/x")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(parseRef("  @route/x  ")).toEqual({ kind: "route", to: "/x" });
  });
});

describe("resolveFileRef", () => {
  const ok = async () => ({ text: "FILE BODY", ok: true });
  const miss = async () => ({ text: "", ok: false });

  it("passes inline (non-@) values through verbatim without reading", async () => {
    const read = vi.fn(ok);
    expect(await resolveFileRef("<p>inline</p>", read)).toEqual({
      text: "<p>inline</p>",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("reads a file ref and returns its text", async () => {
    const read = vi.fn(ok);
    expect(await resolveFileRef("@.coilbox/welcome.html", read)).toEqual({
      text: "FILE BODY",
    });
    expect(read).toHaveBeenCalledWith("welcome.html");
  });

  it("returns a visible error when the file can't be read", async () => {
    const res = await resolveFileRef("@.coilbox/missing.html", miss);
    expect(res.text).toBe("");
    expect(res.error).toMatch(/missing\.html/);
  });

  it("errors loudly on a malformed/escaping ref rather than injecting it literally", async () => {
    const read = vi.fn(ok);
    const res = await resolveFileRef("@.coilbox/../secret", read);
    expect(res.text).toBe("");
    expect(res.error).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });
});
