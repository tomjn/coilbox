// @vitest-environment happy-dom

import { msg, t } from "@lingui/core/macro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n, loadLocale } from ".";
import { bootLocale } from "./language";
import { pickerLocales } from "./locales";
import {
  applyLocalePacks,
  getLocalePackFailures,
  languageLabel,
  type PackFiles,
  packOnlyLocales,
  parsePack,
} from "./packs";

/**
 * Issue #4598. `eo` (Esperanto) stands in for a code coilbox does not bundle,
 * because no catalog issue plans it, so the test cannot start failing when a
 * new bundled language lands.
 */
function pack(
  dir: string,
  messages: Record<string, unknown>,
  meta: Record<string, unknown> = {},
): PackFiles {
  return {
    dir,
    pack: JSON.stringify({ code: dir, name: dir, direction: "ltr", ...meta }),
    catalog: JSON.stringify({ messages }),
    error: "",
  };
}

const profile = vi.hoisted(
  () => ({ version: 1 }) as { defaultLocale?: string },
);
vi.mock("../profile/profile", () => ({ getProfile: () => profile }));

afterEach(() => {
  applyLocalePacks([]);
  delete profile.defaultLocale;
});

describe("defaultLocale", () => {
  it("applies only when the player has never chosen a language", () => {
    applyLocalePacks([pack("eo", {})]);
    profile.defaultLocale = "eo";
    expect(bootLocale(null)).toBe("eo");
    expect(bootLocale('"fr"')).toBe("fr");
    expect(bootLocale('"system"')).toBe(bootLocale('"no-such-code"'));
    expect(bootLocale('"system"')).not.toBe("eo");
  });

  it("is ignored when it names a language coilbox does not have", () => {
    profile.defaultLocale = "eo";
    expect(bootLocale(null)).toBe(bootLocale('"system"'));
  });
});

describe("a pack for a bundled locale", () => {
  it("wins for the key it overrides and leaves the bundled text for the rest", async () => {
    applyLocalePacks([pack("de", { [msg`Settings`.id]: ["Optionen"] })]);
    await loadLocale("de");
    expect(i18n.locale).toBe("de");
    expect(t`Settings`).toBe("Optionen");
    expect(t`Language`).toBe("Sprache");
  });
});

describe("a pack for a code coilbox does not bundle", () => {
  it("is listed by the picker under its own name", () => {
    applyLocalePacks([
      pack("eo", { [msg`Settings`.id]: ["Agordoj"] }, { name: "Esperanto" }),
    ]);
    expect(packOnlyLocales()).toEqual(["eo"]);
    expect(pickerLocales(packOnlyLocales())).toContain("eo");
    expect(languageLabel("eo")).toBe("Esperanto");
  });

  it("loads over the English catalog", async () => {
    applyLocalePacks([pack("eo", { [msg`Settings`.id]: ["Agordoj"] })]);
    await loadLocale("eo");
    expect(i18n.locale).toBe("eo");
    expect(t`Settings`).toBe("Agordoj");
    expect(t`Language`).toBe("Language");
  });

  it("can be the stored choice", () => {
    applyLocalePacks([pack("eo", {})]);
    expect(bootLocale('"eo"')).toBe("eo");
  });
});

describe("parsePack", () => {
  const error = (files: PackFiles) => {
    const out = parsePack(files);
    return "error" in out ? out.error : null;
  };

  it("keeps the direction a pack names, and defaults it to ltr", () => {
    const rtl = parsePack(pack("eo", {}, { direction: "rtl" }));
    expect("direction" in rtl && rtl.direction).toBe("rtl");
    const files = pack("eo", {});
    files.pack = JSON.stringify({ code: "eo", name: "Esperanto" });
    const ltr = parsePack(files);
    expect("direction" in ltr && ltr.direction).toBe("ltr");
  });

  it("accepts plural choices as Lingui compiles them", () => {
    const plural = [
      ["n", "plural", { one: ["# dosiero"], other: ["# dosieroj"] }],
    ];
    expect(error(pack("eo", { abc: plural }))).toBeNull();
  });

  it("refuses a catalog that is not compiled JSON", () => {
    const files = pack("eo", {});
    files.catalog =
      '/*eslint-disable*/module.exports={messages:JSON.parse("{}")};';
    expect(error(files)).toMatch(/^messages.json is not valid JSON/);
    expect(error({ ...files, catalog: '{"abc":["x"]}' })).toMatch(
      /no messages object/,
    );
  });

  it("refuses a message Lingui could not render", () => {
    expect(error(pack("eo", { abc: [42] }))).toBe(
      "messages.json's message abc is not a compiled message",
    );
    expect(error(pack("eo", { abc: [["n", "number", { one: [] }]] }))).toBe(
      "messages.json's message abc is not a compiled message",
    );
  });

  it("refuses pack.json with the wrong code, name or direction", () => {
    expect(error(pack("eo", {}, { code: "de" }))).toMatch(/must be "eo"/);
    expect(error(pack("system", {}))).toMatch(/not a language code/);
    expect(error(pack("en-XA", {}))).toMatch(/not a language code/);
    expect(error(pack("not a tag", {}))).toMatch(/not a language code/);
    expect(error(pack("eo", {}, { name: "" }))).toMatch(/name/);
    expect(error(pack("eo", {}, { direction: "up" }))).toMatch(/direction/);
  });

  it("passes on a read error from the Rust side", () => {
    expect(
      error({ ...pack("eo", {}), error: "messages.json is too big" }),
    ).toBe("messages.json is too big");
  });

  it("records a refused pack and keeps the rest", () => {
    applyLocalePacks([pack("eo", { abc: [42] }), pack("de", {})]);
    expect(packOnlyLocales()).toEqual([]);
    expect(getLocalePackFailures().map((f) => f.dir)).toEqual(["eo"]);
  });
});
