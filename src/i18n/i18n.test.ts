// @vitest-environment happy-dom

import { msg, t } from "@lingui/core/macro";
import { describe, expect, it } from "vitest";
import { i18n, loadLocale } from ".";

// Issue #4590: nav labels, notify() and toast calls live in plain .ts modules,
// so the `t` macro has to compile there too. Left untransformed, importing
// `@lingui/core/macro` throws at runtime, so this file running at all shows the
// transform reached a .ts file. Test files are left out of extraction, so these
// strings never reach the catalogs.
describe("i18n", () => {
  it("activates the locale it loads", async () => {
    await loadLocale("fr");
    expect(i18n.locale).toBe("fr");
  });

  it("falls back to the English source for a message the catalog lacks", async () => {
    await loadLocale("en");
    const name = "Coilbox";
    expect(t`Hello ${name}`).toBe("Hello Coilbox");
  });

  it("translates a t call in a plain .ts module through the active catalog", () => {
    const name = "Coilbox";
    const { id } = msg`Hello ${name}`;
    i18n.loadAndActivate({
      locale: "fr",
      messages: { [id]: ["Bonjour ", ["name"]] },
    });
    expect(t`Hello ${name}`).toBe("Bonjour Coilbox");
  });
});
