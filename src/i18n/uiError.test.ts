// @vitest-environment happy-dom

import { msg } from "@lingui/core/macro";
import { beforeEach, describe, expect, it } from "vitest";
import { i18n } from ".";
import { describeError, parseUiError, UI_ERROR_CODES } from "./uiError";

const exists = JSON.stringify({
  code: UI_ERROR_CODES.packageTargetExists,
  params: { path: "/games/a.sdd" },
  fallback:
    "/games/a.sdd already exists; confirm a replace before packaging over it",
});

// A fixture catalog stands in for a real translation. Lingui keys it by a hash
// of the English source, so the key comes from the same `msg` text.
const path = "";
const { id } =
  msg`${path} already exists; confirm a replace before packaging over it`;
const FIXTURE = { [id]: [["path"] as [string], " existe deja (fixture)"] };

beforeEach(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("parseUiError", () => {
  it("reads the JSON a UiError becomes", () => {
    expect(parseUiError(exists)).toEqual({
      code: "workshop.package.target_exists",
      params: { path: "/games/a.sdd" },
      fallback:
        "/games/a.sdd already exists; confirm a replace before packaging over it",
    });
  });

  it("wraps a plain string as a fallback-only error", () => {
    expect(parseUiError("could not write the file")).toEqual({
      code: null,
      params: {},
      fallback: "could not write the file",
    });
  });

  it("treats JSON of another shape as plain text", () => {
    for (const text of [
      '{"error":"x"}',
      '{"code":1,"fallback":"x"}',
      "{broken",
      "[1]",
    ]) {
      expect(parseUiError(text)).toEqual({
        code: null,
        params: {},
        fallback: text,
      });
    }
  });
});

describe("describeError", () => {
  it("fills a known code's params into the English source under en", () => {
    expect(describeError(new Error(exists))).toBe(
      "/games/a.sdd already exists; confirm a replace before packaging over it",
    );
  });

  it("uses the active catalog's translation for a known code", () => {
    i18n.loadAndActivate({ locale: "fr", messages: FIXTURE });
    expect(describeError(new Error(exists))).toBe(
      "/games/a.sdd existe deja (fixture)",
    );
  });

  it("shows the fallback for a code the table does not know", () => {
    i18n.loadAndActivate({ locale: "fr", messages: FIXTURE });
    const unknown = JSON.stringify({
      code: "nothing.like.this",
      params: {},
      fallback: "English text",
    });
    expect(describeError(new Error(unknown))).toBe("English text");
  });

  it("passes a plain string, an Error and another value through", () => {
    expect(describeError("plain")).toBe("plain");
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError(42)).toBe("42");
  });
});
