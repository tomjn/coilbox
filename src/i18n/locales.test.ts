// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { bootLocale } from "./language";
import {
  localeDisplayName,
  resolveLanguage,
  resolveLocaleTag,
} from "./locales";

describe("resolveLocaleTag", () => {
  it.each([
    ["fr-CA", "fr"],
    ["zh-CN", "zh-Hans"],
    ["zh-TW", "en"],
    ["pt-BR", "en"],
    ["en-GB", "en"],
    ["zh", "zh-Hans"],
    ["zh-Hans-CN", "zh-Hans"],
    ["zh-Hant", "en"],
    ["zh-HK", "en"],
    ["zh-MO", "en"],
    ["DE-at", "de"],
    ["ja", "ja"],
    ["pl", "pl"],
    ["pl-PL", "pl"],
    ["", "en"],
  ])("resolves %s to %s", (tag, expected) => {
    expect(resolveLocaleTag(tag)).toBe(expected);
  });
});

describe("resolveLanguage", () => {
  it("uses a stored locale as it is, whatever the system says", () => {
    expect(resolveLanguage("de", "fr-CA")).toBe("de");
  });

  it("follows the system for 'system' and for an unknown code", () => {
    expect(resolveLanguage("system", "fr-CA")).toBe("fr");
    expect(resolveLanguage("xx", "es-MX")).toBe("es");
  });
});

describe("localeDisplayName", () => {
  it("names a locale in its own language", () => {
    expect(localeDisplayName("fr")).toBe("Français");
    expect(localeDisplayName("de")).toBe("Deutsch");
    expect(localeDisplayName("pl")).toBe("Polski");
  });
});

describe("bootLocale", () => {
  it("reads a stored JSON string, and falls back to the system for anything else", () => {
    expect(bootLocale('"de"')).toBe("de");
    expect(bootLocale('"system"')).toBe(resolveLocaleTag(navigator.language));
    expect(bootLocale(null)).toBe(resolveLocaleTag(navigator.language));
    expect(bootLocale("{not json")).toBe(resolveLocaleTag(navigator.language));
    expect(bootLocale("42")).toBe(resolveLocaleTag(navigator.language));
  });
});
