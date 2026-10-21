import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";
import { LOCALES, PSEUDO_LOCALE, SOURCE_LOCALE } from "./src/i18n/locales";

export default defineConfig({
  sourceLocale: SOURCE_LOCALE,
  locales: [...LOCALES, PSEUDO_LOCALE],
  // The pseudo catalog is extracted with no translations, and compiling it
  // accents the English source, pads it by 30 percent with "~" (the extra
  // length German and French often run to) and wraps it in brackets.
  // Placeholders and plural syntax are left alone.
  pseudoLocale: {
    locale: PSEUDO_LOCALE,
    prepend: "[",
    append: "]",
    extend: 0.3,
    extendCharacter: "~",
  },
  // An untranslated message falls back to its English source.
  fallbackLocales: { default: "en" },
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: ["<rootDir>/src"],
      exclude: ["**/*.test.ts", "**/*.test.tsx"],
    },
  ],
  // Origins without line numbers, so an edit that only moves a string down a
  // file does not change the catalogs and fail the extract check.
  format: formatter({ lineNumbers: false }),
});
