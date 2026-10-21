// @vitest-environment happy-dom

import { createCompiledCatalog } from "@lingui/cli/api";
import { type Messages, setupI18n } from "@lingui/core";
import { describe, expect, it } from "vitest";
import config from "../../lingui.config";
import { i18n, loadLocale } from ".";
import { PSEUDO_LOCALE, pickerLocales } from "./locales";

// Issue #4593: the pseudo-locale is the English source accented, padded and
// bracketed, with placeholders and plural syntax passed through.
const { locale, ...options } = config.pseudoLocale as {
  locale: string;
} & Record<string, unknown>;

/** Compile `source` the way the vite plugin compiles the pseudo catalog. */
function pseudo(source: Record<string, string>) {
  const { source: json, errors } = createCompiledCatalog(locale, source, {
    namespace: "json",
    pseudoLocale: locale,
    pseudoLocaleOptions: options,
  });
  expect(errors).toEqual([]);
  const run = setupI18n();
  run.loadAndActivate({
    locale: PSEUDO_LOCALE,
    messages: (JSON.parse(json as string) as { messages: Messages }).messages,
  });
  return run;
}

/** Whether `s` has no unaccented Latin letters left. */
const accented = (s: string) => !/[A-Za-z]/.test(s);

describe("pseudo-locale", () => {
  it("accents, pads and brackets plain text", () => {
    const out = pseudo({ msg: "Check for updates" })._("msg");
    expect(out).toMatch(/^\[~+[^~]+~+\]$/);
    expect(accented(out)).toBe(true);
    expect(out.length).toBeGreaterThan("Check for updates".length * 1.3);
  });

  it("keeps a placeholder's name and substitutes its value", () => {
    const out = pseudo({ msg: "Hello {name}" })._("msg", { name: "Coilbox" });
    expect(out).toContain("Coilbox");
    expect(accented(out.replace("Coilbox", ""))).toBe(true);
  });

  it("keeps plural syntax, so the count picks the form", () => {
    const run = pseudo({
      msg: "{count, plural, one {# file left} other {# files left}}",
    });
    const one = run._("msg", { count: 1 });
    const many = run._("msg", { count: 3 });
    expect(one).toMatch(/^1\[/);
    expect(many).toMatch(/^3\[/);
    expect(accented(one) && accented(many)).toBe(true);
    expect(many.slice(1)).not.toBe(one.slice(1));
  });

  it("loads the generated catalog and is offered by the picker in dev", async () => {
    await loadLocale(PSEUDO_LOCALE);
    expect(i18n.locale).toBe(PSEUDO_LOCALE);
    expect(pickerLocales()).toContain(PSEUDO_LOCALE);
    await loadLocale("en");
  });
});
